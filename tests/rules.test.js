'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ruleForge = require('../js/rules.js');
const ruleSet = require('../js/data-rules.js');
const sensorLogs = require('../js/data-sensors.js');

function sens(sensor, op, value) {
  return { type: 'sensor', sensor: sensor, op: op, value: value };
}
function time(start, end) {
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

function kinds(conflicts) {
  return conflicts.map((c) => c.kind).sort();
}

test('Adjacent and disjoint time windows never overlap', () => {
  assert.equal(ruleForge.windowsOverlap(time('18:30', '23:00'), time('23:00', '06:00')), false);
  assert.equal(ruleForge.windowsOverlap(time('06:00', '09:00'), time('09:00', '12:00')), false);
  assert.equal(ruleForge.windowsOverlap(time('06:00', '09:00'), time('10:00', '12:00')), false);
  assert.equal(ruleForge.windowsOverlap(time('06:00', '09:00'), time('08:00', '12:00')), true);
  assert.equal(ruleForge.windowsOverlap(time('06:00', '09:00'), time('05:00', '07:00')), true);
});

test('Overnight windows wrap past midnight', () => {
  const night = time('23:00', '06:00');
  assert.deepEqual(ruleForge.windowSegments(night), [[1380, 1440], [0, 360]]);
  assert.equal(ruleForge.windowsOverlap(night, time('01:00', '03:00')), true);
  assert.equal(ruleForge.windowsOverlap(night, time('12:00', '14:00')), false);
  assert.equal(ruleForge.windowsOverlap(night, time('07:00', '12:00')), false);
  assert.equal(ruleForge.minuteInWindow(1380, night), true);
  assert.equal(ruleForge.minuteInWindow(0, night), true);
  assert.equal(ruleForge.minuteInWindow(359, night), true);
  assert.equal(ruleForge.minuteInWindow(360, night), false);
  assert.equal(ruleForge.minuteInWindow(720, night), false);
});

test('Sensor intervals intersect only on shared range', () => {
  const I = ruleForge.intervalsIntersect;
  assert.equal(I(ruleForge.sensorInterval(sens('t', '>', 25)), ruleForge.sensorInterval(sens('t', '<', 20))), false);
  assert.equal(I(ruleForge.sensorInterval(sens('t', '>', 25)), ruleForge.sensorInterval(sens('t', '>', 20))), true);
  assert.equal(I(ruleForge.sensorInterval(sens('t', '==', 25)), ruleForge.sensorInterval(sens('t', '>', 25))), false);
  assert.equal(I(ruleForge.sensorInterval(sens('t', '>=', 25)), ruleForge.sensorInterval(sens('t', '<=', 25))), true);
  assert.equal(I(ruleForge.sensorInterval(sens('t', '>', 25)), ruleForge.sensorInterval(sens('t', '>=', 25))), true);
});

test('Exclusive thresholds prevent a contradiction', () => {
  const a = mkRule('a', 'Hot Lamp', [sens('livingTemp', '>', 25)], [act('deskLamp', 'on')]);
  const b = mkRule('b', 'Cold Lamp', [sens('livingTemp', '<', 20)], [act('deskLamp', 'off')]);
  assert.deepEqual(ruleForge.findConflicts([a, b]), []);
  assert.equal(ruleForge.rulesCanCooccur(a, b), false);
});

test('Overlapping thresholds with opposite commands conflict', () => {
  const a = mkRule('a', 'Hot Lamp', [sens('livingTemp', '>', 25)], [act('deskLamp', 'on')]);
  const b = mkRule('b', 'Warm Lamp Off', [sens('livingTemp', '>', 21)], [act('deskLamp', 'off')]);
  const conflicts = ruleForge.findConflicts([a, b]);
  assert.deepEqual(kinds(conflicts), ['contradiction']);
  assert.equal(conflicts[0].device, 'deskLamp');
});

test('Disjoint time windows prevent a contradiction', () => {
  const a = mkRule('a', 'Morning Lamp', [time('06:00', '09:00')], [act('deskLamp', 'on')]);
  const b = mkRule('b', 'Midday Lamp Off', [time('10:00', '12:00')], [act('deskLamp', 'off')]);
  assert.deepEqual(ruleForge.findConflicts([a, b]), []);
  const overlapping = mkRule('b2', 'Late Morning Lamp Off', [time('08:00', '12:00')], [act('deskLamp', 'off')]);
  assert.deepEqual(kinds(ruleForge.findConflicts([a, overlapping])), ['contradiction']);
});

test('Disagreeing device preconditions prevent a contradiction', () => {
  const a = mkRule('a', 'Heater Off Lamp', [dev('heater', 'off')], [act('deskLamp', 'on')]);
  const b = mkRule('b', 'Heater On Lamp Off', [dev('heater', 'on')], [act('deskLamp', 'off')]);
  assert.deepEqual(ruleForge.findConflicts([a, b]), []);
  const agreeing = mkRule('b2', 'Also Heater Off Lamp Off', [dev('heater', 'off')], [act('deskLamp', 'off')]);
  assert.deepEqual(kinds(ruleForge.findConflicts([a, agreeing])), ['contradiction']);
});

test('Identical rules report duplicate effect, not shadowing', () => {
  const a = mkRule('a', 'Fan One', [sens('livingTemp', '>', 25)], [act('fan', 'on')]);
  const b = mkRule('b', 'Fan Two', [sens('livingTemp', '>', 25)], [act('fan', 'on')]);
  const conflicts = ruleForge.findConflicts([a, b]);
  assert.deepEqual(kinds(conflicts), ['duplicateEffect']);
});

test('A narrower twin is reported as shadowed', () => {
  const narrow = mkRule('n', 'Warm Room Fan', [sens('livingTemp', '>', 25), time('10:00', '18:00')], [act('fan', 'on')]);
  const wide = mkRule('w', 'Warm Room Airflow', [sens('livingTemp', '>', 21)], [act('fan', 'on')]);
  const conflicts = ruleForge.findConflicts([narrow, wide]);
  assert.deepEqual(kinds(conflicts), ['shadowed']);
  assert.equal(conflicts[0].ruleA, 'n');
  assert.equal(ruleForge.conditionsImply(narrow, wide), true);
  assert.equal(ruleForge.conditionsImply(wide, narrow), false);
});

test('Implication respects interval and window containment', () => {
  assert.equal(ruleForge.conditionCovers(sens('t', '>', 25), sens('t', '>', 21)), true);
  assert.equal(ruleForge.conditionCovers(sens('t', '>', 21), sens('t', '>', 25)), false);
  assert.equal(ruleForge.conditionCovers(sens('t', '==', 25), sens('t', '>=', 25)), true);
  assert.equal(ruleForge.conditionCovers(sens('t', '>=', 25), sens('t', '>', 25)), false);
  assert.equal(ruleForge.conditionCovers(time('14:00', '16:00'), time('10:00', '18:00')), true);
  assert.equal(ruleForge.conditionCovers(time('10:00', '18:00'), time('14:00', '16:00')), false);
  assert.equal(ruleForge.conditionCovers(sens('t', '>', 25), sens('u', '>', 21)), false);
});

test('Validation flags unknown sensors, devices, operators, and empty windows', () => {
  const ghostSensor = ruleForge.validateRule(mkRule('v1', 'Ghost', [sens('co2Ppm', '>', 1200)], [act('speaker', 'on')]));
  assert.ok(ghostSensor.some((i) => /co2Ppm/.test(i.message)));

  const ghostDevice = ruleForge.validateRule(mkRule('v2', 'Ghost Device', [sens('livingTemp', '>', 25)], [act('moonlight', 'on')]));
  assert.ok(ghostDevice.some((i) => /moonlight/.test(i.message)));

  const zeroWindow = ruleForge.validateRule(mkRule('v3', 'Zero Window', [time('06:00', '06:00')], [act('fan', 'on')]));
  assert.ok(zeroWindow.some((i) => /zero minutes/.test(i.message)));

  const badOp = ruleForge.validateRule(mkRule('v4', 'Bad Op', [sens('livingTemp', '~', 25)], [act('fan', 'on')]));
  assert.ok(badOp.some((i) => /operator/.test(i.message)));

  const clean = ruleForge.validateRule(mkRule('v5', 'Clean', [sens('livingTemp', '>', 25)], [act('fan', 'on')]));
  assert.deepEqual(clean, []);
});

test('Rules fire exactly when every condition matches the log', () => {
  const logs = [
    { t: '2026-01-12T08:00', livingTemp: 26.5 },
    { t: '2026-01-12T09:00', livingTemp: 21 },
    { t: '2026-01-12T15:00', livingTemp: 27 },
    { t: '2026-01-12T23:30', livingTemp: 18 },
  ];
  const hot = mkRule('hot', 'Hot', [sens('livingTemp', '>', 25)], [act('fan', 'on')]);
  const run = ruleForge.dryRun([hot], logs);
  assert.equal(run.reports[0].fires, 2);
  assert.deepEqual(run.reports[0].exampleTimes, ['2026-01-12T08:00', '2026-01-12T15:00']);
});

test('Overnight rules count the night hours', () => {
  const logs = [
    { t: '2026-01-12T23:30' },
    { t: '2026-01-13T05:00' },
    { t: '2026-01-13T12:00' },
  ];
  const night = mkRule('n', 'Night', [time('23:00', '06:00')], [act('porchLight', 'on')]);
  const run = ruleForge.dryRun([night], logs);
  assert.equal(run.reports[0].fires, 2);
});

test('Device conditions read the logged device state', () => {
  const logs = [
    { t: '2026-01-12T10:00', devices: { heater: 'off' } },
    { t: '2026-01-12T11:00', devices: { heater: 'on' } },
  ];
  const rule = mkRule('d', 'Needs Heater Off', [dev('heater', 'off')], [act('deskLamp', 'on')]);
  const run = ruleForge.dryRun([rule], logs);
  assert.equal(run.reports[0].fires, 1);
  assert.deepEqual(run.reports[0].exampleTimes, ['2026-01-12T10:00']);
});

test('Dry run counts match an independent filter on the demo logs', () => {
  const logs = sensorLogs.buildLogs();
  const run = ruleForge.dryRun(ruleSet.rules, logs);
  const warmRoomFan = run.reports.find((r) => r.ruleId === 'r3');
  const independent = logs.filter((log) => {
    const hour = Number(log.t.slice(11, 13));
    return log.livingTemp > 25 && hour >= 10 && hour < 18;
  }).length;
  assert.equal(warmRoomFan.fires, independent);
  assert.ok(warmRoomFan.fires >= 10);
  assert.ok(warmRoomFan.fires <= 20);
});

test('Predicted contradictions are checked against the demo logs', () => {
  const logs = sensorLogs.buildLogs();
  const run = ruleForge.dryRun(ruleSet.rules, logs);
  const contradictions = run.pairs.filter((p) => p.kind === 'contradiction');
  assert.ok(contradictions.length >= 2);
  const observed = contradictions.find((p) => p.coFires >= 1);
  assert.ok(observed, 'at least one contradiction should co-fire on the demo logs');
  const unobserved = contradictions.find((p) => p.coFires === 0);
  assert.ok(unobserved, 'the hall light pair should never co-fire');
  assert.match(unobserved.observedLine, /Never actually co-fired/);
});

test('The shadowed rule adds no fires of its own on the demo logs', () => {
  const logs = sensorLogs.buildLogs();
  const run = ruleForge.dryRun(ruleSet.rules, logs);
  const shadow = run.pairs.find((p) => p.kind === 'shadowed');
  assert.ok(shadow, 'the shipped rules include one shadowed pair');
  assert.equal(shadow.ruleA, 'r3');
  assert.equal(shadow.ruleB, 'r5');
  assert.equal(shadow.fullyShadowed, true);
  assert.equal(shadow.narrowOnlyFires, 0);
  assert.ok(shadow.narrowFires > 0);
});

test('Logs are deterministic, hourly, and labeled synthetic', () => {
  assert.equal(sensorLogs.synthetic, true);
  const first = sensorLogs.buildLogs();
  const second = sensorLogs.buildLogs();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.length, 72);
  assert.equal(first[0].t, '2026-01-12T00:00');
  assert.equal(first[71].t, '2026-01-14T23:00');
});

