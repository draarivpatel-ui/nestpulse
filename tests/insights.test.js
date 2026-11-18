/* insights.test.js - unit, invariant and regression tests for the frontier
   searches and graph diagnostics. Every frontier point is checked against a
   direct call to the underlying math module. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const raid = require('../js/raid.js');
const models = require('../js/models.js');
const tidy = require('../js/tidy.js');
const rules = require('../js/rules.js');
const insights = require('../js/insights.js');
const library = require('../js/data-library.js');
const ruleSet = require('../js/data-rules.js');
const logs = require('../js/data-sensors.js');

const LOGS = logs.buildLogs();
const RULES = ruleSet.rules;
const MANIFEST = library.manifest;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/* ------------------------------ helpers -------------------------------- */

test('INS 01: round and clamp behave deterministically at boundaries', () => {
  assert.equal(insights.round(1.23456, 2), 1.23);
  assert.equal(insights.round(1.235, 2), 1.24);
  assert.equal(insights.clamp(-3, 0, 1), 0);
  assert.equal(insights.clamp(5, 0, 1), 1);
  assert.equal(insights.clamp(0.5, 0, 1), 0.5);
});

/* --------------------------- storage frontier --------------------------- */

test('INS 02: the default frontier spans 5 levels and 6 drive sizes', () => {
  const f = insights.storageFrontier(24);
  assert.equal(f.totalCount, 30);
  assert.equal(f.levels.length, 5);
  assert.equal(f.driveSizesTb.length, 6);
  assert.equal(f.rows.length, 30);
  assert.equal(f.targetTb, 24);
});

test('INS 03: every reachable frontier config actually reaches the target', () => {
  for (const row of insights.storageFrontier(24).rows) {
    if (!row.config) continue;
    const direct = raid.computeRaid({ level: row.level, drives: row.config.drives, driveTb: row.driveTb, rebuildMbps: 200 });
    assert.equal(direct.ok, true);
    assert.ok(direct.usableTb + 1e-9 >= 24);
    assert.equal(row.config.usableTb, insights.round(direct.usableTb, 2));
    assert.equal(row.config.efficiency, insights.round(direct.efficiency, 4));
  }
});

test('INS 04: the chosen drive count is minimal for its level and size', () => {
  for (const row of insights.storageFrontier(24).rows) {
    if (!row.config || row.config.drives <= 2) continue;
    const smaller = raid.computeRaid({ level: row.level, drives: row.config.drives - 1, driveTb: row.driveTb, rebuildMbps: 200 });
    assert.ok(!smaller.ok || smaller.usableTb < 24, `${row.level} x ${row.driveTb} TB could use fewer drives`);
  }
});

test('INS 05: an impossible target leaves every config unreachable', () => {
  const f = insights.storageFrontier(100000);
  assert.equal(f.reachableCount, 0);
  assert.equal(f.bestRawEfficiency, null);
});

test('INS 06: a zero target is reachable by every valid configuration', () => {
  const f = insights.storageFrontier(0);
  assert.ok(f.reachableCount > 0);
  assert.ok(f.rows.every((r) => r.config !== null));
});

test('INS 07: the cheapest raw config ties to the lowest raw TB row', () => {
  const f = insights.storageFrontier(24);
  const reachable = f.rows.filter((r) => r.config);
  const minRaw = Math.min(...reachable.map((r) => r.config.rawTb));
  assert.equal(f.bestRawEfficiency.config.rawTb, minRaw);
});

test('INS 08: custom levels and sizes are honored', () => {
  const f = insights.storageFrontier(8, { levels: ['1', '5'], driveSizesTb: [4, 8], maxDrives: 6 });
  assert.equal(f.totalCount, 4);
  assert.deepEqual(f.levels, ['1', '5']);
  assert.deepEqual(f.driveSizesTb, [4, 8]);
  assert.ok(f.rows.every((r) => r.config === null || r.config.drives <= 6));
});

test('INS 09: invariant: all frontier numbers are finite and bounded', () => {
  for (const target of [0, 4, 24, 80, 100000]) {
    const f = insights.storageFrontier(target);
    for (const row of f.rows) {
      assert.ok(finite(row.driveTb) && finite(row.targetTb));
      if (!row.config) continue;
      assert.ok(finite(row.config.drives) && row.config.drives >= 2);
      assert.ok(finite(row.config.usableTb) && row.config.usableTb >= 0);
      assert.ok(row.config.efficiency >= 0 && row.config.efficiency <= 1);
    }
  }
});

test('INS 10: regression: 24 TB is reachable by 23 of 30 shipped configurations', () => {
  const f = insights.storageFrontier(24);
  assert.equal(f.reachableCount, 23);
  assert.equal(f.totalCount, 30);
  assert.equal(f.bestRawEfficiency.level, '0');
  assert.equal(f.bestRawEfficiency.driveTb, 12);
  assert.equal(f.bestRawEfficiency.config.drives, 2);
});

/* ---------------------------- memory frontier -------------------------- */

