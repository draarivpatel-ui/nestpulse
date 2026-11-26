'use strict';

/* Hardening regressions: defects found in the adversarial revamp, plus extra
   edge coverage for the math modules and the page contract. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raid = require('../js/raid.js');
const models = require('../js/models.js');
const tidy = require('../js/tidy.js');
const rules = require('../js/rules.js');
const insights = require('../js/insights.js');
const { parsePage, makeDom, runApp } = require('./helpers/dom.js');

const repoRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');

function sens(sensor, op, value) {
  return { type: 'sensor', sensor: sensor, op: op, value: value };
}
function timeW(start, end) {
  return { type: 'time', start: start, end: end };
}
function dev(device, state) {
  return { type: 'device', device: device, state: state };
}
function act(device, command) {
  return { device: device, command: command };
}
function mkRule(id, name, conditions, actions) {
  return { id: id, name: name, conditions: conditions, actions: actions };
}
function item(over) {
  return Object.assign({ id: 'x', path: 'a/x.jpg', kind: 'photo', bytes: 10, modified: '2024-01-01', contentHash: 'h1' }, over);
}

/* --------------------------- tidy planner -------------------------------- */

test('buildActions accepts a call with no options object', () => {
  const manifest = { items: [item({ id: 'a' }), item({ id: 'b', path: 'a/y.jpg' })] };
  const actions = tidy.buildActions(manifest);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].class, 'exact');
});

test('items without a string content hash never group as exact duplicates', () => {
  const manifest = {
    items: [
      item({ id: 'a', contentHash: undefined }),
      item({ id: 'b', contentHash: undefined }),
      item({ id: 'c', contentHash: '' }),
      item({ id: 'd', contentHash: '' }),
      item({ id: 'e', path: 'a/e.jpg' }),
      item({ id: 'f', path: 'a/f.jpg' })
    ]
  };
  const plan = tidy.planCleanup(manifest, { minConfidence: 0 });
  const exact = plan.actions.filter((a) => a.class === 'exact');
  assert.equal(exact.length, 1, 'only the real shared hash may group');
  assert.equal(exact[0].remove.length, 1);
});

test('summarizeLibrary does not count hashless items as a duplicate group', () => {
  const manifest = { items: [item({ id: 'a', contentHash: null }), item({ id: 'b', contentHash: null })] };
  assert.equal(tidy.summarizeLibrary(manifest).exactHashGroups, 0);
});

test('an aged screenshot exactly on the cutoff date is kept', () => {
  const manifest = { items: [item({ id: 's', kind: 'screenshot', modified: '2024-06-01', contentHash: 'sa' })] };
  const plan = tidy.planCleanup(manifest, { minConfidence: 0, screenshotCutoff: '2024-06-01' });
  assert.equal(plan.actions.length, 0, 'the cutoff is inclusive, the day itself is not aged');
});

test('keep-first mode is deterministic on equal dates', () => {
  const manifest = {
    items: [
      item({ id: 'b', path: 'z/b.jpg', contentHash: 'h' }),
      item({ id: 'a', path: 'a/a.jpg', contentHash: 'h' })
    ]
  };
  const plan = tidy.planCleanup(manifest, { minConfidence: 0, keepNewest: false });
  assert.equal(plan.actions[0].keep.id, 'a');
});

test('a confidence threshold of zero keeps every proposal', () => {
  const manifest = { items: [item({ id: 's', kind: 'screenshot', modified: '2020-01-01', contentHash: 'sa' })] };
  const plan = tidy.planCleanup(manifest, { minConfidence: 0 });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.suppressed.count, 0);
});

test('a confidence threshold above one suppresses every proposal', () => {
  const manifest = { items: [item({ id: 'a' }), item({ id: 'b', path: 'a/y.jpg' })] };
  const plan = tidy.planCleanup(manifest, { minConfidence: 1.01 });
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.suppressed.count, 1);
});

