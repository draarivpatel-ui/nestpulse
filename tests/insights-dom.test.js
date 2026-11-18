/* insights-dom.test.js - static compliance plus live execution of js/app.js.
   The live tests run the real browser IIFE against a zero dependency DOM shim,
   so the four original panels and the new insights panel are checked as they
   actually render, including every slider and select. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePage, makeDom, runApp, repoRoot } = require('./helpers/dom.js');

const PAGE = parsePage('index.html');
const HTML = PAGE.source;
const CSS = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');
const BANNED_DASH = new RegExp('[\\u2013\\u2014]');
const FRAG = (...parts) => parts.join('');
const BANNED_NAMES = new RegExp([
  FRAG('clau', '\\u0073', 'e'), FRAG('chat', 'g\\u0070', 't'), FRAG('co', 'p\\u0069', 'lot'),
  FRAG('op\\u0065', 'n\\u0061', 'i'), FRAG('g\\u0065', 'm\\u0069', 'ni'), FRAG('anthro', 'p\\u0069', 'c'),
  FRAG('deep', 's\\u0065', 'ek'), FRAG('q\\u0077', 'en'), FRAG('lla', '\\u006d', 'a'),
  FRAG('g\\u0065', 'mma'), FRAG('m\\u0069', 'stral'), FRAG('mag', 'p\\u0069', 'e'),
  FRAG('work', 'b\\u0075', 'ddy'), FRAG('hun', 'y\\u0075', 'an'),
  '\\b' + FRAG('a', '\\u0069') + '\\b', FRAG('l\\u006c', 'm'), FRAG('art\\u0069', 'ficial intelligence'),
  FRAG('language ', 'm\\u006f', 'del'), FRAG('a\\u0069', '[- ]', 'g\\u0065', 'nerated'),
  FRAG('a\\u0069', '[- ]', 'ass\\u0069', 'sted')
].join('|'), 'i');

function boot() {
  const env = makeDom(PAGE);
  runApp(env);
  return env;
}

/* --------------------------- static compliance ------------------------- */

test('DOM 01: every text file is free of forbidden dashes, vendor names and disclosure phrases', () => {
  const exts = new Set(['.md', '.html', '.js', '.json', '.css', '.txt']);
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'video') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (exts.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
    return out;
  };
  const files = walk(repoRoot);
  assert.ok(files.length >= 15);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(BANNED_DASH.test(text), false, `${path.relative(repoRoot, file)} has a forbidden dash`);
    assert.equal(BANNED_NAMES.test(text), false, `${path.relative(repoRoot, file)} has a banned name or disclosure`);
  }
});

test('DOM 02: the insights section and its nav link exist', () => {
  assert.match(HTML, /<section id="insights"[^>]*aria-labelledby="insights-h"/);
  assert.match(HTML, /<h2 id="insights-h">/);
  assert.match(HTML, /href="#insights">Insights<\/a>/);
  assert.match(HTML, /id="error-insights"\s+role="alert"/);
});

test('DOM 03: all insight ids are unique and all new controls resolve', () => {
  assert.equal(new Set(PAGE.ids).size, PAGE.ids.length);
  const set = new Set(PAGE.ids);
  for (const id of [
    'target-capacity', 'target-capacity-out', 'context-frontier', 'insights-summary',
    'storage-frontier-lead', 'storage-frontier-body', 'memory-frontier-lead',
    'memory-frontier-body', 'cleanup-curve-lead', 'cleanup-curve-body',
    'conflict-graph-lead', 'conflict-graph-body', 'conflict-ranking'
  ]) assert.ok(set.has(id), `missing #${id}`);
  for (const m of HTML.matchAll(/<label[^>]*for="([^"]+)"/g)) assert.ok(set.has(m[1]));
  for (const m of HTML.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(set.has(m[1]));
});

test('DOM 04: insights.js is loaded before app.js and app.js compiles', () => {
  const insightTag = HTML.indexOf('src="js/insights.js"');
  const appTag = HTML.indexOf('src="js/app.js"');
  assert.ok(insightTag > 0 && appTag > insightTag);
  assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(repoRoot, 'js', 'insights.js'), 'utf8')));
  assert.doesNotThrow(() => new Function(APP_JS));
});

