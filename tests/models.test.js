'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../js/models.js');

const llama = { id: 't-llama', name: 'Test 8B', params: 8, layers: 32, kvDim: 1024, contextMax: 131072 };
const narrow = { id: 't-narrow', name: 'Test Narrow 8B', params: 8, layers: 32, kvDim: 512, contextMax: 131072 };
const q4 = { id: 'q4t', label: 'Q4 T', bitsPerWeight: 4.8 };

function close(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6);
}

test('Weight bytes follow params times bits over eight', () => {
  assert.ok(close(models.weightBytes(7, 4.8), 4.2e9, 1));
  assert.ok(close(models.weightBytes(0.6, 16), 1.2e9, 1));
});

test('Weight size scales linearly with bits per weight', () => {
  assert.equal(models.weightBytes(3, 6), models.weightBytes(3, 3) * 2);
});

test('KV cache per token uses two fp16 tensors per layer', () => {
  assert.equal(models.kvBytesPerToken(llama), 2 * 32 * 1024 * 2);
  assert.equal(models.kvBytesPerToken(llama), 131072);
});

test('KV cache scales linearly with context length', () => {
  assert.equal(models.kvBytes(llama, 8192), models.kvBytes(llama, 1024) * 8);
  assert.equal(models.kvBytes(llama, 0), 0);
});

test('Narrower KV heads shrink the cache proportionally', () => {
  assert.equal(models.kvBytesPerToken(llama), models.kvBytesPerToken(narrow) * 2);
});

test('Total bytes are weights plus KV plus runtime overhead', () => {
  const total = models.totalBytes(llama, q4, 8192);
  assert.equal(total, models.weightBytes(8, 4.8) + models.kvBytes(llama, 8192) + models.RUNTIME_OVERHEAD_BYTES);
});

test('A model that exactly fills the budget still fits, but tight', () => {
  const total = models.totalBytes(llama, q4, 8192);
  const check = models.fitCheck(llama, q4, total, 8192);
  assert.equal(check.fits, true);
  assert.equal(check.verdict, 'tight');
  assert.equal(check.freeBytes, 0);
  assert.equal(check.shortfallBytes, 0);
});

test('At 80 percent utilization the verdict is comfortable', () => {
  const total = models.totalBytes(llama, q4, 8192);
  const check = models.fitCheck(llama, q4, total / 0.8, 8192);
  assert.ok(close(check.utilization, 0.8));
  assert.equal(check.verdict, 'comfortable');
});

test('Over budget models report a shortfall', () => {
  const total = models.totalBytes(llama, q4, 8192);
  const check = models.fitCheck(llama, q4, total - 1e9, 8192);
  assert.equal(check.fits, false);
  assert.equal(check.verdict, 'no');
  assert.equal(check.shortfallBytes, 1e9);
  assert.equal(check.freeBytes, -1e9);
});

test('Max context is floored to whole tokens', () => {
  const budget = 16e9;
  const perToken = models.kvBytesPerToken(llama);
  const expected = Math.floor((budget - models.weightBytes(8, 4.8) - models.RUNTIME_OVERHEAD_BYTES) / perToken);
  assert.equal(models.maxTokens(llama, q4, budget), expected);
  assert.ok(expected > 0);
  assert.equal(models.fitCheck(llama, q4, budget, expected).fits, true);
  assert.equal(models.fitCheck(llama, q4, budget, expected + 1).fits, false);
});

test('Max context is zero when weights alone overflow the budget', () => {
  assert.equal(models.maxTokens(llama, q4, 2e9), 0);
});

test('Best quantization climbs as the budget grows', () => {
  const tiny = models.bestQuant(llama, 4.5e9, 0);
  const small = models.bestQuant(llama, 5.5e9, 0);
  const large = models.bestQuant(llama, 10e9, 0);
  const huge = models.bestQuant(llama, 20e9, 0);
  assert.equal(tiny.id, 'q2k');
  assert.equal(small.id, 'q3km');
  assert.equal(large.id, 'q8');
  assert.equal(huge.id, 'f16');
  assert.ok(tiny.bitsPerWeight <= small.bitsPerWeight);
  assert.ok(small.bitsPerWeight <= large.bitsPerWeight);
  assert.ok(large.bitsPerWeight <= huge.bitsPerWeight);
});

test('Nothing fits an impossible budget', () => {
  assert.equal(models.bestQuant(llama, models.RUNTIME_OVERHEAD_BYTES, 0), null);
  const check = models.fitCheck(llama, q4, models.RUNTIME_OVERHEAD_BYTES, 0);
  assert.equal(check.fits, false);
  assert.ok(check.shortfallBytes > 0);
});

test('The arithmetic line names the model, quant, and totals', () => {
  const line = models.arithmeticLine(llama, q4, 8192, 8e9);
  assert.ok(line.includes('Test 8B'));
  assert.ok(line.includes('Q4 T'));
  assert.ok(line.includes('GB'));
  assert.ok(line.includes('8,192'));
});

test('Catalog integrity: unique ids, positive specs, sorted quants', () => {
  const ids = new Set(models.CATALOG.map((m) => m.id));
  assert.equal(ids.size, models.CATALOG.length);
  assert.ok(models.CATALOG.length >= 12);
  for (const model of models.CATALOG) {
    assert.ok(model.params > 0);
    assert.ok(model.layers > 0);
    assert.ok(model.kvDim > 0);
    assert.ok(model.contextMax > 0);
  }
  for (let i = 1; i < models.QUANTS.length; i += 1) {
    assert.ok(models.QUANTS[i].bitsPerWeight > models.QUANTS[i - 1].bitsPerWeight);
  }
});

test('Qwen3 8B at Q4 K M weighs about 4.92 GB', () => {
  const qwen = models.CATALOG.find((m) => m.id === 'qwen3-8b');
  const q4km = models.QUANTS.find((q) => q.id === 'q4km');
  assert.ok(close(models.weightBytes(qwen.params, q4km.bitsPerWeight), 4.92e9, 1e6));
});

test('The distill model carries a smaller cache than its same size peer', () => {
  const distill = models.CATALOG.find((m) => m.id === 'ds-r1-qwen-7b');
  const mistral = models.CATALOG.find((m) => m.id === 'mistral-7b');
  assert.ok(models.kvBytesPerToken(distill) < models.kvBytesPerToken(mistral));
});
