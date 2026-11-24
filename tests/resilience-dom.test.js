'use strict';

/* resilience-dom.test.js - static markup checks plus live execution of the
   Resilience and URE Lab inside the zero dependency DOM shim. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePage, makeDom, runApp, repoRoot } = require('./helpers/dom.js');
const lab = require('../js/resilience-lab.js');

const PAGE = parsePage('index.html');
const HTML = PAGE.source;

function boot(hash) {
  const env = makeDom(PAGE);
  if (hash) { env.context.location.hash = hash; }
  runApp(env);
  return env;
}

/* ------------------------------ static markup ------------------------------ */

test('DOM R01: the resilience section, heading, nav link and error slot exist', () => {
  assert.match(HTML, /<section id="resilience"[^>]*aria-labelledby="resilience-h"/);
  assert.match(HTML, /<h2 id="resilience-h">/);
  assert.match(HTML, /href="#resilience">Resilience Lab<\/a>/);
  assert.match(HTML, /id="error-resilience"\s+role="alert"/);
});

test('DOM R02: resilience-lab.js loads after its dependencies and before app.js', () => {
  const labTag = HTML.indexOf('src="js/resilience-lab.js"');
  const appTag = HTML.indexOf('src="js/app.js"');
  const raidTag = HTML.indexOf('src="js/raid.js"');
  assert.ok(raidTag > 0 && labTag > raidTag && appTag > labTag);
  assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(repoRoot, 'js', 'resilience-lab.js'), 'utf8')));
});

test('DOM R03: every lab id referenced by app.js exists in the markup', () => {
  const set = new Set(PAGE.ids);
  for (const id of [
    'resilience', 'lab-live', 'lab-offline', 'lab-ber-label', 'lab-ber-14', 'lab-ber-15', 'lab-ber-16',
    'lab-sync-note', 'lab-summary', 'lab-compare-body', 'lab-chart', 'lab-sweep-readout',
    'lab-rollup', 'lab-digest', 'lab-export-json', 'lab-export-csv', 'lab-export-md',
    'lab-copy-link', 'lab-verify', 'lab-run-tests', 'lab-export-status', 'lab-tests-count',
    'lab-tests-list', 'error-resilience'
  ]) {
    assert.ok(set.has(id), 'missing #' + id);
  }
});

test('DOM R04: the BER toggle group is a labeled radiogroup', () => {
  assert.match(HTML, /role="radiogroup" aria-labelledby="lab-ber-label"/);
  const presses = [...HTML.matchAll(/id="lab-ber-(\d+)"[^>]*aria-pressed="(true|false)"/g)];
  assert.equal(presses.length, 3);
  assert.equal(presses[0][2], 'true');
});

test('DOM R05: the lab carries honest disclosure copy and no dash characters', () => {
  const section = HTML.match(/<section id="resilience"[\s\S]*?<\/section>/)[0];
  assert.match(section, /Reference Model/);
  assert.match(section, /No NAS hardware is connected/);
  assert.match(section, /not a measurement of a real controller/);
  assert.equal(new RegExp('[\\u2013\\u2014]').test(section), false);
});

test('DOM R06: lab graceful fallback markup ships hidden', () => {
  assert.match(HTML, /id="lab-offline"[^>]*hidden/);
});

/* ------------------------------- live render ------------------------------- */

test('DOM R07: the lab renders without console errors on a clean boot', () => {
  const env = boot();
  assert.deepEqual(env.errors, []);
  assert.equal(env.getEl('error-resilience').hidden, true);
  assert.equal(env.getEl('lab-offline').hidden, true);
});

test('DOM R08: the comparator table renders all five levels', () => {
  const env = boot();
  const rows = env.getEl('lab-compare-body').children;
  assert.equal(rows.length, 5);
  assert.match(rows[0].text, /RAID 0/);
  assert.match(rows[2].text, /RAID 5/);
  assert.match(rows[4].text, /RAID 10/);
});

test('DOM R09: comparator rows show usable space, tolerance and a risk chip', () => {
  const env = boot();
  const rows = env.getEl('lab-compare-body').children;
  const r5 = rows[2];
  assert.match(r5.text, /TiB/);
  assert.match(r5.text, /75%/);
  assert.match(r5.text, /85\.3% rebuild loss risk/);
  assert.match(rows[0].text, /No rebuild/);
});

test('DOM R10: the summary line quotes the computed probabilities', () => {
  const env = boot();
  const summary = env.getEl('lab-summary').textContent;
  const compare = lab.compareRaid({ drives: 4, driveTb: 8, berExp: 14 });
  const r5 = compare.rows.find((r) => r.level === '5');
  assert.match(summary, /RAID 5 rebuild loss risk 85\.3%/);
  assert.ok(summary.includes('RAID 5 rebuild loss risk'));
  assert.ok(Math.abs(r5.ureProbability - 0.8533930378696498) < 1e-9);
});

