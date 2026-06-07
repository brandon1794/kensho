// Example Playwright config using the Kensho reporter.
// Only referenced by `npx playwright test` — the demo in this repo uses
// scripts/seed-results.mjs to produce realistic data without needing
// browsers installed.

export default {
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  reporter: [
    ['line'],
    ['@kaizenreport/kensho-playwright', {
      output: 'kensho-results',
      project: { name: 'Acme Web', slug: 'acme-web', url: 'https://github.com/acme/acme-web' },
      severityFromTag: true,
    }],
  ],
  use: {
    baseURL: 'https://staging.acme.io',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit',   use: { browserName: 'webkit'   } },
  ],
};
