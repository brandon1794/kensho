/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.js'],
  testTimeout: 120_000,
  maxWorkers: 1,
  reporters: [
    'detox/runners/jest/streamlineReporter',
    ['@kaizenreport/kensho-detox', {
      output: 'kensho-results',
      project: { name: 'Acme RN', slug: 'acme-rn' },
      severityFromTag: true,
      screenshotsDir: 'artifacts',
    }],
  ],
};
