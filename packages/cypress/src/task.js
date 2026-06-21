// @kaizenreport/kensho-cypress — Cypress setupNodeEvents task registration.
//
// The browser-side `kensho.*` API (./annotations.js) ships per-test records to
// Node via cy.task('kensho:annotations', record). This module registers that
// task so it can persist a sidecar the Mocha reporter later merges.
//
// Usage in cypress.config.js:
//
//   const { registerKenshoTasks } = require('@kaizenreport/kensho-cypress/task');
//   module.exports = defineConfig({
//     e2e: {
//       setupNodeEvents(on, config) {
//         registerKenshoTasks(on, config);
//         return config;
//       },
//     },
//   });

import { writeAnnotations } from './sidecar.js';

/**
 * Register the kensho:annotations task on the Cypress event bus.
 * @param {(event: string, handlers: object) => void} on - Cypress `on`
 * @param {{ env?: Record<string, any> }} [config] - Cypress config (for output dir)
 */
export function registerKenshoTasks(on, config) {
  const outputDir = (config && config.env && (config.env.KENSHO_OUTPUT || config.env.kenshoOutput))
    || process.env.KENSHO_OUTPUT
    || 'kensho-results';
  process.env.KENSHO_OUTPUT = outputDir;
  on('task', {
    'kensho:annotations'(record) {
      writeAnnotations(record, outputDir);
      return null; // cy.task requires a non-undefined return
    },
  });
  return on;
}

export default registerKenshoTasks;
