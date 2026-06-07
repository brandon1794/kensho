// Stable id + canonical env helper — re-exported so the reporter and the
// helper API agree. envInfo handles KR_REPO_URL / KR_RUN_URL overrides plus
// GitHub Actions / GitLab / CircleCI / Jenkins / Buildkite / Azure auto-detect.
export { stableCaseId, envInfo } from '@kaizenreport/kensho-schema';

export function shortId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

export function nowIso() { return new Date().toISOString(); }

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.mov': 'video/quicktime', '.zip': 'application/zip',
  '.html': 'text/html', '.json': 'application/json',
  '.txt': 'text/plain', '.log': 'text/plain', '.har': 'application/json',
};

const KIND_BY_EXT = {
  '.png': 'screenshot', '.jpg': 'screenshot', '.jpeg': 'screenshot', '.webp': 'screenshot',
  '.webm': 'video', '.mp4': 'video', '.mov': 'video',
  '.zip': 'trace', '.html': 'html', '.json': 'json', '.txt': 'text',
  '.log': 'log', '.har': 'har',
};

export function mimeFor(ext) { return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream'; }
export function kindFor(ext) { return KIND_BY_EXT[ext.toLowerCase()] || 'text'; }

// Back-compat wrapper — forwards to the canonical envInfo() in the schema pkg.
import { envInfo as _envInfo } from '@kaizenreport/kensho-schema';
export function envFromCI() { return _envInfo(); }

export function deviceLabelsFromCaps(caps) {
  if (!caps || typeof caps !== 'object') return {};
  const out = {};
  if (caps.platformName) out.platform = String(caps.platformName);
  if (caps.platformVersion) out.osVersion = String(caps.platformVersion);
  if (caps.deviceName) out.device = String(caps.deviceName);
  if (caps.automationName) out.automationName = String(caps.automationName);
  if (caps.app) out.app = String(caps.app);
  if (caps.bundleId) out.bundleId = String(caps.bundleId);
  if (caps.appPackage) out.appPackage = String(caps.appPackage);
  if (caps.appActivity) out.appActivity = String(caps.appActivity);
  if (caps.udid) out.udid = String(caps.udid);
  return out;
}

export function platformStringFromCaps(caps) {
  if (!caps) return process.platform;
  const p = caps.platformName || '';
  const v = caps.platformVersion || '';
  return v ? `${p} ${v}`.trim() : (p || process.platform);
}
