// Registers the Kensho reporter with Jasmine's global env. This runs before
// the spec files are loaded.

import KenshoJasmineReporter from '@kaizenreport/kensho-jasmine';

jasmine.getEnv().addReporter(new KenshoJasmineReporter({
  output: 'kensho-results',
  project: { name: 'Acme Web (Jasmine)', slug: 'acme-web-jasmine' },
  severityFromTag: true,
}));
