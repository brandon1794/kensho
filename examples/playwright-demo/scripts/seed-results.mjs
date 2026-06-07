// Seeds kensho-results/ with realistic data by invoking the Kensho
// Playwright reporter with mocked test objects. Lets the repo demo run
// end-to-end without installing Playwright browsers.
//
// In a real project you'd just run `npx playwright test` with the reporter
// configured in playwright.config.ts and skip this script entirely.

import KenshoReporter from '@kaizenreport/kensho-playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const output = resolve(projectRoot, 'kensho-results');

// Clean previous run
try { rmSync(output, { recursive: true, force: true }); } catch {}

// ---------- Fixture attachments (real files on disk) ----------------------
const fixturesDir = resolve(projectRoot, 'fixtures');
mkdirSync(fixturesDir, { recursive: true });
const pngBytes = Buffer.from(
  // 1x1 transparent PNG
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);
const screenshotPath = resolve(fixturesDir, 'cart-failure.png');
writeFileSync(screenshotPath, pngBytes);

const tracePath = resolve(fixturesDir, 'cart-trace.zip');
writeFileSync(tracePath, Buffer.from('PK\x03\x04fake-zip-for-demo', 'binary'));

const logPath = resolve(fixturesDir, 'console.log');
writeFileSync(logPath, [
  '[page.goto] https://staging.acme.io/cart',
  '[page] loaded in 312 ms',
  '[page.fill] input[name="discount"] = SAVE20',
  '[page.click] button.apply-discount',
  '[page.waitFor] .cart-total',
  '[error] AssertionError: Expected "$64.00", received "$80.00"',
].join('\n'));

// ---------- Mock Playwright objects ---------------------------------------
function mockProject(name = 'chromium') {
  return { use: { browserName: name }, name };
}
function mockTest({ title, file, line, suiteChain, tags = [], annotations = [] }) {
  const parent = { project: () => mockProject(), title: suiteChain[suiteChain.length - 1] || '' };
  let root = parent;
  // Build parent chain so the reporter walks it correctly
  let chain = [...suiteChain].reverse();
  let cur = parent;
  for (let i = 1; i < chain.length; i++) {
    cur.parent = { title: chain[i], project: () => mockProject() };
    cur = cur.parent;
  }
  cur.parent = { title: '', project: () => mockProject() };
  return {
    title,
    parent,
    tags,
    annotations,
    location: { file, line },
    expectedStatus: 'passed',
  };
}
function mockStep(title, { action, duration = 150, status = 'pass', error } = {}) {
  const e = error ? {
    message: error.message,
    stack: error.stack,
    expected: error.expected,
    received: error.received,
    snippet: error.diff,
  } : undefined;
  return {
    title,
    category: action?.startsWith('expect') ? 'expect' : 'test.step',
    startTime: new Date(Date.now() - 1000 * Math.random() * 100).toISOString(),
    duration,
    steps: [],
    error: e,
  };
}
function mockResult({ status, duration, steps = [], attachments = [], errors = [], retry = 0, workerIndex = 0 }) {
  return {
    status, duration, retry, workerIndex,
    startTime: new Date(Date.now() - duration).toISOString(),
    steps, attachments, errors,
  };
}

// ---------- Build a realistic run ----------------------------------------
const reporter = new KenshoReporter({
  output,
  project: { name: 'Acme Web', slug: 'acme-web', url: 'https://github.com/acme/acme-web' },
  severityFromTag: true,
  runId: 'run_2026042502',
});

reporter.onBegin({ version: '1.44.0' }, { allTests: () => new Array(10).fill(0) });

