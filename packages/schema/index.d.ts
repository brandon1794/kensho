/**
 * Kensho v1 — canonical test-result format.
 *
 * A KenshoRun is what every adapter emits. The generator and the
 * KaizenReport platform both consume this shape directly.
 */

export const SCHEMA_VERSION: 'kensho/v1';

export type Status = 'pass' | 'fail' | 'broken' | 'skip';
export type StepStatus = 'pass' | 'fail' | 'skip';
export type Severity = 'blocker' | 'critical' | 'normal' | 'minor' | 'trivial';
export type AttachmentKind =
  | 'screenshot' | 'video' | 'trace' | 'har' | 'text'
  | 'json' | 'html' | 'dom-snapshot' | 'log';

export interface KenshoRun {
  schemaVersion: 'kensho/v1';
  id: string;
  project: { name: string; slug: string; url?: string };
  framework: { name: string; version: string };
  env?: {
    ci?: 'github-actions' | 'circleci' | 'gitlab' | 'jenkins' | 'buildkite' | 'azure-devops' | 'local' | 'unknown';
    branch?: string; commit?: string; commitMsg?: string; author?: string; runUrl?: string; repoUrl?: string;
    os?: string; osVersion?: string; arch?: string;
    nodeVersion?: string; pythonVersion?: string;
    browsers?: string[]; workers?: number;
    /** Target environment: dev, qa, staging, preprod, prod, sandbox, etc. */
    stage?: string;
    /** App URL the run targeted (e.g. https://staging.example.com) */
    baseUrl?: string;
    /** Version of the system-under-test (e.g. 4.12.3) */
    appVersion?: string;
    buildNumber?: string;
    /** Release tag/Jira fix-version (e.g. R-2026.04.25) */
    release?: string;
    /** Device model when relevant (e.g. Pixel 8, iPhone 15 Pro) */
    device?: string;
    /** Viewport size (e.g. 1440x900, 390x844) */
    viewport?: string;
    /** Geographic region (e.g. us-east-1, eu-west-2) */
    region?: string;
    /** Locale (e.g. en-US, es-ES) */
    locale?: string;
    timezone?: string;
    /** Tunnel/grid info (BrowserStack, Sauce Labs, Selenium grid URL) */
    tunnel?: string;
    /** What kicked off the run (push, pull_request, schedule, manual) */
    trigger?: string;
    /** Feature flag bundle / experiment cohort active during the run */
    feature?: string;
    /** Open-ended bag for any custom string variables not covered above. */
    vars?: Record<string, string>;
  };
  startedAt: string;
  finishedAt: string;
  totals: { pass: number; fail: number; broken: number; skip: number; flaky?: number };
  durationMs?: number;
  testCases: KenshoCase[];
  categories?: KenshoCategory[];
  /** External links surfaced on the run header (Jira fix-version, runbook, PR, dashboard…). */
  links?: KenshoLink[];
}

/** External link surfaced as a clickable chip on a run or test case. */
export interface KenshoLink {
  /** Free-form: 'jira' | 'github' | 'gitlab' | 'linear' | 'slack' | 'doc' | 'runbook' | 'pr' | 'other' */
  kind?: string;
  url: string;
  /** Human label, e.g. 'PROJ-123' or 'Runbook'. If omitted, the URL host or last segment is shown. */
  label?: string;
}

export interface KenshoCase {
  id: string;
  name: string;
  fullName: string;
  filePath?: string;
  line?: number;
  suite?: string[];
  tags?: string[];
  severity?: Severity;
  owner?: string;
  labels?: Record<string, string>;
  status: Status;
  startedAt: string;
  finishedAt?: string;
  duration: number;
  retryOf?: string;
  retries?: number;
  browser?: string;
  platform?: string;
  worker?: number;
  steps?: KenshoStep[];
  errors?: KenshoError[];
  attachments?: KenshoAttachment[];
  logs?: KenshoLog[];
  behavior?: { epic?: string; feature?: string; scenario?: string; gherkin?: string[] };
  parameters?: KenshoParameter[];
  description?: string;
  history?: KenshoHistoryEntry[];
  /** External links — Jira tickets, runbooks, design docs, PRs — chip-rendered. */
  links?: KenshoLink[];
  /** Explicitly marked flaky (kensho.flaky()). Viewer shows a flaky badge. */
  flaky?: boolean;
  /** Known failure / muted (kensho.muted() / kensho.knownIssue()). A muted fail
   *  doesn't count against the pass gate; pair with a kind:'issue' link. */
  muted?: boolean;
  /** Failure category bucket (config rule or generator auto-clustering). */
  category?: string;
  /** Source context around the failure, captured by the generator from filePath:line. */
  sourceSnippet?: {
    file?: string;
    line?: number;
    lang?: string;
    lines: { n: number; text: string; isError?: boolean }[];
  };
}

export interface KenshoParameter {
  name: string;
  value: string;
  hidden?: boolean;
  kind?: 'argument' | 'context' | 'env' | 'data-row';
}

export interface KenshoHistoryEntry {
  runId: string;
  status: Status;
  startedAt: string;
  duration?: number;
  commit?: string;
  branch?: string;
}

export interface KenshoStep {
  id: string;
  title: string;
  action?: string;
  target?: string;
  status: StepStatus;
  startedAt: string;
  duration: number;
  phase?: 'setup' | 'body' | 'teardown';
  logs?: KenshoLog[];
  network?: KenshoNetworkEntry[];
  parameters?: KenshoParameter[];
  attachments?: KenshoAttachment[];
  assertion?: { expected?: unknown; received?: unknown; diff?: string; stack?: string };
  dom?: { beforeRef?: string; afterRef?: string };
  children?: KenshoStep[];
}

export interface KenshoAttachment {
  id: string;
  kind: AttachmentKind;
  relativePath: string;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  thumbnailRef?: string;
  meta?: Record<string, unknown>;
}

export interface KenshoLog {
  t: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
}

export interface KenshoNetworkEntry {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  sizeBytes?: number;
  requestBody?: string;
  responseBody?: string;
}

export interface KenshoError {
  message: string;
  stack?: string;
  type?: string;
}

export interface KenshoCategory {
  name: string;
  matchMessage?: string;
  matchStatus?: 'fail' | 'broken';
  description?: string;
}

export function validateRun(run: unknown): { ok: boolean; errors: string[] };
export function emptyRun(opts?: Partial<Pick<KenshoRun, 'id' | 'project' | 'framework' | 'env' | 'startedAt'>>): KenshoRun;
export function computeTotals(cases: Pick<KenshoCase, 'status'>[]): KenshoRun['totals'];
export function stableCaseId(fullName: string, filePath?: string): string;
export function envInfo(env?: NodeJS.ProcessEnv): KenshoRun['env'];
export function deriveRepoUrl(env?: NodeJS.ProcessEnv): string | undefined;
export function deriveRunUrl(env?: NodeJS.ProcessEnv): string | undefined;
export const schema: object;
export const STATUS: readonly Status[];
export const STEP_STATUS: readonly StepStatus[];
export const SEVERITY: readonly Severity[];
export const ATTACHMENT_KINDS: readonly AttachmentKind[];