test('INS 11: every catalog entry gets a row at the default context', () => {
  const f = insights.memoryFrontier(8192);
  assert.equal(f.catalogCount, models.CATALOG.length);
  assert.equal(f.rows.length, 14);
  assert.equal(f.contextTokens, 8192);
});

test('INS 12: the exact threshold is a real fit boundary', () => {
  const f = insights.memoryFrontier(8192);
  for (const row of f.rows) {
    if (row.exactThresholdGb === null) continue;
    const at = models.bestQuant(models.CATALOG.find((m) => m.id === row.id), row.exactThresholdGb * 1e9, 8192);
    const below = models.bestQuant(models.CATALOG.find((m) => m.id === row.id), (row.exactThresholdGb - 0.01) * 1e9, 8192);
    assert.ok(at, `${row.id} should fit at its threshold`);
    assert.equal(row.quantAtThreshold, at.label, `${row.id} should report the quantization at its exact threshold`);
    assert.equal(below, null, `${row.id} should not fit just below its threshold`);
  }
});

test('INS 13: weight and KV components match the models module exactly', () => {
  const f = insights.memoryFrontier(8192);
  const smallest = models.QUANTS[0];
  for (const row of f.rows) {
    const model = models.CATALOG.find((m) => m.id === row.id);
    assert.equal(row.weightGbAtSmallest, insights.round(models.weightBytes(model.params, smallest.bitsPerWeight) / 1e9, 3));
    assert.equal(row.kvGbAtContext, insights.round(models.kvBytes(model, 8192) / 1e9, 3));
  }
});

test('INS 14: the cheapest and most demanding entries are the extremes of the fit column', () => {
  const f = insights.memoryFrontier(8192);
  const thresholds = f.rows.filter((r) => r.exactThresholdGb !== null).map((r) => r.exactThresholdGb);
  assert.equal(f.cheapest.exactThresholdGb, Math.min(...thresholds));
  assert.equal(f.mostDemanding.exactThresholdGb, Math.max(...thresholds));
});

test('INS 15: a longer context raises every exact threshold', () => {
  const short = insights.memoryFrontier(1024);
  const long = insights.memoryFrontier(32768);
  for (const a of short.rows) {
    const b = long.rows.find((r) => r.id === a.id);
    assert.ok(b.exactThresholdGb >= a.exactThresholdGb, `${a.id} got cheaper with a longer context`);
  }
});

test('INS 16: an impossible budget grid reports no fits', () => {
  const f = insights.memoryFrontier(8192, { budgetsGb: [0.001] });
  assert.equal(f.fittingCount, 0);
  assert.equal(f.cheapest, null);
  assert.equal(f.mostDemanding, null);
});

test('INS 17: invariant: every frontier row is finite and nonnegative', () => {
  for (const tokens of [0, 1024, 8192, 65536]) {
    for (const row of insights.memoryFrontier(tokens).rows) {
      assert.ok(finite(row.params) && row.params > 0);
      assert.ok(finite(row.weightGbAtSmallest) && row.weightGbAtSmallest >= 0);
      assert.ok(finite(row.kvGbAtContext) && row.kvGbAtContext >= 0);
      assert.ok(row.exactThresholdGb === null || (finite(row.exactThresholdGb) && row.exactThresholdGb >= 0));
    }
  }
});

test('INS 18: regression: the exact cheapest and most demanding thresholds', () => {
  const f = insights.memoryFrontier(8192);
  assert.equal(f.fittingCount, 14);
  assert.equal(f.cheapest.id, 'tiny-06');
  assert.equal(f.cheapest.exactThresholdGb, 2.165);
  assert.equal(f.mostDemanding.id, 'xxl-70');
  assert.equal(f.mostDemanding.exactThresholdGb, 29.935);
});

/* ----------------------------- cleanup curve --------------------------- */

test('INS 19: the curve is monotone nonincreasing in the threshold', () => {
  const curve = insights.cleanupCurve(MANIFEST);
  assert.equal(curve.rows.length, 15);
  for (let i = 1; i < curve.rows.length; i += 1) {
    assert.ok(curve.rows[i].savingBytes <= curve.rows[i - 1].savingBytes);
    assert.ok(curve.rows[i].actionCount <= curve.rows[i - 1].actionCount);
  }
});

test('INS 20: every curve row agrees with a direct planCleanup call', () => {
  const curve = insights.cleanupCurve(MANIFEST);
  for (const row of curve.rows) {
    const plan = tidy.planCleanup(MANIFEST, { minConfidence: row.threshold });
    assert.equal(row.actionCount, plan.actions.length);
    assert.equal(row.savingBytes, plan.potentialSavingBytes);
    assert.equal(row.suppressedCount, plan.suppressed.count);
  }
});

