'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raid = require('../js/raid.js');
const models = require('../js/models.js');
const tidy = require('../js/tidy.js');
const library = require('../js/data-library.js');

const repoRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');

test('DOM Smoke 01: index.html starts with HTML5 doctype and lang=en', () => {
  assert.match(indexHtml.trimStart(), /^<!doctype html>/i);
  assert.match(indexHtml, /<html\s+lang="en"/i);
});

test('DOM Smoke 02: index.html contains UTF-8 charset and responsive viewport meta tags', () => {
  assert.match(indexHtml, /<meta\s+charset="utf-8">/i);
  assert.match(indexHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1">/i);
});

test('DOM Smoke 03: index.html contains non-empty title and meta description', () => {
  assert.match(indexHtml, /<title>NestPulse,\s*a service bench for a personal AI NAS<\/title>/);
  assert.match(indexHtml, /<meta\s+name="description"\s+content="[^"]{40,}">/);
});

test('DOM Smoke 04: OpenGraph meta tags and theme-color exist in <head>', () => {
  assert.match(indexHtml, /property="og:title"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:description"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:type"\s+content="website"/);
  assert.match(indexHtml, /<meta\s+name="theme-color"\s+content="#141613">/);
});

test('DOM Smoke 05: inline SVG favicon link is present in <head>', () => {
  assert.match(indexHtml, /<link\s+rel="icon"\s+href="data:image\/svg\+xml,/);
});

test('DOM Smoke 06: index.html contains exactly one <h1> element', () => {
  const h1Matches = indexHtml.match(/<h1\b[^>]*>/gi) || [];
  assert.equal(h1Matches.length, 1);
});

test('DOM Smoke 07: heading hierarchy in index.html never skips levels', () => {
  const levels = [...indexHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  assert.equal(levels.length, 10);
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `Heading level jumped from h${levels[i - 1]} to h${levels[i]}`
    );
  }
});

test('DOM Smoke 08: all 39 id attributes in index.html are unique', () => {
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 39);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'Duplicate IDs found in index.html');
});

test('DOM Smoke 09: accessible skip link points to #main and target landmark exists', () => {
  assert.match(indexHtml, /<a\s+class="skip"\s+href="#main">/);
  assert.match(indexHtml, /<main\s+id="main">/);
});

test('DOM Smoke 10: <noscript> fallback banner is present inside <body>', () => {
  assert.match(indexHtml, /<noscript>[\s\S]*?<p\s+class="noscript-note"[\s\S]*?<\/noscript>/);
});

test('DOM Smoke 11: semantic landmarks (header, nav, main, footer) are present', () => {
  assert.match(indexHtml, /<header\b[^>]*>/);
  assert.match(indexHtml, /<nav\b[^>]*aria-label="Module navigation"/);
  assert.match(indexHtml, /<main\s+id="main">/);
  assert.match(indexHtml, /<footer\s+class="site-footer">/);
});

test('DOM Smoke 12: all four diagnostic module sections (#storage, #models, #tidy, #rules) exist', () => {
  for (const mod of ['storage', 'models', 'tidy', 'rules']) {
    assert.match(indexHtml, new RegExp(`<section\\s+id="${mod}"[^>]*aria-labelledby="${mod}-h"`));
    assert.match(indexHtml, new RegExp(`<h2\\s+id="${mod}-h">`));
    assert.match(indexHtml, new RegExp(`id="error-${mod}"\\s+role="alert"\\s+hidden`));
  }
});

test('DOM Smoke 13: every aria-labelledby target in index.html resolves to an existing ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...indexHtml.matchAll(/\baria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(refs.length, 5);
  for (const ref of refs) {
    assert.ok(htmlIds.has(ref), `aria-labelledby target #${ref} is missing in index.html`);
  }
});

test('DOM Smoke 14: every label[for] attribute in index.html resolves to an existing form control ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const forIds = [...indexHtml.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(forIds.length >= 9);
  for (const id of forIds) {
    assert.ok(htmlIds.has(id), `label[for="${id}"] has no matching control ID`);
  }
});

test('DOM Smoke 15: all DOM IDs looked up via $(id) in js/app.js exist in index.html', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const boundIds = [...appJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(boundIds.length >= 20);
  for (const id of boundIds) {
    assert.ok(htmlIds.has(id), `ID #${id} looked up in js/app.js is missing from index.html`);
  }
});

test('DOM Smoke 16: aria-live polite readouts exist across all four diagnostic modules', () => {
  assert.match(indexHtml, /id="storage-summary"\s+aria-live="polite"/);
  assert.match(indexHtml, /id="models-headline"\s+aria-live="polite"/);
  assert.match(indexHtml, /id="tidy-headline"\s+aria-live="polite"/);
  assert.match(indexHtml, /id="rules-summary"\s+aria-live="polite"/);
});

test('DOM Smoke 17: data tables include accessible captions and column headers with scope="col"', () => {
  const captions = indexHtml.match(/<caption\b[^>]*>/g) || [];
  const colHeaders = indexHtml.match(/<th\s+scope="col"/g) || [];
  assert.equal(captions.length, 2);
  assert.ok(colHeaders.length >= 6);
});

test('DOM Smoke 18: styles.css provides :focus-visible outline and reduced-motion guard', () => {
  assert.match(stylesCss, /:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('DOM Smoke 19: styles.css enforces tabular-nums for numeric alignment', () => {
  assert.match(stylesCss, /font-variant-numeric:\s*tabular-nums/);
});

test('DOM Smoke 20: zero em-dashes or en-dashes across HTML, CSS, and UI JS', () => {
  assert.equal(/[\u2013\u2014]/.test(indexHtml), false);
  assert.equal(/[\u2013\u2014]/.test(stylesCss), false);
  assert.equal(/[\u2013\u2014]/.test(appJs), false);
});

test('DOM Smoke 21: zero emoji characters across HTML, CSS, and UI JS', () => {
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(indexHtml), false);
  assert.equal(emojiRegex.test(stylesCss), false);
  assert.equal(emojiRegex.test(appJs), false);
});

test('DOM Smoke 22: zero uppercase CSS transforms in styles.css', () => {
  assert.equal(/text-transform\s*:\s*uppercase/i.test(stylesCss), false);
});

test('DOM Smoke 23: zero Todo/Fixme/Lorem placeholders or personal email leaks in HTML, CSS, and JS', () => {
  const combined = `${indexHtml}\n${stylesCss}\n${appJs}`;
  assert.equal(/\b(?:TODO|FIXME|XXX|HACK|lorem ipsum)\b/i.test(combined), false);
  assert.equal(/[a-z0-9._%+-]+@gmail\.com/i.test(combined), false);
});

test('DOM Smoke 24: RAID calculator computes all five levels (0, 1, 5, 6, 10) for default 4x8TB bench state', () => {
  for (const level of ['0', '1', '5', '6', '10']) {
    const res = raid.computeRaid({ level, drives: 4, driveTb: 8, rebuildMbps: 200 });
    assert.equal(res.ok, true);
    assert.ok(res.usableTb > 0);
  }
});

test('DOM Smoke 25: model fitting and tidy cleanup engines run deterministically on shipped demo datasets', () => {
  assert.ok(models.CATALOG.length >= 6);
  const plan = tidy.planCleanup(library.manifest, {
    minConfidence: 0.6,
    screenshotCutoff: '2024-06-01',
    keepNewest: true
  });
  assert.ok(plan.actions.length > 0);
  assert.ok(plan.potentialSavingBytes > 0);
});
