// Seed kensho-results/ for the Appium demo by feeding the reporter mocked
// wdio events. Lets the demo work end-to-end without a real iOS simulator
// + Appium server (which would be required for `pnpm run wdio`).

import KenshoAppiumReporter from '@kaizenreport/kensho-appium';
import { kensho } from '@kaizenreport/kensho-appium';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const output = resolve(projectRoot, 'kensho-results');

try { rmSync(output, { recursive: true, force: true }); } catch {}

// Tiny PNG fixture for screenshot-on-failure.
const fixturesDir = resolve(projectRoot, 'fixtures');
mkdirSync(fixturesDir, { recursive: true });
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);
const screenshotPath = resolve(fixturesDir, 'login-fail.png');
writeFileSync(screenshotPath, pngBytes);

// ---------- Drive the reporter -------------------------------------------

const reporter = new KenshoAppiumReporter({
  output,
  project: { name: 'Acme Mobile', slug: 'acme-mobile', url: 'https://github.com/acme/acme-mobile' },
  severityFromTag: true,
  captureCommands: true,
  runId: 'run_2026042700',
});

const iosCaps = {
  platformName: 'iOS',
  platformVersion: '17.4',
  deviceName: 'iPhone 15',
  automationName: 'XCUITest',
  app: '/builds/Acme.app',
  bundleId: 'io.acme.app',
};

reporter.onRunnerStart({
  capabilities: iosCaps,
  config: { capabilities: iosCaps, appiumVersion: '2.5.4' },
});

function fakeCommand(reporter, command, body, durationMs) {
  const c = { command, body };
  reporter.onBeforeCommand(c);
  c.__kStart = Date.now() - durationMs;
  reporter.onAfterCommand(c);
}

async function runCase({ suite, title, file, tags, run }) {
  for (const s of suite) reporter.onSuiteStart({ title: s });
  reporter.onTestStart({ title, file, tags });
  await run();
  reporter.onTestEnd({ title, file, tags, state: 'passed', duration: 1200, ...((globalThis.__kFinalize__) || {}) });
  for (let i = suite.length - 1; i >= 0; i--) reporter.onSuiteEnd({ title: suite[i] });
}

// Test 1 — pass with realistic WDIO commands captured as steps.
await runCase({
  suite: ['Auth', 'Login'],
  title: 'signs in with email + password @critical',
  file: 'tests/auth/login.spec.js',
  tags: ['@critical', '@smoke'],
  run: async () => {
    fakeCommand(reporter, 'findElement',  { using: 'accessibility id', value: 'username' }, 90);
    fakeCommand(reporter, 'click',        {}, 60);
    fakeCommand(reporter, 'sendKeys',     { text: 'demo@acme.io' }, 80);
    fakeCommand(reporter, 'findElement',  { using: 'accessibility id', value: 'password' }, 70);
    fakeCommand(reporter, 'sendKeys',     { text: '••••••' }, 65);
    fakeCommand(reporter, 'click',        {}, 55);
    await kensho.step('Wait for dashboard', async () => {});
    kensho.label('build', '4.12.3');
    kensho.link('https://acme.atlassian.net/browse/MOB-12', 'jira', 'MOB-12');
  },
});

// Test 2 — pass with grouped helper steps.
await runCase({
  suite: ['Cart', 'Checkout'],
  title: 'adds an item and goes to checkout @normal',
  file: 'tests/cart/checkout.spec.js',
  tags: ['@normal'],
  run: async () => {
    await kensho.step('Open product list', async () => {
      fakeCommand(reporter, 'findElement', { using: 'accessibility id', value: 'tab.shop' }, 50);
      fakeCommand(reporter, 'click',       {}, 60);
    });
    await kensho.step('Add SKU-123 to cart', async () => {
      fakeCommand(reporter, 'findElement', { using: 'accessibility id', value: 'sku-123' }, 70);
      fakeCommand(reporter, 'click',       {}, 80);
    });
    await kensho.step('Open checkout', async () => {
      fakeCommand(reporter, 'click',       {}, 60);
    });
  },
});

// Test 3 — fail with a screenshot attached.
reporter.onSuiteStart({ title: 'Payments' });
reporter.onTestStart({ title: 'declines invalid card @blocker', file: 'tests/payments/card.spec.js', tags: ['@blocker'] });

fakeCommand(reporter, 'findElement', { using: 'accessibility id', value: 'card-number' }, 60);
fakeCommand(reporter, 'sendKeys',    { text: '4242 4242 4242 4242' }, 90);
fakeCommand(reporter, 'click',       {}, 50);
await kensho.step('Submit form', async () => {
  fakeCommand(reporter, 'click', {}, 70);
});
kensho.attach(screenshotPath, 'screenshot');

reporter.onTestEnd({
  title: 'declines invalid card @blocker',
  file: 'tests/payments/card.spec.js',
  tags: ['@blocker'],
  state: 'failed',
  duration: 2330,
  error: { message: 'expected toast "Card declined" but saw "Network error"', stack: 'at card.spec.js:48:7', name: 'AssertionError' },
});
reporter.onSuiteEnd({});

// Test 4 — skip.
reporter.onSuiteStart({ title: 'Settings' });
reporter.onTestStart({ title: 'biometric prompt @minor', file: 'tests/settings/biometric.spec.js', tags: ['@minor'] });
reporter.onTestEnd({ title: 'biometric prompt @minor', file: 'tests/settings/biometric.spec.js', tags: ['@minor'], state: 'pending', duration: 0 });
reporter.onSuiteEnd({});

process.env.APP_VERSION = '4.12.3';
reporter.onRunnerEnd();
console.log('[seed] appium-demo kensho-results/ written to', output);
