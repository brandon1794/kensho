// Sample Detox + Jest test wired to the Kensho helper API.
// Requires `detox build` + `detox test` to run for real.

import { kensho } from '@kaizenreport/kensho-detox';

describe('Auth › Login', () => {
  beforeAll(async () => { await device.launchApp(); });

  it('@critical signs in with valid credentials', async () => {
    await kensho.step('Tap username field', async () => {
      await element(by.id('username')).tap();
    });
    await kensho.step('Type credentials', async () => {
      await element(by.id('username')).typeText('demo@acme.io');
      await element(by.id('password')).typeText('hunter2');
    });
    await kensho.step('Tap Sign In', async () => {
      await element(by.id('signin')).tap();
    });
    await expect(element(by.id('dashboard'))).toBeVisible();

    kensho.label('build', process.env.DETOX_APP_VERSION || '4.12.3');
    kensho.link('https://acme.atlassian.net/browse/RN-44', 'jira', 'RN-44');
  });
});