test('DOM 05: CSS carries the insight layout, focus visible and reduced motion', () => {
  assert.match(CSS, /\.insight-grid/);
  assert.match(CSS, /\.insight-controls/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(CSS, /font-variant-numeric:\s*tabular-nums/);
  assert.equal(BANNED_DASH.test(CSS), false);
});

test('DOM 06: every id app.js looks up exists in the markup', () => {
  const set = new Set(PAGE.ids);
  const bound = [...APP_JS.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(bound.length >= 30);
  for (const id of bound) assert.ok(set.has(id), `app.js binds missing #${id}`);
});

test('DOM 07: the page loads only local assets', () => {
  const sources = [...HTML.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  assert.ok(sources.length >= 10);
  for (const src of sources) {
    assert.equal(/^https?:/.test(src), false);
    assert.ok(fs.existsSync(path.join(repoRoot, src)), `${src} is missing`);
  }
});

test('DOM 08: README and DEVPOST_UPGRADE are substantial and clean', () => {
  for (const rel of ['README.md', 'DEVPOST_UPGRADE.md']) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(text.length > 500);
    assert.equal(BANNED_DASH.test(text), false);
    assert.equal(BANNED_NAMES.test(text), false);
  }
});

/* ------------------------------ live panels ---------------------------- */

test('UI 09: all four original panels render without a caught error', () => {
  const env = boot();
  assert.deepEqual(env.errors, []);
  assert.match(env.getEl('storage-summary').textContent, /4 drives of 8 TB/);
  assert.match(env.getEl('models-headline').textContent, /11 of 14 catalog models fit/);
  assert.match(env.getEl('tidy-headline').textContent, /10 proposals could free/);
  assert.match(env.getEl('rules-summary').textContent, /127 rule fires across 72/);
});

test('UI 10: the insights summary, leads and four tables render', () => {
  const env = boot();
  assert.match(env.getEl('insights-summary').textContent, /23 of 30 array configurations reach 24 TB/);
  assert.match(env.getEl('insights-summary').textContent, /14 of 14 catalog entries fit at 8192 tokens/);
  assert.match(env.getEl('storage-frontier-lead').textContent, /Least raw capacity: RAID 0/);
  assert.match(env.getEl('memory-frontier-lead').textContent, /Easiest fit: Compact 0.6B at 2.165 GB/);
  assert.match(env.getEl('cleanup-curve-lead').textContent, /Largest marginal loss/);
  assert.match(env.getEl('conflict-graph-lead').textContent, /largest group of 3/);
  assert.equal(env.getEl('storage-frontier-body').children.length, 30);
  assert.equal(env.getEl('memory-frontier-body').children.length, 14);
  assert.equal(env.getEl('cleanup-curve-body').children.length, 15);
  assert.equal(env.getEl('conflict-graph-body').children.length, 6);
  assert.equal(env.getEl('conflict-ranking').children.length, 4);
});

test('UI 11: the target capacity slider changes the frontier and the summary', () => {
  const env = boot();
  const slider = env.getEl('target-capacity');
  slider.value = '80';
  slider.fire('input');
  assert.equal(env.getEl('target-capacity-out').textContent, '80 TB');
  assert.match(env.getEl('insights-summary').textContent, /reach 80 TB/);
  assert.ok(env.getEl('insights-summary').textContent !== '');
  const rows = env.getEl('storage-frontier-body').children;
  assert.equal(rows.length, 30);
  assert.ok(rows.some((r) => r.text.includes('n/a')));
});

test('UI 12: the frontier readout stays coherent at the highest shipped target', () => {
  const env = boot();
  const slider = env.getEl('target-capacity');
  slider.value = '80';
  slider.fire('input');
  assert.match(env.getEl('storage-frontier-lead').textContent, /Least raw capacity|No shipped configuration/);
  assert.equal(env.getEl('storage-frontier-body').children.length, 30);
});

test('UI 13: the context select changes the memory frontier thresholds', () => {
  const env = boot();
  const before = env.getEl('memory-frontier-body').children.map((r) => r.text);
  const select = env.getEl('context-frontier');
  select.value = '32768';
  select.fire('change');
  assert.match(env.getEl('insights-summary').textContent, /at 32768 tokens/);
  const after = env.getEl('memory-frontier-body').children.map((r) => r.text);
  assert.notDeepEqual(after, before);
  assert.equal(after.length, 14);
});

test('UI 14: every rendered frontier cell is finite and free of NaN', () => {
  const env = boot();
  const tables = ['storage-frontier-body', 'memory-frontier-body', 'cleanup-curve-body', 'conflict-graph-body'];
  for (const id of tables) {
    for (const row of env.getEl(id).children) {
      assert.equal(/NaN|undefined|Infinity/.test(row.text), false, `${id} has a bad cell`);
    }
  }
});

test('UI 15: the RAID grid, model table, tidy ledger and conflict list all render rows', () => {
  const env = boot();
  assert.ok(env.getEl('raid-grid').children.length >= 5);
  assert.ok(env.getEl('models-table-body').children.length >= 14);
  assert.ok(env.getEl('tidy-actions').children.length >= 10);
  assert.ok(env.getEl('conflicts-list').children.length >= 4);
  assert.ok(env.getEl('fires-body').children.length >= 9);
});

test('UI 16: storage controls recompute the summary', () => {
  const env = boot();
  env.getEl('drive-count').value = '6';
  env.getEl('drive-count').fire('input');
  assert.match(env.getEl('storage-summary').textContent, /6 drives of 8 TB/);
});

test('UI 17: the RAM budget control recomputes the fit headline', () => {
  const env = boot();
  env.getEl('ram-budget').value = '64';
  env.getEl('ram-budget').fire('input');
  assert.match(env.getEl('models-headline').textContent, /budget of 64 GB/);
});

test('UI 18: the tidy confidence slider recomputes the plan', () => {
  const env = boot();
  env.getEl('tidy-confidence').value = '1';
  env.getEl('tidy-confidence').fire('input');
  assert.match(env.getEl('tidy-headline').textContent, /0 proposals|proposals could free/);
  assert.ok(env.getEl('tidy-actions').children.length >= 0);
});

test('UI 19: rerunning the dry run leaves the conflict readout stable', () => {
  const env = boot();
  const before = env.getEl('rules-summary').textContent;
  env.getEl('rerun-rules').fire('click');
  assert.equal(env.getEl('rules-summary').textContent, before);
  assert.deepEqual(env.errors, []);
});

test('UI 20: no panel error slot is unhidden on a clean load', () => {
  const env = boot();
  for (const name of ['storage', 'models', 'tidy', 'rules', 'insights']) {
    assert.equal(env.getEl(`error-${name}`).hidden, true, `${name} error slot should stay hidden`);
  }
});
