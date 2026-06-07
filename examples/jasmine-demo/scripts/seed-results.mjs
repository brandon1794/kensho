// Seeds kensho-results/ by exercising the reporter with mocked Jasmine
// events. Lets the demo work even if `jasmine` isn't installed yet.

import KenshoJasmineReporter, { kensho } from '@kaizenreport/kensho-jasmine';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
process.chdir(projectRoot);

const output = resolve(projectRoot, 'kensho-results');
try { rmSync(output, { recursive: true, force: true }); } catch {}

// Realistic fixture attachment.
const fixturesDir = resolve(projectRoot, 'fixtures');
mkdirSync(fixturesDir, { recursive: true });
const screenshotPath = resolve(fixturesDir, 'cart-failure.png');
writeFileSync(
  screenshotPath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const reporter = new KenshoJasmineReporter({
  output,
  project: { name: 'Acme Web (Jasmine)', slug: 'acme-web-jasmine' },
  severityFromTag: true,
  runId: 'run_jasmine_demo',
  filePath: 'spec/cart.spec.mjs',
});

reporter.jasmineStarted({});

reporter.suiteStarted({ id: 'suite0', description: 'Checkout' });
reporter.suiteStarted({ id: 'suite1', description: 'Cart' });

// Spec 1: passing with helper steps.
reporter.specStarted({ id: 'spec1', description: '@critical adds item to cart', fullName: 'Checkout Cart @critical adds item to cart' });
await kensho.step('open /cart', async () => { await sleep(5); });
await kensho.step('click "Add to cart"', async () => { await sleep(3); });
kensho.label('team', 'growth');
kensho.link('https://jira.example.com/browse/ACME-1201', { kind: 'jira', label: 'ACME-1201' });
console.log('cart count = 1');
reporter.specDone({
  id: 'spec1',
  description: '@critical adds item to cart',
  fullName: 'Checkout Cart @critical adds item to cart',
  status: 'passed',
  passedExpectations: [{ matcherName: 'toBe' }],
  failedExpectations: [],
});

// Spec 2: failing.
reporter.specStarted({ id: 'spec2', description: '@blocker applies promo code SAVE20', fullName: 'Checkout Cart @blocker applies promo code SAVE20' });
await kensho.step('open /cart with 3 items', async () => { await sleep(4); });
await kensho.step('apply discount', async () => {
  await kensho.step('fill input[name="discount"]', async () => { await sleep(2); });
  // we don't throw — let the assertion flow surface the failure too
});
kensho.attach(screenshotPath, { kind: 'screenshot' });
reporter.specDone({
  id: 'spec2',
  description: '@blocker applies promo code SAVE20',
  fullName: 'Checkout Cart @blocker applies promo code SAVE20',
  status: 'failed',
  passedExpectations: [],
  failedExpectations: [{
    matcherName: 'toBe',
    message: 'Expected "$80.00" to be "$64.00".',
    expected: '$64.00',
    actual: '$80.00',
    stack: 'Error: Expected "$80.00" to be "$64.00".\n    at <Jasmine>\n    at cart.spec.mjs:24',
  }],
});

// Spec 3: passing minor.
reporter.specStarted({ id: 'spec3', description: '@minor empties the cart', fullName: 'Checkout Cart @minor empties the cart' });
console.log('clearing cart for demo');
reporter.specDone({
  id: 'spec3',
  description: '@minor empties the cart',
  fullName: 'Checkout Cart @minor empties the cart',
  status: 'passed',
  passedExpectations: [{ matcherName: 'toEqual' }],
  failedExpectations: [],
});

// Spec 4: excluded (xit).
reporter.specStarted({ id: 'spec4', description: 'infinite scroll loads next page', fullName: 'Checkout Cart infinite scroll loads next page' });
reporter.specDone({
  id: 'spec4',
  description: 'infinite scroll loads next page',
  fullName: 'Checkout Cart infinite scroll loads next page',
  status: 'excluded',
  passedExpectations: [],
  failedExpectations: [],
});

reporter.suiteDone({ id: 'suite1', description: 'Cart' });
reporter.suiteDone({ id: 'suite0', description: 'Checkout' });

reporter.suiteStarted({ id: 'suite2', description: 'Auth' });

// Spec 5: passing.
reporter.specStarted({ id: 'spec5', description: '@critical signs in via Google SSO', fullName: 'Auth @critical signs in via Google SSO' });
reporter.specDone({
  id: 'spec5',
  description: '@critical signs in via Google SSO',
  fullName: 'Auth @critical signs in via Google SSO',
  status: 'passed',
  passedExpectations: [{ matcherName: 'toContain' }],
  failedExpectations: [],
});

// Spec 6: pending with severity hint.
reporter.specStarted({ id: 'spec6', description: 'signs in via Okta SAML', fullName: 'Auth signs in via Okta SAML' });
reporter.specDone({
  id: 'spec6',
  description: 'signs in via Okta SAML',
  fullName: 'Auth signs in via Okta SAML',
  status: 'pending',
  pendingReason: 'blocker reason: Okta sandbox unavailable',
  passedExpectations: [],
  failedExpectations: [],
});

reporter.suiteDone({ id: 'suite2', description: 'Auth' });

reporter.jasmineDone({});

console.log('[seed] wrote jasmine-demo kensho-results');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