test('The shipped rule set surfaces its planted unknown sensor', () => {
  const logs = sensorLogs.buildLogs();
  const run = ruleForge.dryRun(ruleSet.rules, logs);
  assert.ok(run.validation.some((issue) => issue.ruleId === 'r9' && /co2Ppm/.test(issue.message)));
  const quiet = run.reports.find((r) => r.ruleId === 'r9');
  assert.equal(quiet.fires, 0);
});

test('Condition and action copy reads cleanly', () => {
  assert.equal(ruleForge.describeCondition(time('23:00', '06:00')), 'Overnight from 23:00 to 06:00');
  assert.equal(ruleForge.describeCondition(time('18:30', '23:00')), 'Daily from 18:30 to 23:00');
  assert.equal(ruleForge.describeCondition(sens('livingTemp', '>', 25)), 'Living room temperature above 25 C');
  assert.equal(ruleForge.describeCondition(sens('motionHall', '==', 1)), 'Hall motion detected');
  assert.equal(ruleForge.describeCondition(sens('motionHall', '==', 0)), 'No hall motion');
  assert.equal(ruleForge.describeAction(act('fan', 'on')), 'Turn Fan on');
});

test('The adjacent porch pair stays conflict free on paper and in the logs', () => {
  const logs = sensorLogs.buildLogs();
  const run = ruleForge.dryRun(ruleSet.rules, logs);
  const evening = run.reports.find((r) => r.ruleId === 'r1');
  const night = run.reports.find((r) => r.ruleId === 'r2');
  assert.ok(evening.fires > 0);
  assert.ok(night.fires > 0);
  const pair = run.pairs.find((p) => (p.ruleA === 'r1' && p.ruleB === 'r2') || (p.ruleA === 'r2' && p.ruleB === 'r1'));
  assert.equal(pair, undefined);
});
