// kensho badge — emit an SVG status badge from a kensho-results/ directory.
// Two-segment shields.io-style pill (label · value, with status color).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const COLORS = {
  pass:   '#3FB950',
  warn:   '#D29922',
  fail:   '#F85149',
  broken: '#A371F7',
  skip:   '#8B949E',
};

function pickColor(passRate, hasFails) {
  if (hasFails && passRate < 95) return COLORS.fail;
  if (passRate < 80) return COLORS.fail;
  if (passRate < 95) return COLORS.warn;
  return COLORS.pass;
}

// Approximate text width in pixels for Verdana 11px (matches shields.io).
function approxWidth(text) {
  // ~6.7px per ASCII char on average
  return Math.ceil(String(text).length * 6.7) + 10;
}

function svg(label, value, color) {
  const lw = approxWidth(label);
  const vw = approxWidth(value);
  const total = lw + vw;
  // Use Verdana via a fallback; embed an SVG that renders consistently.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${lw * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(lw - 10) * 10}">${label}</text>
    <text x="${lw * 5}" y="140" transform="scale(.1)" fill="#fff" textLength="${(lw - 10) * 10}">${label}</text>
    <text aria-hidden="true" x="${(lw + vw / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(vw - 10) * 10}">${value}</text>
    <text x="${(lw + vw / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(vw - 10) * 10}">${value}</text>
  </g>
</svg>`;
}

export async function renderBadge({ input, type, out }) {
  const runJsonPath = join(input, 'run.json');
  if (!existsSync(runJsonPath)) {
    throw new Error('run.json not found in ' + input);
  }
  const run = JSON.parse(readFileSync(runJsonPath, 'utf8'));
  const t = run.totals || {};
  const total = (t.pass || 0) + (t.fail || 0) + (t.broken || 0) + (t.skip || 0);
  const passRate = total ? ((t.pass || 0) / total) * 100 : 0;
  const hasFails = (t.fail || 0) + (t.broken || 0) > 0;

  let label, value, color;
  switch (type) {
    case 'status':
      label = 'tests';
      value = hasFails ? `${t.fail + t.broken} failing` : `${t.pass || 0} passing`;
      color = pickColor(passRate, hasFails);
      break;
    case 'tests':
      label = 'tests';
      value = `${t.pass || 0} / ${total}`;
      color = pickColor(passRate, hasFails);
      break;
    case 'passrate':
    default:
      label = 'pass rate';
      value = passRate.toFixed(1) + '%';
      color = pickColor(passRate, hasFails);
      break;
  }

  const out_svg = svg(label, value, color);
  if (out) {
    writeFileSync(out, out_svg);
    console.log(`[kensho] badge written to ${out}`);
  } else {
    process.stdout.write(out_svg);
  }
}