test('normalizeName strips copy suffixes case insensitively and parenthesized counters', () => {
  assert.equal(tidy.normalizeName('Report COPY.pdf'), 'report');
  assert.equal(tidy.normalizeName('Photo (3).jpg'), 'photo');
  assert.equal(tidy.isCopiedName('scan copy.png'), true);
  assert.equal(tidy.isCopiedName('scan.png'), false);
  assert.equal(tidy.isCopiedName('copycat.png'), false, 'a name that merely starts with copy is not a copy');
});

/* --------------------------- rule forge ---------------------------------- */

test('a rule that demands one device in two states can never co-fire with anything', () => {
  const broken = mkRule('b1', 'Broken', [dev('fan', 'on'), dev('fan', 'off')], [act('fan', 'on')]);
  const other = mkRule('b2', 'Other', [timeW('00:00', '23:59')], [act('fan', 'on')]);
  assert.equal(rules.rulesCanCooccur(broken, other), false);
  assert.equal(rules.rulesCanCooccur(broken, broken), false, 'it cannot even occur with itself');
});

test('an internally contradictory rule produces no conflicts at all', () => {
  const broken = mkRule('b1', 'Broken', [dev('fan', 'on'), dev('fan', 'off')], [act('fan', 'off')]);
  const other = mkRule('b2', 'Other', [timeW('14:00', '16:00')], [act('fan', 'off')]);
  const conflicts = rules.findConflicts([broken, other]);
  assert.equal(conflicts.length, 0, 'a rule that cannot fire must not spawn phantom conflicts');
});

test('validateRule flags a self contradictory device requirement exactly once per device', () => {
  const broken = mkRule('b1', 'Broken', [dev('fan', 'on'), dev('fan', 'off'), dev('fan', 'off')], [act('fan', 'on')]);
  const issues = rules.validateRule(broken);
  const flagged = issues.filter((i) => /both on and off|both off and on/.test(i.message));
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].message, /never fire/);
});

test('the shipped demo rules keep their documented conflict profile', () => {
  const ruleSet = require('../js/data-rules.js').rules;
  const logs = require('../js/data-sensors.js').buildLogs();
  const result = rules.dryRun(ruleSet, logs);
  const kinds = result.conflicts.reduce((map, c) => { map[c.kind] = (map[c.kind] || 0) + 1; return map; }, {});
  assert.equal(result.conflicts.length, 4);
  assert.equal(kinds.shadowed, 1);
  assert.equal(kinds.contradiction, 3);
  assert.equal(result.validation.length, 1, 'the co2Ppm sensor reference stays the only note');
});

test('parseTime rejects out of range and malformed values', () => {
  assert.equal(rules.parseTime('24:00'), null);
  assert.equal(rules.parseTime('12:60'), null);
  assert.equal(rules.parseTime('7:05:30'), null);
  assert.equal(rules.parseTime(' 07:05'), null, 'no leading whitespace tolerance');
  assert.equal(rules.parseTime('0:00'), 0);
  assert.equal(rules.parseTime('23:59'), 1439);
});

test('windowSegments returns nothing for a zero length or invalid window', () => {
  assert.deepEqual(rules.windowSegments(timeW('08:00', '08:00')), []);
  assert.deepEqual(rules.windowSegments(timeW('bad', '08:00')), []);
  assert.deepEqual(rules.windowSegments(timeW('23:00', '06:00')), [[1380, 1440], [0, 360]]);
});

test('minuteInWindow treats the end bound as exclusive', () => {
  const cond = timeW('10:00', '11:00');
  assert.equal(rules.minuteInWindow(600, cond), true);
  assert.equal(rules.minuteInWindow(660, cond), false);
  assert.equal(rules.minuteInWindow(599, cond), false);
});

test('sensorInterval builds closed and open endpoints per operator', () => {
  const eq = rules.sensorInterval(sens('livingTemp', '==', 20));
  assert.equal(eq.lo, 20); assert.equal(eq.hi, 20);
  assert.equal(eq.loClosed, true); assert.equal(eq.hiClosed, true);
  const ge = rules.sensorInterval(sens('livingTemp', '>=', 20));
  assert.equal(ge.loClosed, true); assert.equal(ge.hi, Infinity);
  assert.equal(rules.sensorInterval(sens('livingTemp', '!=', 20)), null);
});

