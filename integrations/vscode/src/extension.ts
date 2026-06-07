import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SECRET_KEY = 'kaizen.token';
const OUTPUT_CHANNEL_NAME = 'Kensho';

let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return outputChannel;
}

function getStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    statusBarItem.command = 'kaizen.sendLastRun';
  }
  return statusBarItem;
}

function setStatus(text: string, tooltip?: string): void {
  const item = getStatusBarItem();
  item.text = text;
  item.tooltip = tooltip ?? text;
  item.show();
}

/**
 * Resolve the API token. Priority:
 *   1. VS Code SecretStorage (key: "kaizen.token")
 *   2. workspace setting `kaizen.token`
 */
async function resolveToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const fromSecret = await context.secrets.get(SECRET_KEY);
  if (fromSecret && fromSecret.length > 0) {
    return fromSecret;
  }
  const config = vscode.workspace.getConfiguration('kaizen');
  const fromSetting = config.get<string>('token');
  if (fromSetting && fromSetting.length > 0) {
    return fromSetting;
  }
  return undefined;
}

interface SendOptions {
  cwd: string;
  resultsPath: string;
  workspaceSlug: string;
  projectSlug: string;
  token: string;
  server: string;
  kenshoVersion: string;
}

function runKenshoPush(opts: SendOptions): Promise<number> {
  const channel = getOutputChannel();
  const args = [
    '--yes',
    `@kaizenreport/kensho@${opts.kenshoVersion}`,
    'push',
    '--workspace', opts.workspaceSlug,
    '--project', opts.projectSlug,
    '--token', opts.token,
    '--input', opts.resultsPath,
    '--server', opts.server,
  ];

  // Log a redacted version so the token never lands in the output channel.
  const redactedArgs = args.map(a => (a === opts.token ? '****' : a));
  channel.appendLine(`$ npx ${redactedArgs.join(' ')}`);
  channel.appendLine(`  cwd: ${opts.cwd}`);

  return new Promise<number>((resolve) => {
    const child = spawn('npx', args, {
      cwd: opts.cwd,
      env: { ...process.env },
      shell: process.platform === 'win32',
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      channel.append(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      channel.append(chunk.toString());
    });
    child.on('error', (err) => {
      channel.appendLine(`\n[spawn error] ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function sendLastRun(context: vscode.ExtensionContext): Promise<void> {
  const channel = getOutputChannel();
  channel.show(true);

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Kensho: open a folder/workspace first.');
    return;
  }
  // For the scaffold, use the first workspace folder. A future iteration could
  // prompt when there are multiple roots.
  const cwd = folders[0].uri.fsPath;

  const config = vscode.workspace.getConfiguration('kaizen');
  const resultsPathSetting = config.get<string>('kenshoResultsPath') ?? './kensho-results';
  const workspaceSlug = (config.get<string>('workspace') ?? '').trim();
  const projectSlug = (config.get<string>('project') ?? '').trim();
  const server = (config.get<string>('server') ?? 'https://api.kaizenreport.com').trim();
  const kenshoVersion = (config.get<string>('kenshoVersion') ?? 'latest').trim();

  if (!workspaceSlug || !projectSlug) {
    vscode.window.showErrorMessage(
      'Kensho: set `kaizen.workspace` and `kaizen.project` in settings.',
    );
    return;
  }

  const token = await resolveToken(context);
  if (!token) {
    const pick = await vscode.window.showErrorMessage(
      'Kensho: no API token found. Store one in VS Code secret storage?',
      'Set token',
      'Cancel',
    );
    if (pick === 'Set token') {
      const entered = await vscode.window.showInputBox({
        title: 'Kaizen API token',
        prompt: 'Paste your kz_… token (stored in VS Code secret storage)',
        password: true,
        ignoreFocusOut: true,
      });
      if (entered && entered.length > 0) {
        await context.secrets.store(SECRET_KEY, entered);
        vscode.window.showInformationMessage('Kensho: token saved. Re-run the command.');
      }
    }
    return;
  }

  const resultsPath = path.isAbsolute(resultsPathSetting)
    ? resultsPathSetting
    : path.join(cwd, resultsPathSetting);

  if (!fs.existsSync(resultsPath)) {
    vscode.window.showErrorMessage(
      `Kensho: results directory not found at ${resultsPath}. Run your tests first.`,
    );
    return;
  }

  setStatus('$(cloud-upload) Kensho: Sending…', 'Uploading kensho-results to Kaizen');

  const code = await runKenshoPush({
    cwd,
    resultsPath,
    workspaceSlug,
    projectSlug,
    token,
    server,
    kenshoVersion,
  });

  if (code === 0) {
    setStatus('$(check) Kensho: Done', `Last upload to ${server} succeeded`);
    vscode.window.showInformationMessage('Kensho: run uploaded to Kaizen.');
  } else {
    setStatus('$(error) Kensho: Failed', `Last upload exited with code ${code} — see Output → Kensho`);
    vscode.window.showErrorMessage(
      `Kensho: upload failed (exit ${code}). See Output → Kensho for details.`,
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('kaizen.sendLastRun', () => sendLastRun(context)),
  );

  // Idle status: lets the user click the bar item to fire the command.
  setStatus('$(cloud-upload) Kensho', 'Click to send the latest run to Kaizen');
  context.subscriptions.push(getStatusBarItem());
}

export function deactivate(): void {
  outputChannel?.dispose();
  statusBarItem?.dispose();
}