const cases = [
  {
    title: 'adds item to cart',
    file: 'tests/checkout/cart.spec.ts', line: 14,
    suiteChain: ['Checkout', 'Cart'],
    tags: ['@critical', '@smoke'],
    annotations: [{ type: 'owner', description: '@mchen' }, { type: 'jira', description: 'ACME-1201' }],
    result: {
      status: 'passed', duration: 842, workerIndex: 0,
      steps: [
        mockStep('Open /cart', { action: 'page.goto', duration: 312 }),
        mockStep('Click "Add to cart"', { action: 'page.click', duration: 168 }),
        mockStep('Expect cart-count = 1', { action: 'expect', duration: 362 }),
      ],
    },
  },
  {
    title: 'applies promo code SAVE20',
    file: 'tests/checkout/cart.spec.ts', line: 28,
    suiteChain: ['Checkout', 'Cart'],
    tags: ['@blocker'],
    annotations: [{ type: 'owner', description: '@mchen' }, { type: 'jira', description: 'ACME-1234' }],
    result: {
      status: 'failed', duration: 2044, workerIndex: 1,
      steps: [
        mockStep('Open /cart with 3 items',       { action: 'page.goto', duration: 312 }),
        mockStep('Fill input[name="discount"]',    { action: 'page.fill', duration: 88 }),
        mockStep('Click button.apply-discount',    { action: 'page.click', duration: 24 }),
        mockStep('Expect .cart-total = "$64.00"', {
          action: 'expect', duration: 1620, status: 'fail',
          error: {
            message: 'expect(locator).toHaveText(expected)\n\nExpected string: "$64.00"\nReceived string: "$80.00"',
            stack: 'at CartPage.getTotal (cart.spec.ts:42:18)\n    at Object.<anonymous> (cart.spec.ts:28:5)',
            expected: '$64.00', received: '$80.00',
            diff: '- "$64.00"\n+ "$80.00"',
          },
        }),
      ],
      attachments: [
        { name: 'screenshot', path: screenshotPath, contentType: 'image/png' },
        { name: 'trace',      path: tracePath,      contentType: 'application/zip' },
        { name: 'log',        path: logPath,        contentType: 'text/plain' },
      ],
      errors: [{
        message: 'AssertionError: Expected "$64.00", received "$80.00"',
        stack: 'at CartPage.getTotal (cart.spec.ts:42:18)\n    at Object.<anonymous> (cart.spec.ts:28:5)',
        name: 'AssertionError',
      }],
    },
  },
  {
    title: 'clears cart with "Empty" button',
    file: 'tests/checkout/cart.spec.ts', line: 46,
    suiteChain: ['Checkout', 'Cart'],
    tags: ['@minor'],
    result: {
      status: 'passed', duration: 512, workerIndex: 0,
      steps: [
        mockStep('Open /cart', { action: 'page.goto', duration: 260 }),
        mockStep('Click "Empty"', { action: 'page.click', duration: 120 }),
        mockStep('Expect cart-count = 0', { action: 'expect', duration: 132 }),
      ],
    },
  },
  {
    title: 'signs in via Google SSO',
    file: 'tests/auth/sso.spec.ts', line: 12,
    suiteChain: ['Auth', 'SSO'],
    tags: ['@critical'],
    annotations: [{ type: 'owner', description: '@jlim' }],
    result: {
      status: 'passed', duration: 3210, workerIndex: 2,
      steps: [
        mockStep('Open /login', { action: 'page.goto', duration: 420 }),
        mockStep('Click "Continue with Google"', { action: 'page.click', duration: 112 }),
        mockStep('Expect URL matches /dashboard/', { action: 'expect', duration: 2678 }),
      ],
    },
  },
  {
    title: 'signs in via Okta SAML',
    file: 'tests/auth/sso.spec.ts', line: 38,
    suiteChain: ['Auth', 'SSO'],
    tags: ['@critical'],
    annotations: [{ type: 'owner', description: '@jlim' }],
    result: {
      status: 'failed', duration: 5140, workerIndex: 2, retry: 1,
      steps: [
        mockStep('Open /login',                          { action: 'page.goto',  duration: 288 }),
        mockStep('Click "Continue with Okta"',           { action: 'page.click', duration: 94 }),
        mockStep('Wait for /auth/okta/callback',         { action: 'page.waitForURL', duration: 4720, status: 'fail',
          error: { message: 'Timeout 5000ms exceeded.\nwaiting for URL matching /\\/auth\\/okta\\/callback/' } }),
      ],
      errors: [{ message: 'TimeoutError: Timeout 5000ms exceeded while waiting for navigation', name: 'TimeoutError' }],
    },
  },
  {
    title: 'enforces 2FA with TOTP code',
    file: 'tests/auth/2fa.spec.ts', line: 8,
    suiteChain: ['Auth', '2FA'],
    tags: ['@normal'],
    result: {
      status: 'passed', duration: 1200, workerIndex: 0,
      steps: [
        mockStep('Open /login',   { action: 'page.goto',  duration: 300 }),
        mockStep('Enter TOTP code',{ action: 'page.fill', duration: 90 }),
        mockStep('Expect dashboard visible', { action: 'expect', duration: 810 }),
      ],
    },
  },
  {
    title: 'handles 3DS challenge modal',
    file: 'tests/checkout/payment.spec.ts', line: 18,
    suiteChain: ['Checkout', 'Payment'],
    tags: ['@normal'],
    annotations: [{ type: 'owner', description: '@sgarcia' }],
    result: {
      status: 'passed', duration: 4200, workerIndex: 1,
      steps: [
        mockStep('Open /checkout', { action: 'page.goto', duration: 480 }),
        mockStep('Fill card number', { action: 'page.fill', duration: 220 }),
        mockStep('Click Pay',         { action: 'page.click', duration: 140 }),
        mockStep('Accept 3DS',        { action: 'page.click', duration: 2800 }),
        mockStep('Expect receipt',    { action: 'expect', duration: 560 }),
      ],
    },
  },
  {
    title: 'computes EU VAT for German address',
    file: 'tests/checkout/payment.spec.ts', line: 62,
    suiteChain: ['Checkout', 'Payment'],
    tags: ['@critical'],
    annotations: [{ type: 'owner', description: '@rchen' }],
    result: {
      status: 'failed', duration: 1820, workerIndex: 1,
      steps: [
        mockStep('Open /checkout', { action: 'page.goto', duration: 420 }),
        mockStep('Set address = DE', { action: 'page.selectOption', duration: 140 }),
        mockStep('Expect VAT = 19%', { action: 'expect', duration: 1260, status: 'fail',
          error: { message: 'Expected 19%, received 18.97%', expected: '19%', received: '18.97%' } }),
      ],
      errors: [{ message: 'AssertionError: VAT rounding off by 0.03%', name: 'AssertionError' }],
    },
  },
  {
    title: 'renders product variants',
    file: 'tests/catalog/pdp.spec.ts', line: 4,
    suiteChain: ['Catalog', 'PDP'],
    tags: ['@minor'],
    result: {
      status: 'passed', duration: 820, workerIndex: 2,
      steps: [ mockStep('Open /p/sku-123', { action: 'page.goto', duration: 340 }),
               mockStep('Expect variants visible', { action: 'expect', duration: 480 }) ],
    },
  },
  {
    title: 'infinite scroll loads next page',
    file: 'tests/catalog/list.spec.ts', line: 16,
    suiteChain: ['Catalog', 'List'],
    tags: ['@trivial'],
    result: { status: 'skipped', duration: 0, workerIndex: 0, steps: [] },
  },
];

for (const c of cases) {
  reporter.onTestEnd(mockTest(c), mockResult(c.result));
}

await reporter.onEnd({ status: 'failed' });
console.log(`[seed] wrote ${cases.length} cases`);