test('intervalContains respects open endpoints at a shared boundary', () => {
  const openOuter = { lo: 5, loClosed: false, hi: Infinity, hiClosed: false };
  const closedInner = { lo: 5, loClosed: true, hi: Infinity, hiClosed: false };
  const closedOuter = { lo: 5, loClosed: true, hi: Infinity, hiClosed: false };
  assert.equal(rules.intervalContains(openOuter, closedInner), false);
  assert.equal(rules.intervalContains(closedOuter, closedInner), true);
});

test('describeCondition speaks flag sensors and unknown kinds plainly', () => {
  assert.equal(rules.describeCondition(sens('motionHall', '==', 1)), 'Hall motion detected');
  assert.equal(rules.describeCondition(sens('motionHall', '==', 0)), 'No hall motion');
  assert.equal(rules.describeCondition({ type: 'mystery' }), 'Unknown condition');
  assert.match(rules.describeCondition(dev('unknownDev', 'on')), /unknownDev is on/);
});

test('describeAction falls back to the raw device id for unknown devices', () => {
  assert.equal(rules.describeAction(act('unknownDev', 'off')), 'Turn unknownDev off');
});

test('actionsEqual rejects pairs with different device sets', () => {
  const a = mkRule('a', 'A', [], [act('fan', 'on'), act('heater', 'on')]);
  const b = mkRule('b', 'B', [], [act('fan', 'on')]);
  assert.equal(rules.actionsEqual(a, b), false);
  assert.equal(rules.actionsEqual(b, a), false);
});

test('a dry run over empty logs reports zero fires but still finds conflicts', () => {
  const a = mkRule('a', 'A', [timeW('08:00', '10:00')], [act('fan', 'on')]);
  const b = mkRule('b', 'B', [timeW('09:00', '11:00')], [act('fan', 'off')]);
  const result = rules.dryRun([a, b], []);
  assert.equal(result.logsCount, 0);
  assert.equal(result.reports.every((r) => r.fires === 0), true);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'contradiction');
});

/* ----------------------------- storage math ------------------------------ */

test('computeRaid rejects unknown levels and bad inputs without throwing', () => {
  assert.equal(raid.computeRaid({ level: '7', drives: 4, driveTb: 8 }).ok, false);
  assert.match(raid.computeRaid({ level: '7', drives: 4, driveTb: 8 }).error, /Unknown RAID level 7/);
  assert.equal(raid.computeRaid({ level: '5', drives: 'abc', driveTb: 8 }).ok, false);
  assert.equal(raid.computeRaid({ level: '5', drives: 4, driveTb: 0 }).ok, false);
  assert.equal(raid.computeRaid({ level: '10', drives: 5, driveTb: 8 }).ok, false);
});

test('a fractional drive count is floored to a whole number', () => {
  const r = raid.computeRaid({ level: '5', drives: 4.9, driveTb: 8 });
  assert.equal(r.ok, true);
  assert.equal(r.drives, 4);
  assert.equal(r.usableTb, 24);
});

test('a zero or missing rebuild speed yields no rebuild estimate', () => {
  assert.equal(raid.computeRaid({ level: '5', drives: 4, driveTb: 8, rebuildMbps: 0 }).rebuildHours, null);
  assert.equal(raid.computeRaid({ level: '5', drives: 4, driveTb: 8 }).rebuildHours, null);
});

test('a rebuild speed small enough to overflow the quotient yields no estimate', () => {
  const r = raid.computeRaid({ level: '5', drives: 4, driveTb: 8, rebuildMbps: 1e-308 });
  assert.equal(r.ok, true);
  assert.equal(r.rebuildHours, null);
  assert.ok(r.notes.every((note) => !/Infinity/.test(note)));
});

