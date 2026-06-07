// Demo k6 script. Two scenarios + checks + thresholds + Kensho summary.
//
// Run:  k6 run script.js
// Then: npx kensho generate --input kensho-results

import http from 'k6/http';
import { check, group, sleep } from 'k6';
// In a real project, bundle this via webpack/esbuild — k6 can also resolve
// node_modules with --compatibility-mode=experimental_enhanced. For zero
// build, copy dist/index.mjs next to script.js and import './kensho-k6.mjs'.
import { kenshoSummary } from '@kaizenreport/kensho-k6';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '10s',
      exec: 'smoke',
    },
    soak: {
      executor: 'ramping-vus',
      stages: [
        { duration: '5s',  target: 10 },
        { duration: '20s', target: 10 },
      ],
      exec: 'soak',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.01'],
    checks:            ['rate>0.95'],
  },
};

export function smoke() {
  group('smoke / GET /products', () => {
    const r = http.get('https://test.k6.io/products');
    check(r, {
      'status is 200':    (r) => r.status === 200,
      'body has "item"':  (r) => r.body && r.body.includes('item'),
    });
  });
  sleep(1);
}

export function soak() {
  group('soak / GET /', () => {
    const r = http.get('https://test.k6.io/');
    check(r, {
      'status is 200':    (r) => r.status === 200,
      'served fast':      (r) => r.timings && r.timings.duration < 1000,
    });
  });
  sleep(1);
}

export function handleSummary(data) {
  return kenshoSummary(data, {
    project: { name: 'API perf', slug: 'api-perf' },
  });
}
