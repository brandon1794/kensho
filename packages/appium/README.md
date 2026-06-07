# @kaizenreport/kensho-appium

Kensho adapter for [Appium](https://appium.io/) — emits the canonical [Kensho v1](../schema) JSON so the Kensho CLI can build a static HTML report from your iOS + Android mobile test runs.

Two integration paths cover the common Appium setups:

1. **WebdriverIO reporter** — drop into `wdio.conf.js` and ride on top of mocha / jasmine / cucumber.
2. **Generic Node hook** — call `KenshoAppiumSession` lifecycle methods from any framework (mocha / jest / jasmine) using the raw Appium client directly.

Both share the same `kensho.step / attach / label / link` helper API.

## Install

```bash
pnpm add -D @kaizenreport/kensho-appium @kaizenreport/kensho
```

Peer deps `webdriverio` and `@wdio/reporter` are required only if you use path 1.

## Path 1 — WebdriverIO reporter

```js
// wdio.conf.js
export const config = {
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
      severityFromTag: true,           // @blocker / @critical / @normal / @minor / @trivial
      captureCommands: true,           // emit each Appium command as a Kensho step
      screenshotOnFailure: true,
    }],
  ],
};
```

Run as usual:

```bash
npx wdio run wdio.conf.js
npx kensho generate
npx kensho open
```

## Path 2 — Generic Node hook (mocha / jest / jasmine + raw appium client)

```js
import { remote } from 'webdriverio';
import { kensho, KenshoAppiumSession } from '@kaizenreport/kensho-appium';

const capabilities = {
  platformName: 'Android',
  'appium:platformVersion': '14',
  'appium:deviceName': 'Pixel 8',
  'appium:automationName': 'UiAutomator2',
  'appium:app': '/path/to/acme.apk',
};

const session = new KenshoAppiumSession({
  project: { name: 'Acme Mobile', slug: 'acme-mobile' },
  capabilities,
});

before(async () => { session.beforeAll(); });
after(()  => { session.afterAll(); });
beforeEach(function () { session.wrapTest(this.currentTest); });
afterEach(function ()  { session.endTest(this.currentTest); });

it('logs in', async function () {
  await kensho.step('Tap username field', async () => { /* ... */ });
  await kensho.step('Type credentials',    async () => { /* ... */ });
  kensho.label('build', '4.12.3');
  kensho.link('https://acme.atlassian.net/browse/MOB-12', 'jira', 'MOB-12');
});
```

## What gets captured

| Appium / WDIO data                                      | Kensho field                |
| -------------------------------------------------------- | --------------------------- |
| `capabilities.platformName`                              | `case.labels.platform`      |
| `capabilities.platformVersion`                           | `case.labels.osVersion` + `run.env.osVersion` |
| `capabilities.deviceName`                                | `case.labels.device` + `run.env.device` |
| `capabilities.automationName`                            | `case.labels.automationName` |
| `capabilities.app` / `bundleId` / `appPackage`           | `case.labels.app` / `bundleId` / `appPackage` |
| `process.env.APP_VERSION`                                | `run.env.appVersion`        |
| Each Appium command (`onAfterCommand`)                   | one `case.steps[]` entry    |
| `kensho.step(name, fn)` blocks                           | `case.steps[]` (sub-steps via nesting) |
| `kensho.attach(path)`                                    | `case.attachments[]` (copied to `attachments/<caseId>/`) |
| `kensho.label(k,v)`                                      | `case.labels.k`             |
| `kensho.link(url, kind, label)`                          | `case.links[]`              |
| Screenshot on test failure (when enabled)                | `case.attachments[]`        |

Tags `@blocker / @critical / @normal / @minor / @trivial` map to `case.severity` when `severityFromTag` is on.

## Schema mapping summary

- `framework.name = 'appium'`
- `case.platform = "iOS 17.4"` style
- `case.labels.device = 'iPhone 15'`
- `case.labels.osVersion = '17.4'`
- `case.labels.automationName = 'XCUITest'`
- `run.env.appVersion = process.env.APP_VERSION` (override per-run with `APP_VERSION=4.12.3 npx wdio …`)
