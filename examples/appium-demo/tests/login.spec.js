// Sample wdio + mocha test against an Appium-driven iOS simulator. Requires
// an Appium server running on :4723; otherwise use `pnpm run seed` for a
// fixture-driven run.

import { kensho } from '@kaizenreport/kensho-appium';

describe('Auth › Login', () => {
  it('@critical signs in with email + password', async () => {
    await kensho.step('Open login screen', async () => {
      await $('~Login').click();
    });
    await kensho.step('Enter credentials', async () => {
      await $('~username').setValue('demo@acme.io');
      await $('~password').setValue('hunter2');
    });
    await kensho.step('Tap Sign In', async () => {
      await $('~SignIn').click();
    });
    kensho.label('build', process.env.APP_VERSION || '4.12.3');
    kensho.link('https://acme.atlassian.net/browse/MOB-12', 'jira', 'MOB-12');
  });
});
