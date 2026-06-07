// Drive the Detox Kensho reporter with mocked Jest events so the demo runs
// without an actual iOS simulator + Detox build. In a real project this is
// replaced by `detox test` running Jest with the reporter wired in
// `e2e/jest.config.js`.

import KenshoDetoxReporter, { kensho } from '@kaizenreport/kensho-detox';
import { mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const output = resolve(projectRoot, 'kensho-results');
const artifacts = resolve(projectRoot, 'artifacts');

try { rmSync(output, { recursive: true, force: true }); } catch {}
mkdirSync(artifacts, { recursive: true });

// Detox-style failure artifact path that the reporter scans for. Slug derived
// from the failing test's fullName by collapsing non-alnum to '_'.
const failureSlug = 'Auth_Login_rejects_invalid_password';
const detoxArtifactDir = resolve(artifacts, 'ios.sim.debug', failureSlug);
mkdirSync(detoxArtifactDir, { recursive: true });
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(resolve(detoxArtifactDir, 'test-failed-screenshot-1.png'), pngBytes);

// Pretend Detox set its env vars.
process.env.DETOX_DEVICE_NAME = 'iPhone 15 Pro';
process.env.DETOX_OS_VERSION = '17.4';
process.env.DETOX_APP_VERSION = '4.12.3';
process.env.DETOX_CONFIGURATION = 'ios.sim.debug';
process.env.DETOX_VERSION = '20.18.1';

const reporter = new KenshoDetoxReporter({}, {
  output,
  project: { name: 'Acme RN', slug: 'acme-rn', url: 'https://github.com/acme/acme-rn' },
  severityFromTag: true,
  screenshotsDir: 'artifacts',
});

// Helper to feed Jest-style results into the reporter.
function jestResult({ filePath, results }) {
  return {
    testFilePath: resolve(projectRoot, filePath),
    perfStats: { start: Date.now() - 30_000 },
    testResults: results.map(r => ({
      title: r.title,
      fullName: r.fullName,
      ancestorTitles: r.ancestorTitles || [],
      status: r.status,
      duration: r.duration,
      failureMessages: r.failureMessages || [],
      invocations: r.invocations || 1,
      location: r.location,
    })),
  };
}

// Drive the Jest reporter directly with two test files' worth of results.
// In a real Detox run, jest-circus would hook into the reporter and call
// onTestResult per file; here we feed it synthetic test outcomes that mirror
// what `device.takeScreenshot()` and `kensho.step(...)` would have produced.
void kensho; // keep the helper import alive (real tests would call it)
reporter.onTestResult({}, jestResult({
  filePath: 'e2e/login.test.js',
  results: [
    {
      title: 'signs in with valid credentials',
      fullName: 'Auth › Login signs in with valid credentials',
      ancestorTitles: ['Auth', 'Login'],
      status: 'passed',
      duration: 4321,
      location: { line: 8 },
    },
    {
      title: 'rejects invalid password',
      fullName: 'Auth › Login rejects invalid password',
      ancestorTitles: ['Auth', 'Login'],
      status: 'failed',
      duration: 5240,
      failureMessages: [
        'Error: Expected "/dashboard" but got "/login?error=invalid"\n    at login.test.js:33:10',
      ],
      location: { line: 28 },
    },
  ],
}));

reporter.onTestResult({}, jestResult({
  filePath: 'e2e/cart.test.js',
  results: [
    {
      title: 'adds an item to the cart',
      fullName: 'Cart › Items adds an item to the cart',
      ancestorTitles: ['Cart', 'Items'],
      status: 'passed',
      duration: 2110,
      location: { line: 4 },
    },
    {
      title: 'skipped on tablet sizing',
      fullName: 'Cart › Items skipped on tablet sizing',
      ancestorTitles: ['Cart', 'Items'],
      status: 'pending',
      duration: 0,
      location: { line: 22 },
    },
  ],
}));

reporter.onRunComplete({}, {});
console.log('[seed] detox-demo kensho-results/ written to', output);
