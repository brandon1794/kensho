// Sample wdio config for an Appium iOS run wired to the Kensho reporter.
// This file is illustrative — you need an Appium 2 server + an iOS simulator
// (or Android emulator) to actually execute it. The `pnpm run seed` script
// produces a kensho-results/ bundle without those dependencies for offline demos.

export const config = {
  runner: 'local',
  framework: 'mocha',
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  specs: ['./tests/**/*.spec.js'],
  capabilities: [{
    platformName: 'iOS',
    'appium:platformVersion': '17.4',
    'appium:deviceName': 'iPhone 15',
    'appium:automationName': 'XCUITest',
    'appium:app': '/path/to/Acme.app',
  }],
  reporters: [
    'spec',
    ['@kaizenreport/kensho-appium', {
      output: 'kensho-results',
      project: { name: 'Acme Mobile', slug: 'acme-mobile' },
      severityFromTag: true,
      captureCommands: true,
      screenshotOnFailure: true,
    }],
  ],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
};