test('the RAID 5 parity penalty is exactly 1.25 times the mirror rebuild', () => {
  const mirror = raid.computeRaid({ level: '1', drives: 2, driveTb: 8, rebuildMbps: 250 });
  const parity = raid.computeRaid({ level: '5', drives: 4, driveTb: 8, rebuildMbps: 250 });
  assert.ok(Math.abs(parity.rebuildHours / mirror.rebuildHours - 1.25) < 1e-9);
});

test('TiB reporting uses the real 2 to the 40 divisor', () => {
  const r = raid.computeRaid({ level: '0', drives: 2, driveTb: 8 });
  assert.ok(Math.abs(r.usableTib - (16e12 / 1099511627776)) < 1e-9);
});

/* ----------------------------- memory math ------------------------------- */

test('kvBytes treats a negative context as zero tokens', () => {
  const model = models.CATALOG[0];
  assert.equal(models.kvBytes(model, -50), 0);
});

test('fitCheck on a zero budget reports no fit with an infinite utilization', () => {
  const model = models.CATALOG[0];
  const check = models.fitCheck(model, models.QUANTS[0], 0, 1024);
  assert.equal(check.fits, false);
  assert.equal(check.verdict, 'no');
  assert.equal(check.utilization, Infinity);
  assert.ok(check.shortfallBytes > 0);
});

test('maxTokens is zero when weights alone bust the budget', () => {
  const model = models.CATALOG[models.CATALOG.length - 1];
  assert.equal(models.maxTokens(model, models.QUANTS[0], 1), 0);
});

test('bestQuant picks the largest fitting quantization or none at all', () => {
  const model = models.CATALOG[0];
  assert.equal(models.bestQuant(model, 1e12, 8192).id, 'f16');
  assert.equal(models.bestQuant(model, 1, 8192), null);
});

test('the quant ladder is sorted from smallest to largest bits per weight', () => {
  for (let i = 1; i < models.QUANTS.length; i += 1) {
    assert.ok(models.QUANTS[i].bitsPerWeight > models.QUANTS[i - 1].bitsPerWeight);
  }
});

test('arithmeticLine names the model, quant and budget it justifies', () => {
  const model = models.CATALOG[0];
  const line = models.arithmeticLine(model, models.QUANTS[2], 8192, 8e9);
  assert.match(line, new RegExp(model.name.replace(/\s/g, '\\s')));
  assert.match(line, /Q4 K M/);
  assert.match(line, /8\.00 GB budget/);
});

/* ------------------------------ insights --------------------------------- */

test('storageFrontier honors custom levels and drive sizes', () => {
  const out = insights.storageFrontier(8, { levels: ['0'], driveSizesTb: [8], maxDrives: 6 });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].config.drives, 2, 'RAID 0 still needs its two drive minimum');
});

test('an unreachable target reports null configs rather than fake projections', () => {
  const out = insights.storageFrontier(1e6, { maxDrives: 4 });
  assert.equal(out.reachableCount, 0);
  assert.ok(out.rows.every((row) => row.config === null));
  assert.equal(out.bestRawEfficiency, null);
});

test('memoryFrontier handles a zero token context', () => {
  const out = insights.memoryFrontier(0);
  assert.equal(out.contextTokens, 0);
  assert.ok(out.rows.every((row) => row.kvGbAtContext === 0));
});

test('the cleanup curve never reclaims more at a stricter threshold', () => {
  const manifest = require('../js/data-library.js').manifest;
  const curve = insights.cleanupCurve(manifest);
  for (let i = 1; i < curve.rows.length; i += 1) {
    assert.ok(curve.rows[i].savingBytes <= curve.rows[i - 1].savingBytes);
  }
  assert.equal(curve.finalSavingBytes, 0, 'threshold 1.01 suppresses everything');
});

test('conflictGraph on an empty rule set yields no components', () => {
  const graph = insights.conflictGraph([], []);
  assert.equal(graph.ruleCount, 0);
  assert.equal(graph.components.length, 0);
  assert.equal(graph.largestComponent, null);
  assert.equal(graph.mostEntangled, null);
});

test('buildDigest exposes one summary field per panel', () => {
  const manifest = require('../js/data-library.js').manifest;
  const digest = insights.buildDigest(manifest, [], []);
  assert.ok(digest.storage && digest.memory && digest.cleanup && digest.rules);
  assert.equal(digest.rules.ruleCount, 0);
});

