'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tidy = require('../js/tidy.js');
const library = require('../js/data-library.js');

const manifest = library.manifest;

function item(id, path, bytes, modified, hash, extra) {
  return Object.assign({ id: id, path: path, kind: 'photo', bytes: bytes, modified: modified, contentHash: hash }, extra || {});
}

function planFor(items, options) {
  return tidy.planCleanup({ synthetic: true, note: 'test manifest', items: items }, options || {});
}

test('Exact duplicate groups keep exactly one copy', () => {
  const plan = planFor([
    item('a1', 'Photos/dup.jpg', 100, '2024-01-01', 'h1'),
    item('a2', 'Backups/dup.jpg', 100, '2024-01-02', 'h1'),
  ], { minConfidence: 0 });
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0];
  assert.equal(action.class, 'exact');
  assert.equal(action.keep.id, 'a2');
  assert.deepEqual(action.remove.map((i) => i.id), ['a1']);
  assert.equal(plan.potentialSavingBytes, 100);
});

test('Keep newest breaks date ties on the lower path', () => {
  const keeper = tidy.pickKeeper([
    item('b2', 'Backups/same.jpg', 100, '2024-01-02', 'h1'),
    item('b1', 'Photos/same.jpg', 100, '2024-01-02', 'h1'),
  ], true);
  assert.equal(keeper.id, 'b2');
});

test('Keep first option prefers the lowest path instead', () => {
  const plan = planFor([
    item('c1', 'Backups/dup.jpg', 100, '2024-01-02', 'h1'),
    item('c2', 'Photos/dup.jpg', 100, '2024-01-01', 'h1'),
  ], { keepNewest: false, minConfidence: 0 });
  assert.equal(plan.actions[0].keep.id, 'c1');
  assert.equal(plan.actions[0].remove[0].id, 'c2');
});

test('Savings equal the sum of proposed removals', () => {
  const plan = planFor([
    item('d1', 'Photos/a.jpg', 500, '2024-01-01', 'h1'),
    item('d2', 'Backups/a.jpg', 500, '2024-01-01', 'h1'),
    item('d3', 'Photos/b.jpg', 200, '2024-01-01', 'h2'),
    item('d4', 'Photos/c.jpg', 300, '2024-01-01', 'h3'),
  ], { minConfidence: 0 });
  const sum = plan.actions.reduce((total, action) => {
    return total + action.remove.reduce((t, i) => t + i.bytes, 0);
  }, 0);
  assert.equal(plan.potentialSavingBytes, sum);
});

test('Confidence classes rank in strict order', () => {
  const plan = planFor([
    item('e1', 'Photos/x.jpg', 100, '2024-01-01', 'h1'),
    item('e2', 'Backups/x.jpg', 100, '2024-01-01', 'h1'),
    item('e3', 'Photos/y.jpg', 200, '2024-01-01', 'h4', { burstId: 'bz' }),
    item('e4', 'Photos/y2.jpg', 200, '2024-01-01', 'h5', { burstId: 'bz' }),
    item('e5', 'Photos/y3.jpg', 200, '2024-01-01', 'h6', { burstId: 'bz' }),
    item('e6', 'Photos/IMG_5000.jpg', 300, '2024-01-01', 'h7'),
    item('e7', 'Photos/IMG_5000 (1).jpg', 300, '2024-01-01', 'h8'),
    item('e8', 'Screenshots/Screenshot 2023-01-01.png', 400, '2023-01-01', 'h9', { kind: 'screenshot' }),
  ], { minConfidence: 0 });
  assert.deepEqual(plan.actions.map((a) => a.class), ['exact', 'burst', 'copyPattern', 'agedScreenshot']);
});

test('Min confidence filter separates plan from suppressed', () => {
  const plan = planFor([
    item('f1', 'Photos/x.jpg', 100, '2024-01-01', 'h1'),
    item('f2', 'Backups/x.jpg', 100, '2024-01-01', 'h1'),
    item('f3', 'Screenshots/Screenshot 2023-01-01.png', 400, '2023-01-01', 'h9', { kind: 'screenshot' }),
  ], { minConfidence: 0.6 });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].class, 'exact');
  assert.equal(plan.suppressed.count, 1);
  assert.equal(plan.suppressed.bytes, 400);
});

test('Every exact action keeps one copy of its own hash', () => {
  const plan = planFor(manifest.items, {});
  const exact = plan.actions.filter((a) => a.class === 'exact');
  assert.ok(exact.length >= 4);
  for (const action of exact) {
    assert.ok(action.keep, 'exact action must keep a file');
    const hash = action.keep.contentHash;
    assert.ok(action.remove.every((i) => i.contentHash === hash));
    assert.ok(action.remove.every((i) => i.bytes === action.keep.bytes));
  }
});

test('No file is removed by two different actions', () => {
  const plan = planFor(manifest.items, {});
  const removed = [];
  for (const action of plan.actions) {
    for (const removedItem of action.remove) { removed.push(removedItem.id); }
  }
  assert.equal(new Set(removed).size, removed.length);
  for (const action of plan.actions) {
    if (action.keep) {
      assert.equal(removed.includes(action.keep.id), false);
    }
  }
});