test('INS 21: the knee is the largest single marginal byte loss', () => {
  const curve = insights.cleanupCurve(MANIFEST);
  let biggest = -1;
  for (let i = 1; i < curve.rows.length; i += 1) {
    biggest = Math.max(biggest, curve.rows[i - 1].savingBytes - curve.rows[i].savingBytes);
  }
  assert.equal(curve.knee.bytesLost, biggest);
  assert.ok(curve.knee.bytesLost > 0);
});

test('INS 22: a custom threshold list is honored', () => {
  const curve = insights.cleanupCurve(MANIFEST, { thresholds: [0, 0.5, 1] });
  assert.deepEqual(curve.rows.map((r) => r.threshold), [0, 0.5, 1]);
  assert.equal(curve.rows.length, 3);
});

test('INS 23: an empty manifest produces a flat zero curve', () => {
  const curve = insights.cleanupCurve({ items: [] });
  assert.ok(curve.rows.every((r) => r.actionCount === 0 && r.savingBytes === 0));
  assert.equal(curve.maxSavingBytes, 0);
});

test('INS 24: regression: the shipped library curve endpoints and maximum', () => {
  const curve = insights.cleanupCurve(MANIFEST);
  assert.equal(curve.maxSavingBytes, 725966002);
  assert.equal(curve.finalSavingBytes, 0);
  assert.equal(curve.knee.from, 1);
  assert.equal(curve.knee.to, 1.01);
});

/* ---------------------------- conflict graph --------------------------- */

test('INS 25: the graph covers all nine rules and all four conflicts', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  assert.equal(g.ruleCount, 9);
  assert.equal(g.conflictCount, 4);
  assert.equal(g.validationCount, 1);
  assert.equal(g.totalFires, 127);
});

test('INS 26: component sizes add up to the rule count', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  assert.equal(g.components.reduce((s, c) => s + c.size, 0), 9);
  const all = g.components.flatMap((c) => c.members);
  assert.equal(new Set(all).size, 9);
  assert.deepEqual(all.slice().sort(), RULES.map((r) => r.id).sort());
});

test('INS 27: severity counts equal the ranking and the conflict total', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  const totalPairs = g.ranking.reduce((s, r) => s + r.count, 0);
  assert.equal(totalPairs, g.conflictCount * 2);
  assert.ok(g.ranking.every((r) => finite(r.weighted) && r.weighted >= 0));
  assert.ok(g.mostEntangled);
  assert.equal(g.mostEntangled.weighted, Math.max(...g.ranking.map((r) => r.weighted)));
});

test('INS 28: contradictions carry more weight than shadowed findings', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  const r8 = g.ranking.find((r) => r.id === 'r8');
  assert.equal(r8.contradiction, 2);
  assert.equal(r8.weighted, 6);
});

test('INS 29: a rule set with no conflicts yields all isolated components', () => {
  const g = insights.conflictGraph([RULES[0]], LOGS);
  assert.equal(g.conflictCount, 0);
  assert.equal(g.components.length, 1);
  assert.equal(g.isolatedCount, 1);
  assert.equal(g.mostEntangled, null);
});

test('INS 30: components are sorted by size then by first member', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  for (let i = 1; i < g.components.length; i += 1) {
    assert.ok(g.components[i - 1].size >= g.components[i].size);
  }
  assert.deepEqual(g.components[0].members, [...g.components[0].members].sort());
});

test('INS 31: regression: the largest component and the most entangled rule', () => {
  const g = insights.conflictGraph(RULES, LOGS);
  assert.equal(g.largestComponent.size, 3);
  assert.deepEqual(g.largestComponent.members, ['r3', 'r5', 'r8']);
  assert.equal(g.isolatedCount, 4);
  assert.equal(g.mostEntangled.id, 'r8');
  assert.equal(g.mostEntangled.weighted, 6);
});

/* ------------------------------- digest -------------------------------- */

test('INS 32: buildDigest assembles all four panels', () => {
  const d = insights.buildDigest(MANIFEST, RULES, LOGS, { targetTb: 24, tokens: 8192 });
  assert.deepEqual(Object.keys(d).sort(), ['cleanup', 'memory', 'rules', 'storage']);
  assert.equal(d.storage.reachableCount, 23);
  assert.equal(d.memory.fittingCount, 14);
  assert.equal(d.rules.conflictCount, 4);
  assert.equal(d.cleanup.stepCount, 15);
});

test('INS 33: the digest is deterministic across repeated builds', () => {
  const a = insights.buildDigest(MANIFEST, RULES, LOGS, { targetTb: 24, tokens: 8192 });
  const b = insights.buildDigest(MANIFEST, RULES, LOGS, { targetTb: 24, tokens: 8192 });
  assert.deepEqual(a, b);
});

test('INS 34: a larger target reduces the reachable storage count', () => {
  const small = insights.buildDigest(MANIFEST, RULES, LOGS, { targetTb: 8, tokens: 8192 });
  const large = insights.buildDigest(MANIFEST, RULES, LOGS, { targetTb: 100000, tokens: 8192 });
  assert.ok(large.storage.reachableCount <= small.storage.reachableCount);
  assert.equal(large.storage.reachableCount, 0);
});
