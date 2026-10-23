'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const raid = require('../js/raid.js');

function close(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6);
}

test('RAID 0 stripes every drive with no overhead', () => {
  const r = raid.computeRaid({ level: '0', drives: 4, driveTb: 8, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 32);
  assert.equal(r.rawTb, 32);
  assert.equal(r.efficiency, 1);
  assert.equal(r.guaranteedFaultTolerance, 0);
});

test('RAID 1 mirror keeps a single drive of capacity', () => {
  const r = raid.computeRaid({ level: '1', drives: 2, driveTb: 8, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 8);
  assert.equal(r.redundancyDrives, 1);
  assert.equal(r.guaranteedFaultTolerance, 1);
  assert.equal(r.bestCaseFaultTolerance, 1);
});

test('RAID 1 fault tolerance grows with mirror width', () => {
  const r = raid.computeRaid({ level: '1', drives: 4, driveTb: 8, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 8);
  assert.equal(r.bestCaseFaultTolerance, 3);
  assert.equal(r.redundancyDrives, 3);
});

test('RAID 5 reserves one parity drive', () => {
  const r = raid.computeRaid({ level: '5', drives: 4, driveTb: 4, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 12);
  assert.equal(r.efficiency, 0.75);
  assert.equal(r.redundancyDrives, 1);
  assert.equal(r.guaranteedFaultTolerance, 1);
});

test('RAID 6 reserves two parity drives', () => {
  const r = raid.computeRaid({ level: '6', drives: 6, driveTb: 8, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 32);
  assert.ok(close(r.efficiency, 32 / 48));
  assert.equal(r.guaranteedFaultTolerance, 2);
});

test('RAID 10 halves raw capacity and survives one failure per pair', () => {
  const r = raid.computeRaid({ level: '10', drives: 4, driveTb: 4, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.usableTb, 8);
  assert.equal(r.efficiency, 0.5);
  assert.equal(r.guaranteedFaultTolerance, 1);
  assert.equal(r.bestCaseFaultTolerance, 2);
});

test('RAID 10 rejects odd drive counts', () => {
  const r = raid.computeRaid({ level: '10', drives: 5, driveTb: 4 });
  assert.equal(r.ok, false);
  assert.match(r.error, /even/);
});

test('RAID 5 rejects too few drives', () => {
  const r = raid.computeRaid({ level: '5', drives: 2, driveTb: 4 });
  assert.equal(r.ok, false);
  assert.match(r.error, /at least 3/);
});

test('Unknown levels and invalid sizes are rejected', () => {
  assert.equal(raid.computeRaid({ level: '7', drives: 4, driveTb: 4 }).ok, false);
  assert.equal(raid.computeRaid({ level: '5', drives: 4, driveTb: 0 }).ok, false);
  assert.equal(raid.computeRaid({ level: '5', drives: 0, driveTb: 4 }).ok, false);
  assert.equal(raid.computeRaid({ level: '5', drives: 2.5, driveTb: 4 }).ok, false);
});

test('A 1 TB drive really holds about 0.9095 TiB', () => {
  const r = raid.computeRaid({ level: '1', drives: 2, driveTb: 1, rebuildMbps: 250 });
  assert.equal(r.ok, true);
  assert.ok(close(r.usableTib, 1e12 / raid.TIB));
  assert.ok(r.usableTib < 1);
});

test('Rebuild time follows bytes divided by throughput', () => {
  const r = raid.computeRaid({ level: '1', drives: 2, driveTb: 8, rebuildMbps: 250 });
  assert.ok(close(r.rebuildHours, 8e12 / (250 * 1e6 * 3600), 1e-9));
});

test('Parity arrays carry a rebuild penalty', () => {
  const mirror = raid.computeRaid({ level: '1', drives: 2, driveTb: 8, rebuildMbps: 250 });
  const parity = raid.computeRaid({ level: '5', drives: 3, driveTb: 8, rebuildMbps: 250 });
  assert.ok(close(parity.rebuildHours, mirror.rebuildHours * 1.25, 1e-9));
});

test('Doubling rebuild speed halves the window', () => {
  const slow = raid.computeRaid({ level: '6', drives: 4, driveTb: 8, rebuildMbps: 250 });
  const fast = raid.computeRaid({ level: '6', drives: 4, driveTb: 8, rebuildMbps: 500 });
  assert.ok(close(slow.rebuildHours, fast.rebuildHours * 2, 1e-9));
});

test('RAID 0 has no rebuild to project', () => {
  const r = raid.computeRaid({ level: '0', drives: 4, driveTb: 8, rebuildMbps: 250 });
  assert.equal(r.rebuildHours, null);
});

test('Efficiency ordering holds across levels for the same bays', () => {
  const zero = raid.computeRaid({ level: '0', drives: 6, driveTb: 4, rebuildMbps: 250 });
  const five = raid.computeRaid({ level: '5', drives: 6, driveTb: 4, rebuildMbps: 250 });
  const six = raid.computeRaid({ level: '6', drives: 6, driveTb: 4, rebuildMbps: 250 });
  const ten = raid.computeRaid({ level: '10', drives: 6, driveTb: 4, rebuildMbps: 250 });
  assert.ok(zero.efficiency > five.efficiency);
  assert.ok(five.efficiency > six.efficiency);
  assert.ok(five.efficiency > ten.efficiency);
  assert.ok(close(ten.efficiency, 0.5));
});

test('RAID 10 with six drives reserves half the bays', () => {
  const r = raid.computeRaid({ level: '10', drives: 6, driveTb: 4, rebuildMbps: 250 });
  assert.equal(r.redundancyDrives, 3);
  assert.equal(r.usableTb, 12);
});

test('Rebuild estimates are reported in the notes', () => {
  const hours = raid.computeRaid({ level: '5', drives: 3, driveTb: 8, rebuildMbps: 250 });
  assert.ok(hours.notes.some((n) => /hours/.test(n)));
  const days = raid.computeRaid({ level: '6', drives: 8, driveTb: 30, rebuildMbps: 80 });
  assert.ok(days.notes.some((n) => /days/.test(n)));
});
