// ESM re-export so Node tooling can `import { kenshoSummary } from
// '@kaizenreport/kensho-k6'`. The k6 runtime imports the .mjs directly.

export * from './index.mjs';
export { default } from './index.mjs';
