// Seeds kensho-results/ from a fixture k6 summary object so the demo runs
// without k6 installed. Mirrors the shape k6 passes to handleSummary(data).

import { kenshoSummary } from '@kaizenreport/kensho-k6';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
process.chdir(projectRoot);

const output = resolve(projectRoot, 'kensho-results');
try { rmSync(output, { recursive: true, force: true }); } catch {}

// Fixture summary — mirrors k6's `data` arg structure.
const data = {
  options: {
    scenarios: {
      smoke: { executor: 'constant-vus', vus: 5, duration: '10s', exec: 'smoke' },
      soak:  { executor: 'ramping-vus',  exec: 'soak' },
    },
  },
  state: { testRunDurationMs: 30000 },
  metrics: {
    http_req_duration: {
      type: 'trend',
      values: { avg: 215.4, min: 18.1, max: 1241.2, 'p(90)': 412.5, 'p(95)': 612.7 },
      thresholds: { 'p(95)<500': { ok: false } },
    },
    http_req_failed: {
      type: 'rate',
      values: { rate: 0.012, passes: 988, fails: 12 },
      thresholds: { 'rate<0.01': { ok: false } },
    },
    http_reqs: {
      type: 'counter',
      values: { count: 1000, rate: 33.3 },
    },
    iterations: {
      type: 'counter',
      values: { count: 480, rate: 16.0 },
    },
    iteration_duration: {
      type: 'trend',
      values: { avg: 1850.4, 'p(95)': 2200.1 },
    },
    vus: { type: 'gauge', values: { value: 10 } },
    vus_max: { type: 'gauge', values: { value: 10 } },
    data_sent: { type: 'counter', values: { count: 524288, rate: 17476 } },
    data_received: { type: 'counter', values: { count: 8388608, rate: 279620 } },
    checks: {
      type: 'rate',
      values: { rate: 0.964, passes: 1928, fails: 72 },
      thresholds: { 'rate>0.95': { ok: true } },
    },
  },
  root_group: {
    name: '',
    checks: [],
    groups: [
      {
        name: 'smoke / GET /products',
        checks: [
          { name: 'status is 200', passes: 480, fails: 0 },
          { name: 'body has "item"', passes: 478, fails: 2 },
        ],
        groups: [],
      },
      {
        name: 'soak / GET /',
        checks: [
          { name: 'status is 200', passes: 970, fails: 0 },
          { name: 'served fast',   passes: 0,   fails: 70 },
        ],
        groups: [],
      },
    ],
  },
  // Opt-in HTTP samples — feeds step.request/step.response on the scenario case.
  kenshoSamples: [
    {
      method: 'GET',
      url: 'https://test.k6.io/products',
      status: 200,
      statusText: 'OK',
      durationMs: 184,
      requestHeaders: { Accept: '*/*' },
      responseHeaders: { 'Content-Type': 'text/html; charset=utf-8' },
      requestBody: '',
      responseBody: '<html><body>Sample products page with items</body></html>',
    },
    {
      method: 'GET',
      url: 'https://test.k6.io/',
      status: 200,
      statusText: 'OK',
      durationMs: 322,
      requestHeaders: { Accept: '*/*' },
      responseHeaders: { 'Content-Type': 'text/html; charset=utf-8' },
      requestBody: '',
      responseBody: '<html><body>Welcome to test.k6.io</body></html>',
    },
  ],
};

const files = kenshoSummary(data, {
  project: { name: 'API perf', slug: 'api-perf' },
  runId: 'run_k6_demo',
  output: 'kensho-results',
});

mkdirSync(output, { recursive: true });
mkdirSync(join(output, 'cases'), { recursive: true });
mkdirSync(join(output, 'attachments'), { recursive: true });

for (const [path, contents] of Object.entries(files)) {
  const abs = join(projectRoot, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}
console.log(`[seed] wrote ${Object.keys(files).length} files to ${output}`);
