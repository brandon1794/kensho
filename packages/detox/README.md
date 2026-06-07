# @kaizenreport/kensho-detox

Kensho adapter for [Detox](https://wix.github.io/Detox/), the React Native E2E test framework. Detox runs on top of Jest, so this package is a Jest reporter that knows about Detox's lifecycle hooks (`device.takeScreenshot`, artifact directory layout, `DETOX_*` env vars).

## Install

```bash
pnpm add -D @kaizenreport/kensho-detox @kaizenreport/kensho
```

## Configure

```js
// e2e/jest.config.js
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
```

```js
// .detoxrc.js
module.exports = {
  configurations: {
    'ios.sim.debug': {
      device: { type: 'iPhone 15' },
      app: 'ios.debug',
    },
  },
  artifacts: {
    plugins: {
      screenshot: { keepOnlyFailedTestsArtifacts: true },
      video: 'failing',
    },
  },
};
```

Then:

```bash
detox build  --configuration ios.sim.debug
detox test   --configuration ios.sim.debug

npx kensho validate kensho-results
npx kensho generate
npx kensho open
```

## Helper API

```js
import { kensho } from '@kaizenreport/kensho-detox';

it('logs in', async () => {
  await kensho.step('Tap username field', async () => {
    await element(by.id('username')).tap();
  });
  await kensho.step('Type credentials',  async () => {
    await element(by.id('username')).typeText('demo');
    await element(by.id('password')).typeText('hunter2');
  });
  kensho.label('build', '4.12.3');
  kensho.link('https://acme.atlassian.net/browse/RN-44', 'jira', 'RN-44');
});
```

On failure, the reporter automatically pulls Detox's `test-failed-*.png` and any `.mp4` recording from `artifacts/` into `kensho-results/attachments/<caseId>/`.

## Schema mapping

| Detox / runtime                            | Kensho field                     |
| ------------------------------------------ | -------------------------------- |
| `process.env.DETOX_DEVICE_NAME`            | `case.labels.device`             |
| `process.env.DETOX_OS_VERSION`             | `case.labels.osVersion`          |
| `process.env.DETOX_APP_VERSION`            | `case.labels.appVersion`         |
| `process.env.DETOX_CONFIGURATION`          | `case.labels.configuration`      |
| `globalThis.detox.device.platform`         | `case.platform` + `case.labels.platform` |
| Jest `status`                              | `case.status`                    |
| `failureMessages[]`                        | `case.errors[]`                  |
| `kensho.step(name, fn)`                    | `case.steps[]`                   |
| `kensho.attach(path)`                      | `case.attachments[]`             |
| `kensho.label(k,v)` / `kensho.link(...)`   | `case.labels` / `case.links[]`   |
| `artifacts/**/test-failed-*.png|*.mp4`     | `case.attachments[]` (auto on fail) |

`framework.name = 'detox'`.

Set `DETOX_APP_VERSION=4.12.3` in CI to pin the app version into `case.labels.appVersion` and `run.env.appVersion`.
