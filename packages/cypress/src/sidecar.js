// @kaizenreport/kensho-cypress — Node-side sidecar helpers shared by the
// `setupNodeEvents` task (./task.js) and the Mocha reporter (../index.js).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function annotationsDirFor(outputDir) {
  return resolve(outputDir || resolve(process.cwd(), process.env.KENSHO_OUTPUT || 'kensho-results'), '.annotations');
}

/** Collapse suite separators so the browser side and the reporter agree on keys. */
export function normalizeFullName(fullName) {
  return String(fullName || '')
    .replace(/\s*[›>]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function keyFor(fullName) {
  return createHash('sha1').update(normalizeFullName(fullName)).digest('hex').slice(0, 16);
}

/** Persist (or update) a sidecar record received from the browser via cy.task. */
export function writeAnnotations(record, outputDir) {
  if (!record || !record.fullName) return null;
  try {
    const dir = annotationsDirFor(outputDir);
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, keyFor(record.fullName) + '.json');
    writeFileSync(file, JSON.stringify(record));
    return file;
  } catch { return null; }
}

/** Read a sidecar for a case fullName, if present (reporter side). */
export function readAnnotations(outputDir, fullName) {
  try {
    const file = resolve(annotationsDirFor(outputDir), keyFor(fullName) + '.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch { return null; }
}

/**
 * Merge a sidecar record into a case object (reporter side). Runtime values
 * win over tag/attribute-derived metadata already on the case.
 */
export function mergeAnnotations(caseObj, rec) {
  if (!rec) return caseObj;
  if (rec.behavior && Object.keys(rec.behavior).length) {
    caseObj.behavior = { ...(caseObj.behavior || {}), ...rec.behavior };
  }
  if (rec.labels && Object.keys(rec.labels).length) {
    caseObj.labels = { ...(caseObj.labels || {}), ...rec.labels };
  }
  if (rec.severity) caseObj.severity = rec.severity;
  if (rec.owner) caseObj.owner = rec.owner;
  if (rec.description) caseObj.description = rec.description;
  if (Array.isArray(rec.tags) && rec.tags.length) {
    caseObj.tags = [...new Set([...(caseObj.tags || []), ...rec.tags])];
  }
  if (Array.isArray(rec.parameters) && rec.parameters.length) {
    caseObj.parameters = [...(caseObj.parameters || []), ...rec.parameters];
  }
  if (Array.isArray(rec.links) && rec.links.length) {
    caseObj.links = [...(caseObj.links || []), ...rec.links];
  }
  if (Array.isArray(rec.steps) && rec.steps.length) {
    caseObj.steps = [...(caseObj.steps || []), ...rec.steps];
  }
  if (rec.flaky) caseObj.flaky = true;
  if (rec.muted) caseObj.muted = true;
  return caseObj;
}
