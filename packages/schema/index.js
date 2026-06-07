// @kaizenreport/kensho-schema — canonical Kensho v1 schema + lightweight
// validator. Zero runtime deps on purpose so adapters stay tiny.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const SCHEMA_VERSION = 'kensho/v1';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const schema = JSON.parse(
  readFileSync(resolve(__dirname, 'schema.json'), 'utf8')
);

/**
 * Allowed enum values pulled from the schema so adapters can type-check
 * without parsing JSON Schema at runtime.
 */
export const STATUS = ['pass', 'fail', 'broken', 'skip'];
export const STEP_STATUS = ['pass', 'fail', 'skip'];
export const SEVERITY = ['blocker', 'critical', 'normal', 'minor', 'trivial'];
export const ATTACHMENT_KINDS = [
  'screenshot','video','trace','har','text','json','html','dom-snapshot','log',
];

/**
 * Validates a run object against the Kensho v1 schema. This is a hand-rolled
 * validator — we avoid pulling in Ajv to keep the install size tiny for
 * adapter packages. For complex integrations, load the JSON Schema directly
 * with your validator of choice.
 *
 * @param {object} run
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRun(run) {
  const errors = [];
  const path = (p) => (p ? ' at ' + p : '');
  const req = (obj, key, p) => {
    if (obj == null || obj[key] == null) errors.push(`missing "${key}"${path(p)}`);
  };
  const enumOf = (v, list, p) => {
    if (v != null && !list.includes(v)) errors.push(`"${v}" not in ${list.join('|')}${path(p)}`);
  };
  const isStr = (v, p) => {
    if (v != null && typeof v !== 'string') errors.push(`expected string${path(p)}`);
  };
  const isInt = (v, p, min = 0) => {
    if (v != null && (!Number.isInteger(v) || v < min)) errors.push(`expected int ≥ ${min}${path(p)}`);
  };
  const isIso = (v, p) => {
    if (v != null && (typeof v !== 'string' || isNaN(Date.parse(v)))) errors.push(`expected ISO date${path(p)}`);
  };

  if (!run || typeof run !== 'object') return { ok: false, errors: ['run must be an object'] };
  if (run.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be "${SCHEMA_VERSION}"`);
  req(run, 'id', 'run');
  req(run, 'project', 'run');
  if (run.project) {
    req(run.project, 'name', 'run.project');
    req(run.project, 'slug', 'run.project');
  }
  req(run, 'framework', 'run');
  if (run.framework) req(run.framework, 'name', 'run.framework');
  isIso(run.startedAt, 'run.startedAt');
  isIso(run.finishedAt, 'run.finishedAt');
  req(run, 'totals', 'run');
  if (run.totals) {
    for (const k of ['pass','fail','broken','skip']) isInt(run.totals[k], `run.totals.${k}`);
  }
  if (!Array.isArray(run.testCases)) errors.push('run.testCases must be an array');
  else run.testCases.forEach((c, i) => validateCase(c, `run.testCases[${i}]`, errors, { enumOf, isStr, isInt, isIso, req }));
  return { ok: errors.length === 0, errors };
}

function validateCase(c, p, errors, helpers) {
  const { enumOf, isStr, isInt, isIso, req } = helpers;
  req(c, 'id', p); req(c, 'name', p); req(c, 'fullName', p);
  req(c, 'status', p); req(c, 'startedAt', p); req(c, 'duration', p);
  enumOf(c.status, STATUS, `${p}.status`);
  if (c.severity) enumOf(c.severity, SEVERITY, `${p}.severity`);
  isStr(c.owner, `${p}.owner`);
  isIso(c.startedAt, `${p}.startedAt`);
  isInt(c.duration, `${p}.duration`);
  if (Array.isArray(c.steps)) {
    c.steps.forEach((s, i) => {
      const sp = `${p}.steps[${i}]`;
      req(s, 'id', sp); req(s, 'title', sp); req(s, 'status', sp);
      enumOf(s.status, STEP_STATUS, `${sp}.status`);
      isIso(s.startedAt, `${sp}.startedAt`);
      isInt(s.duration, `${sp}.duration`);
    });
  }
  if (Array.isArray(c.attachments)) {
    c.attachments.forEach((a, i) => {
      const ap = `${p}.attachments[${i}]`;
      req(a, 'id', ap); req(a, 'kind', ap); req(a, 'relativePath', ap); req(a, 'mimeType', ap);
      enumOf(a.kind, ATTACHMENT_KINDS, `${ap}.kind`);
    });
  }
}

/**
 * Build an empty run skeleton — adapters fill in the pieces they care about.
 */
