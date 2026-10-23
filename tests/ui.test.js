'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('No forbidden dash characters anywhere in shipped copy', () => {
  const files = [
    'index.html',
    'styles.css',
    'README.md',
    'NOTES.md',
    'LICENSE',
    'js/raid.js',
    'js/models.js',
    'js/tidy.js',
    'js/rules.js',
    'js/app.js',
    'js/data-library.js',
    'js/data-rules.js',
    'js/data-sensors.js',
  ];
  const forbidden = ['\u2013', '\u2014', '\u2212'];
  for (const file of files) {
    const text = read(file);
    for (const ch of forbidden) {
      assert.equal(text.includes(ch), false, file + ' contains a forbidden dash character');
    }
  }
});

test('Every id app.js looks up exists in index.html', () => {
  const app = read('js/app.js');
  const html = read('index.html');
  const ids = new Set();
  for (const match of app.matchAll(/\$\('([a-zA-Z0-9-]+)'\)/g)) {
    ids.add(match[1]);
  }
  assert.ok(ids.size >= 15, 'app.js should reference at least 15 ids, found ' + ids.size);
  for (const id of ids) {
    assert.ok(html.includes('id="' + id + '"'), 'index.html is missing id "' + id + '"');
  }
  for (const panel of ['storage', 'models', 'tidy', 'rules']) {
    assert.ok(html.includes('id="error-' + panel + '"'), 'missing error slot for ' + panel);
  }
});

test('All script and stylesheet references are local files that exist', () => {
  const html = read('index.html');
  const sources = [];
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
    sources.push(match[1]);
  }
  for (const match of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
    sources.push(match[1]);
  }
  assert.ok(sources.length >= 9);
  for (const source of sources) {
    assert.ok(fs.existsSync(path.join(root, source)), source + ' is referenced but missing');
  }
  assert.equal(/(src|href)="https?:/.test(html), false, 'the page must not load anything over the network');
});

test('Every browser script compiles cleanly', () => {
  const files = [
    'js/data-library.js',
    'js/data-rules.js',
    'js/data-sensors.js',
    'js/raid.js',
    'js/models.js',
    'js/tidy.js',
    'js/rules.js',
    'js/app.js',
  ];
  for (const file of files) {
    assert.doesNotThrow(() => {
      new Function(read(file));
    }, file + ' has a syntax error');
  }
});

test('The page carries semantic landmarks and no all-caps styling', () => {
  const html = read('index.html');
  const css = read('styles.css');
  assert.ok(html.includes('<main'), 'missing main landmark');
  assert.ok(html.includes('aria-label'), 'missing aria labels');
  assert.ok(html.includes('class="skip"'), 'missing skip link');
  assert.ok(html.includes('aria-live'), 'missing live regions for updated results');
  assert.equal(css.includes('text-transform'), false, 'no uppercase transformations allowed');
  assert.equal(/TODO|FIXME/.test(html), false, 'no leftover markers in the page');
});

test('The package declares zero dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.deepEqual(pkg.devDependencies || {}, {});
  assert.equal(pkg.scripts.test, 'node --test tests/');
});
