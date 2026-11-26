'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('reduced motion also freezes segmented control state transitions', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*button,\s*\.seg-btn,\s*\.util-fill\s*\{\s*transition:\s*none !important;/);
});

test('print media strips interactive navigation links as well as controls', () => {
  assert.match(css, /@media print[\s\S]*a,\s*button,\s*input,\s*select,\s*summary\s*\{\s*display:\s*none !important;/);
});

test('print media hides the interactive resilience chart', () => {
  assert.match(css, /@media print[\s\S]*\.lab-chart-wrap,/);
});

test('print media protects article cards and removes fixed bench rails', () => {
  assert.match(css, /@media print[\s\S]*body::before\s*\{\s*content:\s*none !important;\s*display:\s*none !important;/);
  assert.match(css, /@media print[\s\S]*\.ledger,\s*article\s*\{[\s\S]*break-inside:\s*avoid;/);
});

test('print media remaps the dark bench tokens to black on white', () => {
  assert.match(css, /@media print[\s\S]*:root\s*\{[\s\S]*--bg:\s*#ffffff;/);
  assert.match(css, /@media print[\s\S]*:root\s*\{[\s\S]*--ink:\s*#000000;/);
  assert.match(css, /@media print[\s\S]*:root\s*\{[\s\S]*--muted:\s*#333333;/);
  assert.match(css, /@media print[\s\S]*:root\s*\{[\s\S]*--faint:\s*#444444;/);
});