test('Burst proposals only remove members of their own burst', () => {
  const plan = planFor(manifest.items, {});
  const bursts = plan.actions.filter((a) => a.class === 'burst');
  assert.ok(bursts.length >= 3);
  for (const action of bursts) {
    const burstId = action.id.slice('burst:'.length);
    assert.ok(action.remove.every((i) => i.burstId === burstId));
    assert.ok(action.keep.burstId === burstId);
  }
});

test('The plan is deterministic across runs', () => {
  const first = JSON.stringify(planFor(manifest.items, {}));
  const second = JSON.stringify(planFor(manifest.items, {}));
  assert.equal(first, second);
});

test('The shipped manifest is labeled synthetic and substantial', () => {
  assert.equal(manifest.synthetic, true);
  assert.match(manifest.note, /synthetic/i);
  assert.ok(manifest.items.length >= 50);
  const summary = tidy.summarizeLibrary(manifest);
  assert.ok(summary.totalBytes > 1e9);
});

test('Every action carries a confidence and a reason', () => {
  const plan = planFor(manifest.items, {});
  for (const action of plan.actions) {
    assert.ok(action.confidence > 0 && action.confidence <= 1);
    assert.ok(action.reason.length > 10);
    assert.ok(tidy.CLASS_LABELS[action.class]);
  }
});

test('Screenshot cutoff excludes newer screenshots', () => {
  const plan = planFor([
    item('g1', 'Screenshots/Screenshot 2023-06-01.png', 100, '2023-06-01', 'h1', { kind: 'screenshot' }),
    item('g2', 'Screenshots/Screenshot 2025-06-01.png', 100, '2025-06-01', 'h2', { kind: 'screenshot' }),
  ], { minConfidence: 0 });
  const shots = plan.actions.filter((a) => a.class === 'agedScreenshot');
  assert.equal(shots.length, 1);
  assert.equal(shots[0].remove[0].id, 'g1');
  assert.equal(shots[0].keep, null);
});

test('Copy pattern needs same size, different hash, and a copy suffix', () => {
  const good = planFor([
    item('h1', 'Photos/IMG_5000.jpg', 300, '2024-01-01', 'h7'),
    item('h2', 'Photos/IMG_5000 (1).jpg', 300, '2024-01-01', 'h8'),
  ], { minConfidence: 0 });
  const goodActions = good.actions.filter((a) => a.class === 'copyPattern');
  assert.equal(goodActions.length, 1);
  assert.equal(goodActions[0].keep.id, 'h1');

  const differentSize = planFor([
    item('i1', 'Photos/IMG_5001.jpg', 300, '2024-01-01', 'h10'),
    item('i2', 'Photos/IMG_5001 (1).jpg', 999, '2024-01-01', 'h11'),
  ], { minConfidence: 0 });
  assert.equal(differentSize.actions.filter((a) => a.class === 'copyPattern').length, 0);

  const sameHash = planFor([
    item('j1', 'Photos/IMG_5002.jpg', 300, '2024-01-01', 'h12'),
    item('j2', 'Photos/IMG_5002 (1).jpg', 300, '2024-01-01', 'h12'),
  ], { minConfidence: 0 });
  assert.equal(sameHash.actions.filter((a) => a.class === 'copyPattern').length, 0);
  assert.equal(sameHash.actions.filter((a) => a.class === 'exact').length, 1);
});

test('Burst groups below three members produce nothing', () => {
  const plan = planFor([
    item('k1', 'Photos/p1.jpg', 200, '2024-01-01', 'h4', { burstId: 'bx' }),
    item('k2', 'Photos/p2.jpg', 200, '2024-01-01', 'h5', { burstId: 'bx' }),
  ], { minConfidence: 0 });
  assert.equal(plan.actions.length, 0);
});

test('Empty libraries plan nothing', () => {
  const plan = planFor([], {});
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.potentialSavingBytes, 0);
  assert.equal(plan.totalLibraryBytes, 0);
});

test('The kind summary adds up to the whole library', () => {
  const summary = tidy.summarizeLibrary(manifest);
  let count = 0;
  let bytes = 0;
  for (const kind of Object.keys(summary.byKind)) {
    count += summary.byKind[kind].count;
    bytes += summary.byKind[kind].bytes;
  }
  assert.equal(count, summary.itemCount);
  assert.equal(bytes, summary.totalBytes);
  assert.equal(summary.exactHashGroups, 5);
  assert.equal(summary.burstSets, 4);
});

test('Name normalization strips copy suffixes case insensitively', () => {
  assert.equal(tidy.normalizeName('IMG_5000 (1).jpg'), 'img_5000');
  assert.equal(tidy.normalizeName('Recipe Scan COPY.pdf'), 'recipe scan');
  assert.equal(tidy.isCopiedName('IMG_5000 (1).jpg'), true);
  assert.equal(tidy.isCopiedName('IMG_5000.jpg'), false);
});