test('DOM R11: the sync note mirrors storage and memory controls', () => {
  const env = boot();
  const note = env.getEl('lab-sync-note').textContent;
  assert.match(note, /4 drives of 8 TB each/);
  assert.match(note, /250 MB per second/);
  assert.match(note, /8 GB at 8,192 tokens/);
});

test('DOM R12: the sweep chart draws three series and 36 focusable points', () => {
  const env = boot();
  const chart = env.getEl('lab-chart');
  assert.equal(chart.querySelectorAll('.chart-line').length, 3);
  const points = chart.querySelectorAll('.ure-point');
  assert.equal(points.length, 36);
  for (const p of points) {
    assert.equal(p.getAttribute('tabindex'), '0');
    assert.match(p.getAttribute('aria-label'), /RAID \d+ at \d+ TB/);
  }
});

test('DOM R13: focusing a chart point writes its number into the readout', () => {
  const env = boot();
  const points = env.getEl('lab-chart').querySelectorAll('.ure-point');
  const target = points.find((p) => /RAID 5 at 24 TB/.test(p.getAttribute('aria-label')));
  target.fire('focus');
  assert.match(env.getEl('lab-sweep-readout').textContent, /RAID 5 at 24 TB: 99\.7%/);
});

test('DOM R14: the rollup renders four bound stat blocks', () => {
  const env = boot();
  const stats = env.getEl('lab-rollup').children;
  assert.equal(stats.length, 4);
  assert.match(stats[0].text, /safest rebuild/);
  assert.match(stats[1].text, /catalog entries fit/);
  assert.match(stats[2].text, /reclaimable/);
  assert.match(stats[3].text, /predicted rule conflicts/);
});

test('DOM R15: the on page digest is a 64 hex sha256 matching the module', () => {
  const env = boot();
  const shown = env.getEl('lab-digest').textContent.replace('sha256 ', '');
  const report = lab.reportFor({ drives: 4, driveTb: 8, berExp: 14, rebuildMbps: 250, ramGb: 8, tokens: 8192, panel: 'resilience' });
  assert.equal(shown, report.sha256);
  assert.match(shown, /^[0-9a-f]{64}$/);
});

/* ------------------------------- interaction ------------------------------- */

test('DOM R16: BER toggles update aria-pressed and re-render the summary', () => {
  const env = boot();
  env.getEl('lab-ber-16').fire('click');
  assert.equal(env.getEl('lab-ber-16').getAttribute('aria-pressed'), 'true');
  assert.equal(env.getEl('lab-ber-14').getAttribute('aria-pressed'), 'false');
  assert.match(env.getEl('lab-summary').textContent, /Enterprise media at 1e-16/);
  env.getEl('lab-ber-15').fire('click');
  assert.match(env.getEl('lab-summary').textContent, /NAS media at 1e-15/);
});

test('DOM R17: changing BER re-renders the chart with new probabilities', () => {
  const env = boot();
  const before = env.getEl('lab-chart').querySelectorAll('.ure-point').map((p) => p.getAttribute('cy')).join(',');
  env.getEl('lab-ber-15').fire('click');
  const after = env.getEl('lab-chart').querySelectorAll('.ure-point').map((p) => p.getAttribute('cy')).join(',');
  assert.notEqual(after, before);
});

test('DOM R18: storage controls re-render the lab summary and table', () => {
  const env = boot();
  env.getEl('drive-count').value = '8';
  env.getEl('drive-count').fire('input');
  assert.match(env.getEl('lab-summary').textContent, /for 8 x 8 TB drives/);
  assert.match(env.getEl('lab-sync-note').textContent, /8 drives of 8 TB each/);
});

test('DOM R19: memory controls re-render the sync note', () => {
  const env = boot();
  env.getEl('ram-budget').value = '32';
  env.getEl('ram-budget').fire('input');
  assert.match(env.getEl('lab-sync-note').textContent, /32 GB at 8,192 tokens/);
});

test('DOM R20: the self test runner fills the list and count', () => {
  const env = boot();
  env.getEl('lab-run-tests').fire('click');
  assert.match(env.getEl('lab-tests-count').textContent, /17 of 17 deterministic checks passed/);
  const rows = env.getEl('lab-tests-list').children;
  assert.equal(rows.length, 17);
  assert.ok(rows.every((r) => r.text.startsWith('Pass:')));
});

test('DOM R21: verify reports an intact digest and a caught tamper', () => {
  const env = boot();
  env.getEl('lab-verify').fire('click');
  const status = env.getEl('lab-export-status').textContent;
  assert.match(status, /Digest verified for the current state/);
  assert.match(status, /tamper demo.*caught it/);
});