export function emptyRun(opts) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts?.id || crypto.randomUUID(),
    project: opts?.project || { name: 'Unknown', slug: 'unknown' },
    framework: opts?.framework || { name: 'junit-xml', version: '0.0.0' },
    env: opts?.env || { ci: 'local' },
    startedAt: opts?.startedAt || now,
    finishedAt: opts?.finishedAt || now,
    totals: { pass: 0, fail: 0, broken: 0, skip: 0 },
    durationMs: 0,
    testCases: [],
  };
}

/**
 * Recompute totals from a list of cases. Call this before writing run.json
 * so the manifest always matches what's on disk.
 */
export function computeTotals(cases) {
  const totals = { pass: 0, fail: 0, broken: 0, skip: 0 };
  for (const c of cases) {
    if (c.status in totals) totals[c.status]++;
  }
  return totals;
}

/**
 * Compute a stable case id across runs (lets the platform match a test to
 * its history). Double FNV-1a with different seeds gives us 64 bits of
 * hash space, enough to avoid collisions in realistic suites (~10k tests).
 */
export function stableCaseId(fullName, filePath) {
  const s = String(fullName || '') + '::' + String(filePath || '');
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return 'tc_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------- environment capture (shared by every JS adapter) ----------
//
// Resolves the standard Kensho env fields from the host process. Override
// anything via `KR_*` env vars; otherwise we detect GitHub Actions / GitLab /
// CircleCI / Jenkins / Buildkite / Azure Pipelines and populate accordingly.
// Adapters call `envInfo()` once at run start.

function normalizeGitUrl(u) {
  if (!u) return undefined;
  // ssh: git@github.com:owner/repo.git → https://github.com/owner/repo
  const m = String(u).match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  return String(u).replace(/\.git$/, '');
}

export function deriveRepoUrl(env = (typeof process !== 'undefined' ? process.env : {})) {
  if (env.KR_REPO_URL) return env.KR_REPO_URL;
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  }
  if (env.CI_PROJECT_URL) return env.CI_PROJECT_URL;                          // GitLab
  if (env.BITBUCKET_GIT_HTTP_ORIGIN) return env.BITBUCKET_GIT_HTTP_ORIGIN;    // Bitbucket
  if (env.BUILD_REPOSITORY_URI) return normalizeGitUrl(env.BUILD_REPOSITORY_URI); // Azure
  return normalizeGitUrl(env.CIRCLE_REPOSITORY_URL || env.BUILDKITE_REPO || env.GIT_URL);
}

export function deriveRunUrl(env = (typeof process !== 'undefined' ? process.env : {})) {
  if (env.KR_RUN_URL) return env.KR_RUN_URL;
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  if (env.CI_PIPELINE_URL) return env.CI_PIPELINE_URL;        // GitLab
  if (env.CIRCLE_BUILD_URL) return env.CIRCLE_BUILD_URL;       // CircleCI
  if (env.BUILDKITE_BUILD_URL) return env.BUILDKITE_BUILD_URL; // Buildkite
  if (env.BUILD_URL) return env.BUILD_URL;                     // Jenkins
  return undefined;
}

export function envInfo(env = (typeof process !== 'undefined' ? process.env : {})) {
  const isCI = !!env.CI;
  return {
    ci:      env.GITHUB_ACTIONS  ? 'github-actions'
           : env.CIRCLECI        ? 'circleci'
           : env.GITLAB_CI       ? 'gitlab'
           : env.JENKINS_URL     ? 'jenkins'
           : env.BUILDKITE       ? 'buildkite'
           : env.TF_BUILD        ? 'azure-devops'
           : isCI                ? 'unknown'
           : 'local',
    branch:  env.KR_BRANCH || env.GITHUB_REF_NAME || env.CIRCLE_BRANCH || env.CI_COMMIT_REF_NAME || env.BUILDKITE_BRANCH || env.BUILD_SOURCEBRANCHNAME,
    commit:  env.KR_COMMIT || env.GITHUB_SHA || env.CIRCLE_SHA1 || env.CI_COMMIT_SHA || env.BUILDKITE_COMMIT || env.BUILD_SOURCEVERSION,
    author:  env.KR_AUTHOR || env.GITHUB_ACTOR || env.GITLAB_USER_LOGIN,
    runUrl:  deriveRunUrl(env),
    repoUrl: deriveRepoUrl(env),
    os: typeof process !== 'undefined' ? process.platform : undefined,
    arch: typeof process !== 'undefined' ? process.arch : undefined,
    nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
  };
}
