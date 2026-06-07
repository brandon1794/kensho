// Sample Detox config. You'll need a real RN build + iOS simulator to actually
// run `detox test`; see `scripts/seed-results.mjs` for a self-contained demo.
module.exports = {
  testRunner: { args: { $0: 'jest', config: 'e2e/jest.config.js' } },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/AcmeRN.app',
      build: 'xcodebuild -workspace ios/AcmeRN.xcworkspace -scheme AcmeRN -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { type: 'iPhone 15' } },
  },
  configurations: {
    'ios.sim.debug': { device: 'simulator', app: 'ios.debug' },
  },
  artifacts: {
    plugins: {
      screenshot: { keepOnlyFailedTestsArtifacts: true },
      video: 'failing',
    },
  },
};