/* --------------------------- page contract ------------------------------- */

test('the page carries a restrictive content security policy', () => {
  const m = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(m, 'CSP meta tag is missing');
  assert.match(m[1], /default-src 'self'/);
  assert.match(m[1], /script-src 'self'/);
  assert.match(m[1], /connect-src 'none'/);
  assert.match(m[1], /object-src 'none'/);
  assert.match(m[1], /form-action 'none'/);
});

test('smooth scrolling is disabled everywhere, including reduced motion blocks', () => {
  assert.equal(/scroll-behavior\s*:\s*smooth/.test(stylesCss), false);
});

test('the hero title stands alone with no eyebrow or kicker above it', () => {
  assert.equal(indexHtml.includes('plate-tag'), false);
  assert.equal(/\.plate-tag/.test(stylesCss), false);
  const heroCopy = indexHtml.match(/<div class="hero-copy">([\s\S]*?)<\/div>/);
  assert.ok(heroCopy);
  assert.match(heroCopy[1], /^\s*<h1 id="hero-h">/);
});

test('the storage summary degrades gracefully on a non numeric drive count', () => {
  const env = makeDom(parsePage('index.html'));
  runApp(env);
  const input = env.getEl('drive-count');
  input.value = '';
  input.fire('input');
  assert.match(env.getEl('storage-summary').textContent, /positive whole number/);
  input.value = '6';
  input.fire('input');
  assert.match(env.getEl('storage-summary').textContent, /Capacity math for 6 drives/);
});

test('every module still renders inside the DOM shim without console errors', () => {
  const env = makeDom(parsePage('index.html'));
  runApp(env);
  assert.equal(env.errors.length, 0, JSON.stringify(env.errors));
  assert.ok(env.getEl('raid-grid').children.length >= 5);
  assert.ok(env.getEl('models-table-body').children.length > 0);
  assert.ok(env.getEl('tidy-actions').children.length > 0);
  assert.ok(env.getEl('conflicts-list').children.length > 0);
});

/* ----------------------------- Pass 2 regressions ----------------------------- */

test('fitCheck flags contexts beyond the model rated maximum', () => {
  const model = models.CATALOG.find((m) => m.id === 'mid-72'); // contextMax 32768
  const over = models.fitCheck(model, models.QUANTS[0], 64e9, 65536);
  assert.equal(over.beyondContext, true);
  assert.equal(over.contextMax, 32768);
  const within = models.fitCheck(model, models.QUANTS[0], 64e9, 32768);
  assert.equal(within.beyondContext, false);
});

test('maxTokens never promises more than the rated context ceiling', () => {
  const model = models.CATALOG.find((m) => m.id === 'large-14w'); // contextMax 16384
  const capped = models.maxTokens(model, models.QUANTS[0], 256e9);
  assert.equal(capped, 16384);
  const model2 = models.CATALOG.find((m) => m.id === 'xxl-70'); // contextMax 131072
  assert.ok(models.maxTokens(model2, models.QUANTS[6], 64e9) < model2.contextMax);
});

test('a beyond-context model still shows the warning in the rendered table', () => {
  const env = makeDom(parsePage('index.html'));
  runApp(env);
  const sel = env.getEl('context-tokens');
  sel.value = '65536';
  sel.fire('change');
  const notes = env.getEl('models-table-body').querySelectorAll('.verdict-note');
  assert.ok(notes.length >= 1, 'expected at least one rated-context warning');
});

test('memoryFrontier rows carry the rated-context flag', () => {
  const rows = insights.memoryFrontier(65536).rows;
  const wide = rows.find((r) => r.id === 'large-14w');
  assert.equal(wide.withinContext, false);
  assert.equal(wide.contextMax, 16384);
  const rowsOk = insights.memoryFrontier(8192).rows;
  assert.ok(rowsOk.every((r) => r.withinContext === true));
});

