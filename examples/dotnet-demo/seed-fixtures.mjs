// Mints static kensho-results/ fixtures for the three .NET demos. Lets the
// JS CLI validate + generate without a .NET SDK installed. The shape of the
// JSON is exactly what the live adapters produce — same FNV-1a stable ids,
// same kensho/v1 layout — so swapping in real `dotnet test` output should
// be a no-op for the consumer of the fixture.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableCaseId, computeTotals } from '../../packages/schema/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const STAMP = '2026-04-27T08:00:00.000Z';

function ms(offset) {
  return new Date(Date.parse(STAMP) + offset).toISOString();
}

function step(title, opts = {}) {
  return {
    id: 'step_' + Math.random().toString(16).slice(2, 12),
    title,
    status: opts.status || 'pass',
    startedAt: ms(opts.start || 0),
    duration: opts.duration ?? 1,
    children: opts.children,
  };
}

function caseFor(framework, full, file, opts = {}) {
  const id = stableCaseId(full, file);
  const c = {
    id,
    name: opts.name || full.split('.').pop(),
    fullName: full,
    filePath: file,
    suite: opts.suite,
    status: opts.status || 'pass',
    startedAt: ms(opts.start || 0),
    finishedAt: ms((opts.start || 0) + (opts.duration ?? 5)),
    duration: opts.duration ?? 5,
    retries: 0,
    platform: 'darwin',
  };
  if (opts.line) c.line = opts.line;
  if (opts.severity) c.severity = opts.severity;
  if (opts.owner) c.owner = opts.owner;
  if (opts.behavior) c.behavior = opts.behavior;
  if (opts.labels) c.labels = opts.labels;
  if (opts.tags) c.tags = opts.tags;
  if (opts.description) c.description = opts.description;
  if (opts.steps) c.steps = opts.steps;
  if (opts.errors) c.errors = opts.errors;
  if (opts.parameters) c.parameters = opts.parameters;
  if (opts.links) c.links = opts.links;
  if (opts.logs) c.logs = opts.logs;
  return c;
}

function buildRun({ framework, project, slug, cases }) {
  const totals = computeTotals(cases);
  return {
    schemaVersion: 'kensho/v1',
    id: 'run_20260427080000',
    project: { name: project, slug },
    framework,
    env: {
      ci: 'local',
      os: 'darwin',
      arch: 'arm64',
      osVersion: '25.4.0',
    },
    startedAt: STAMP,
    finishedAt: ms(120),
    totals,
    durationMs: 120,
    testCases: cases,
  };
}

function writeBundle(rootRel, run) {
  const root = resolve(here, rootRel);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(resolve(root, 'cases'), { recursive: true });
  mkdirSync(resolve(root, 'attachments'), { recursive: true });
  for (const c of run.testCases) {
    writeFileSync(resolve(root, 'cases', c.id + '.json'), JSON.stringify(c, null, 2));
  }
  writeFileSync(resolve(root, 'run.json'), JSON.stringify(run, null, 2));
  console.log('wrote', root, '— cases:', run.testCases.length);
}

// ----- nunit-demo --------------------------------------------------------- //