test('DOM R22: export buttons report status without throwing', () => {
  const env = boot();
  env.getEl('lab-export-json').fire('click');
  assert.match(env.getEl('lab-export-status').textContent, /nestpulse-resilience-report\.json/);
  env.getEl('lab-export-csv').fire('click');
  assert.match(env.getEl('lab-export-status').textContent, /nestpulse-resilience-report\.csv/);
  env.getEl('lab-export-md').fire('click');
  assert.match(env.getEl('lab-export-status').textContent, /nestpulse-resilience-report\.md/);
  assert.deepEqual(env.errors, []);
});

test('DOM R23: the share link button surfaces an np= bookmark', () => {
  const env = boot();
  env.getEl('lab-copy-link').fire('click');
  const status = env.getEl('lab-export-status').textContent;
  assert.match(status, /Share link/);
  const m = status.match(/#np=[A-Za-z0-9_-]+/);
  assert.ok(m, 'no np= hash in status');
  assert.ok(lab.decodeState(m[0]));
});

/* ------------------------------ hash restore ------------------------------- */

test('DOM R24: a bookmark hash restores every field into the real controls', () => {
  const hash = '#' + lab.encodeState({ drives: 6, driveTb: 16, berExp: 15, rebuildMbps: 300, ramGb: 24, tokens: 32768, panel: 'storage' });
  const env = boot(hash);
  assert.equal(env.getEl('drive-count').value, '6');
  assert.equal(env.getEl('drive-size').value, '16');
  assert.equal(env.getEl('rebuild-speed').value, '300');
  assert.equal(env.getEl('ram-budget').value, '24');
  assert.equal(env.getEl('context-tokens').value, '32768');
  assert.equal(env.getEl('lab-ber-15').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(env.errors, []);
});

test('DOM R25: restored state re-renders every dependent panel', () => {
  const hash = '#' + lab.encodeState({ drives: 6, driveTb: 16, berExp: 15, rebuildMbps: 300, ramGb: 24, tokens: 32768 });
  const env = boot(hash);
  assert.match(env.getEl('storage-summary').textContent, /6 drives of 16 TB/);
  assert.match(env.getEl('models-headline').textContent, /budget of 24 GB at 32,768 tokens/);
  assert.match(env.getEl('lab-summary').textContent, /NAS media at 1e-15/);
  assert.match(env.getEl('lab-summary').textContent, /for 6 x 16 TB drives/);
});

test('DOM R26: a malformed hash leaves the page at defaults with no errors', () => {
  const env = boot('#np=!!!garbage!!!');
  assert.deepEqual(env.errors, []);
  assert.equal(env.getEl('drive-count').value, '4');
  assert.match(env.getEl('lab-summary').textContent, /Consumer media at 1e-14/);
});

test('DOM R27: a hostile proto hash fails closed and keeps defaults', () => {
  const hostile = '#np=' + lab.b64urlEncode('{"drives":6,"__proto__":{"x":1}}');
  const env = boot(hostile);
  assert.equal(env.getEl('drive-count').value, '4');
  assert.equal({}.x, undefined);
  assert.deepEqual(env.errors, []);
});

test('DOM R28: a share link encoded by the page decodes to the live state', () => {
  const env = boot();
  env.getEl('drive-count').value = '10';
  env.getEl('drive-count').fire('input');
  env.getEl('lab-copy-link').fire('click');
  const m = env.getEl('lab-export-status').textContent.match(/#np=[A-Za-z0-9_-]+/);
  const decoded = lab.decodeState(m[0]);
  assert.equal(decoded.drives, 10);
  assert.equal(decoded.driveTb, 8);
  assert.equal(decoded.tokens, 8192);
});

/* --------------------------- graceful degradation -------------------------- */

test('DOM R29: the lab stays quiet but alive when inputs go hostile', () => {
  const env = boot();
  env.getEl('drive-count').value = 'abc';
  env.getEl('drive-count').fire('input');
  assert.deepEqual(env.errors, []);
  assert.ok(env.getEl('lab-compare-body').children.length >= 0);
  env.getEl('drive-count').value = '4';
  env.getEl('drive-count').fire('input');
  assert.match(env.getEl('lab-summary').textContent, /RAID 5/);
});

test('DOM R30: every rendered cell is finite and free of NaN', () => {
  const env = boot();
  for (const row of env.getEl('lab-compare-body').children) {
    assert.equal(/NaN|undefined|Infinity/.test(row.text), false, row.text);
  }
  assert.equal(/NaN|undefined/.test(env.getEl('lab-summary').textContent), false);
  assert.equal(/NaN|undefined/.test(env.getEl('lab-digest').textContent), false);
});

test('DOM R31: interactive sweep chart exposes group semantics and keyboard activation', () => {
  const env = boot();
  const chart = env.getEl('lab-chart').querySelector('svg');
  assert.equal(chart.getAttribute('role'), 'group');
  const point = env.getEl('lab-chart').querySelectorAll('.ure-point')[0];
  const before = env.getEl('lab-sweep-readout').textContent;
  point.fire('keydown', { key: 'Enter' });
  assert.notEqual(env.getEl('lab-sweep-readout').textContent, before);
});