test('non-finite inputs cannot leak NaN or Infinity through the math API', () => {
  const model = models.CATALOG[0];
  const quant = models.QUANTS[0];
  for (const t of [NaN, 'abc', undefined, Infinity]) {
    assert.equal(models.kvBytes(model, t), 0);
  }
  const infCheck = models.fitCheck(model, quant, Infinity, 1024);
  assert.equal(infCheck.fits, true);
  assert.ok(Number.isFinite(infCheck.freeBytes));
  const nanCheck = models.fitCheck(model, quant, NaN, 1024);
  assert.equal(nanCheck.verdict, 'no');
  assert.equal(models.maxTokens(model, quant, NaN), 0);
  assert.equal(models.maxTokens(model, quant, Infinity), model.contextMax);
  const raidOut = raid.computeRaid({ level: '0', drives: 4, driveTb: 1e300 });
  assert.equal(raidOut.ok, false);
  assert.equal(insights.memoryFrontier(Infinity).contextTokens, 0);
});

test('computeRaid and planCleanup degrade gracefully on missing arguments', () => {
  assert.equal(raid.computeRaid().ok, false);
  const plan = tidy.planCleanup();
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.potentialSavingBytes, 0);
  assert.equal(plan.totalLibraryBytes, 0);
});

test('summarizeLibrary cannot be polluted by a proto-named kind', () => {
  const before = {}.count;
  const summary = tidy.summarizeLibrary({ items: [
    { id: 'x', path: 'a/x.jpg', kind: '__proto__', bytes: 10, modified: '2024-01-01', contentHash: 'h' },
    { id: 'y', path: 'a/y.jpg', kind: 'constructor', bytes: 20, modified: '2024-01-01', contentHash: 'h' },
  ] });
  assert.equal(summary.byKind['__proto__'].count, 1);
  assert.equal(summary.byKind['constructor'].count, 1);
  assert.equal({}.count, before);
  assert.equal({}.bytes, undefined);
});

test('hostile drive counts clamp before rendering instead of flooding the DOM', () => {
  const env = makeDom(parsePage('index.html'));
  runApp(env);
  const input = env.getEl('drive-count');
  input.value = '50000';
  input.fire('input');
  const segs = env.getEl('raid-grid').querySelectorAll('.seg').length;
  const declared = Number(input.max);
  const max = declared > 0 ? Math.floor(declared) : 64;
  assert.ok(segs <= max * 5, 'expected at most ' + (max * 5) + ' segments, got ' + segs);
  assert.match(env.getEl('storage-summary').textContent, /capped at the field maximum/);
});

test('a sensor condition with no usable value can never be satisfied', () => {
  const dead = { id: 'd1', name: 'Dead', conditions: [sens('livingTemp', '>', undefined)], actions: [] };
  const other = { id: 'o1', name: 'Other', conditions: [timeW('08:00', '10:00')], actions: [{ device: 'fan', command: 'on' }] };
  assert.equal(rules.rulesCanCooccur(dead, other), false);
  assert.equal(rules.findConflicts([dead, other]).length, 0);
  const bad = { id: 'd2', name: 'Bad op', conditions: [sens('livingTemp', '~', 20)], actions: [] };
  assert.equal(rules.rulesCanCooccur(bad, other), false);
});

test('validateRule flags every shape of rule that can never fire', () => {
  const flagged = (rule) => rules.validateRule(rule).map((i) => i.message).join(' | ');
  assert.match(flagged({ id: 'a', name: 'A', conditions: [sens('livingTemp', '>', 'hot')], actions: [] }), /no usable numeric value/);
  assert.match(flagged({ id: 'b', name: 'B', conditions: [sens('livingTemp', '>', 30), sens('livingTemp', '<', 20)], actions: [] }), /never meet/);
  assert.match(flagged({ id: 'c', name: 'C', conditions: [timeW('08:00', '10:00'), timeW('12:00', '14:00')], actions: [] }), /never overlap/);
  assert.match(flagged({ id: 'd', name: 'D', conditions: [dev('fan', 'sideways')], actions: [] }), /not a state/);
  assert.match(flagged({ id: 'e', name: 'E', conditions: [], actions: [{ device: 'fan', command: 'on' }, { device: 'fan', command: 'off' }] }), /only the last one would run/);
});