const NUNIT_FILE = 'CartTests.cs';
const nunitCases = [
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Adds_first_item_to_cart',
    NUNIT_FILE,
    {
      name: 'Adds_first_item_to_cart',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'critical',
      owner: 'alice',
      tags: ['smoke'],
      description: 'Adds a single item to an empty cart and shows the total.',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      labels: { surface: 'web' },
      links: [{ url: 'https://jira.example.com/browse/CART-1', kind: 'jira', label: 'CART-1' }],
      duration: 12,
      steps: [
        step('open the storefront', { duration: 2 }),
        step('add SKU-101 to cart', {
          duration: 8,
          children: [step('warm up CDN', { duration: 1 })],
        }),
      ],
      logs: [{ t: 0, level: 'info', msg: 'cart-service: ready' }],
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Empty_cart_shows_CTA',
    NUNIT_FILE,
    {
      name: 'Empty_cart_shows_CTA',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'blocker',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'fail',
      duration: 6,
      steps: [step('verify empty CTA copy', { status: 'fail', duration: 5 })],
      errors: [
        {
          message: 'Expected: "Start shopping" But was: "Add your first item"',
          stack: '   at NUnitDemo.CartTests.Empty_cart_shows_CTA() in CartTests.cs:line 41',
          type: 'AssertionException',
        },
      ],
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Saves_for_later',
    NUNIT_FILE,
    {
      name: 'Saves_for_later',
      suite: ['NUnitDemo', 'CartTests'],
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'skip',
      duration: 0,
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Sums_line_items(1,2,3)',
    NUNIT_FILE,
    {
      name: 'Sums_line_items(1,2,3)',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '1', kind: 'argument' },
        { name: 'arg1', value: '2', kind: 'argument' },
        { name: 'arg2', value: '3', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Sums_line_items(2,3,5)',
    NUNIT_FILE,
    {
      name: 'Sums_line_items(2,3,5)',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '2', kind: 'argument' },
        { name: 'arg1', value: '3', kind: 'argument' },
        { name: 'arg2', value: '5', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Sums_line_items(10,15,25)',
    NUNIT_FILE,
    {
      name: 'Sums_line_items(10,15,25)',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '10', kind: 'argument' },
        { name: 'arg1', value: '15', kind: 'argument' },
        { name: 'arg2', value: '25', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'nunit',
    'NUnitDemo.CartTests.Probe_returns_inconclusive',
    NUNIT_FILE,
    {
      name: 'Probe_returns_inconclusive',
      suite: ['NUnitDemo', 'CartTests'],
      severity: 'minor',
      behavior: { feature: 'Cart', scenario: 'Inconclusive backend probe' },
      status: 'broken',
      duration: 2,
      errors: [
        {
          message: 'backend probe pending',
          type: 'InconclusiveException',
        },
      ],
    },
  ),
];

writeBundle(
  './nunit-demo/fixtures/kensho-results',
  buildRun({
    framework: { name: 'nunit', version: '3.13.3' },
    project: 'Kensho NUnit Demo',
    slug: 'kensho-nunit-demo',
    cases: nunitCases,
  }),
);

// ----- mstest-demo -------------------------------------------------------- //

const MSTEST_FILE = 'CartTests.cs';
const mstestCases = [
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Adds_first_item_to_cart',
    MSTEST_FILE,
    {
      name: 'Adds_first_item_to_cart',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'critical',
      owner: 'alice',
      tags: ['smoke'],
      description: 'Adds a single item to an empty cart and shows the total.',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      labels: { surface: 'web' },
      links: [{ url: 'https://jira.example.com/browse/CART-1', kind: 'jira', label: 'CART-1' }],
      duration: 11,
      steps: [
        step('open the storefront', { duration: 2 }),
        step('add SKU-101 to cart', {
          duration: 7,
          children: [step('warm up CDN', { duration: 1 })],
        }),
      ],
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Empty_cart_shows_CTA',
    MSTEST_FILE,
    {
      name: 'Empty_cart_shows_CTA',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'blocker',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'fail',
      duration: 4,
      steps: [step('verify empty CTA copy', { status: 'fail', duration: 3 })],
      errors: [
        {
          message: 'Assert.AreEqual failed. Expected:<Start shopping>. Actual:<Add your first item>.',
          stack: '   at MSTestDemo.CartTests.Empty_cart_shows_CTA() in CartTests.cs:line 39',
          type: 'AssertFailedException',
        },
      ],
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Saves_for_later',
    MSTEST_FILE,
    {
      name: 'Saves_for_later',
      suite: ['MSTestDemo', 'CartTests'],
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'skip',
      duration: 0,
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Sums_line_items (1,2,3)',
    MSTEST_FILE,
    {
      name: 'Sums_line_items (1,2,3)',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '1', kind: 'argument' },
        { name: 'arg1', value: '2', kind: 'argument' },
        { name: 'arg2', value: '3', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Sums_line_items (2,3,5)',
    MSTEST_FILE,
    {
      name: 'Sums_line_items (2,3,5)',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '2', kind: 'argument' },
        { name: 'arg1', value: '3', kind: 'argument' },
        { name: 'arg2', value: '5', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Sums_line_items (10,15,25)',
    MSTEST_FILE,
    {
      name: 'Sums_line_items (10,15,25)',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'arg0', value: '10', kind: 'argument' },
        { name: 'arg1', value: '15', kind: 'argument' },
        { name: 'arg2', value: '25', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'mstest',
    'MSTestDemo.CartTests.Inspects_metadata',
    MSTEST_FILE,
    {
      name: 'Inspects_metadata',
      suite: ['MSTestDemo', 'CartTests'],
      severity: 'minor',
      behavior: { feature: 'Cart', epic: 'Checkout', scenario: 'Free-form trait demo' },
      duration: 1,
    },
  ),
];

writeBundle(
  './mstest-demo/fixtures/kensho-results',
  buildRun({
    framework: { name: 'mstest', version: '3.1.1' },
    project: 'Kensho MSTest Demo',
    slug: 'kensho-mstest-demo',
    cases: mstestCases,
  }),
);

// ----- xunit-demo --------------------------------------------------------- //

const XUNIT_FILE = 'CartTests.cs';
const xunitCases = [
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Adds_first_item_to_cart',
    XUNIT_FILE,
    {
      name: 'Adds_first_item_to_cart',
      suite: ['XunitDemo', 'CartTests'],
      severity: 'critical',
      owner: 'alice',
      tags: ['smoke'],
      description: 'Adds a single item to an empty cart and shows the total.',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      labels: { surface: 'web' },
      links: [{ url: 'https://jira.example.com/browse/CART-1', kind: 'jira', label: 'CART-1' }],
      duration: 9,
      steps: [
        step('open the storefront', { duration: 1 }),
        step('add SKU-101 to cart', {
          duration: 7,
          children: [step('warm up CDN', { duration: 1 })],
        }),
      ],
    },
  ),
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Empty_cart_shows_CTA',
    XUNIT_FILE,
    {
      name: 'Empty_cart_shows_CTA',
      suite: ['XunitDemo', 'CartTests'],
      severity: 'blocker',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'fail',
      duration: 4,
      steps: [step('verify empty CTA copy', { status: 'fail', duration: 3 })],
      errors: [
        {
          message: 'Assert.Equal() Failure',
          stack: '   at XunitDemo.CartTests.Empty_cart_shows_CTA() in CartTests.cs:line 38',
          type: 'EqualException',
        },
      ],
    },
  ),
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Saves_for_later',
    XUNIT_FILE,
    {
      name: 'Saves_for_later',
      suite: ['XunitDemo', 'CartTests'],
      behavior: { feature: 'Cart', epic: 'Checkout' },
      status: 'skip',
      duration: 0,
    },
  ),
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Sums_line_items(a: 1, b: 2, expected: 3)',
    XUNIT_FILE,
    {
      name: 'Sums_line_items(a: 1, b: 2, expected: 3)',
      suite: ['XunitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'a', value: '1', kind: 'argument' },
        { name: 'b', value: '2', kind: 'argument' },
        { name: 'expected', value: '3', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Sums_line_items(a: 2, b: 3, expected: 5)',
    XUNIT_FILE,
    {
      name: 'Sums_line_items(a: 2, b: 3, expected: 5)',
      suite: ['XunitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'a', value: '2', kind: 'argument' },
        { name: 'b', value: '3', kind: 'argument' },
        { name: 'expected', value: '5', kind: 'argument' },
      ],
    },
  ),
  caseFor(
    'xunit',
    'XunitDemo.CartTests.Sums_line_items(a: 10, b: 15, expected: 25)',
    XUNIT_FILE,
    {
      name: 'Sums_line_items(a: 10, b: 15, expected: 25)',
      suite: ['XunitDemo', 'CartTests'],
      severity: 'normal',
      behavior: { feature: 'Cart', epic: 'Checkout' },
      duration: 1,
      parameters: [
        { name: 'a', value: '10', kind: 'argument' },
        { name: 'b', value: '15', kind: 'argument' },
        { name: 'expected', value: '25', kind: 'argument' },
      ],
    },
  ),
];

writeBundle(
  './xunit-demo/fixtures/kensho-results',
  buildRun({
    // xunit isn't in the Kensho v1 framework enum, so we tag the run as
    // the generic .NET fallback "junit-xml". Bumping to v2 + adding xunit
    // is the proper long-term fix.
    framework: { name: 'junit-xml', version: '2.6.1' },
    project: 'Kensho xUnit Demo',
    slug: 'kensho-xunit-demo',
    cases: xunitCases,
  }),
);