test('dryRun flags duplicate rule ids instead of silently colliding', () => {
  const a = { id: 'dup', name: 'First', conditions: [], actions: [] };
  const b = { id: 'dup', name: 'Second', conditions: [], actions: [] };
  const out = rules.dryRun([a, b], []);
  assert.ok(out.validation.some((i) => /shares the id/.test(i.message)));
  assert.equal(rules.findConflicts([a, a]).length, 0);
});

test('exact duplicates require matching sizes, not just a matching hash', () => {
  const manifest = { items: [
    { id: 'a', path: 'x/a.jpg', kind: 'photo', bytes: 100, modified: '2024-01-01', contentHash: 'samehash' },
    { id: 'b', path: 'x/b.jpg', kind: 'photo', bytes: 999, modified: '2024-01-02', contentHash: 'samehash' },
  ] };
  assert.equal(tidy.buildActions(manifest).filter((a2) => a2.class === 'exact').length, 0);
  const same = tidy.summarizeLibrary(manifest);
  assert.equal(same.exactHashGroups, 0);
});

test('a copy pattern claim requires every file to carry a real hash', () => {
  const manifest = { items: [
    { id: 'a', path: 'x/photo.jpg', kind: 'photo', bytes: 100, modified: '2024-01-01', contentHash: 'aaa' },
    { id: 'b', path: 'x/photo (1).jpg', kind: 'photo', bytes: 100, modified: '2024-01-02', contentHash: undefined },
  ] };
  assert.equal(tidy.buildActions(manifest).filter((a2) => a2.class === 'copyPattern').length, 0);
});

test('copy suffixes normalize the same in either order', () => {
  assert.equal(tidy.normalizeName('photo (1) copy.jpg'), tidy.normalizeName('photo copy (1).jpg'));
  assert.equal(tidy.normalizeName('photo (1) copy.jpg'), 'photo');
  assert.equal(tidy.normalizeName('scan copy (2) copy.png'), 'scan');
});

test('planCleanup with a NaN threshold still counts every proposal', () => {
  const manifest = { items: [
    { id: 'a', path: 'x/a.jpg', kind: 'photo', bytes: 100, modified: '2024-01-01', contentHash: 'h1' },
    { id: 'b', path: 'x/b.jpg', kind: 'photo', bytes: 100, modified: '2024-01-02', contentHash: 'h1' },
  ] };
  const plan = tidy.planCleanup(manifest, { minConfidence: NaN });
  assert.equal(plan.actions.length + plan.suppressed.count, 1);
});

test('storageFrontier honours an explicit maxDrives of zero', () => {
  const out = insights.storageFrontier(8, { maxDrives: 0 });
  assert.equal(out.reachableCount, 0);
  assert.ok(out.rows.every((r) => r.config === null));
});

test('cleanupCurve reports no knee on a manifest with nothing to reclaim', () => {
  const out = insights.cleanupCurve({ items: [
    { id: 'a', path: 'x/a.jpg', kind: 'photo', bytes: 100, modified: '2024-06-02', contentHash: 'h1' },
  ] });
  assert.equal(out.knee, null);
});

test('fmtBytes promotes to the next unit instead of rendering 1000.0', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');
  const body = src.match(/function fmtBytes\(bytes\) \{[\s\S]*?\n  \}/)[0];
  const fmtBytes = new Function('return ' + body)();
  assert.equal(fmtBytes(999999999), '1.00 GB');
  assert.equal(fmtBytes(999950000), '1.00 GB');
  assert.equal(fmtBytes(999949999), '999.9 MB');
  assert.equal(fmtBytes(999999), '1.0 MB');
  assert.equal(fmtBytes(999949), '999.9 KB');
  assert.equal(fmtBytes(999.6), '1.0 KB');
  assert.equal(fmtBytes(999.4), '999 B');
  assert.equal(fmtBytes(Infinity), 'Not applicable');
});
