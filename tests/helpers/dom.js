/* helpers/dom.js - a zero dependency DOM shim for js/app.js.
   app.js is a browser IIFE that reads window globals. This shim loads the real
   data and math modules into a vm context, then executes app.js against a fake
   DOM, so the interactive tests exercise the actual render and control code. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..', '..');

class ClassList {
  constructor() { this.set = new Set(); }
  add(...n) { n.forEach((x) => this.set.add(x)); }
  remove(...n) { n.forEach((x) => this.set.delete(x)); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const next = force === undefined ? !this.set.has(n) : Boolean(force);
    if (next) this.set.add(n); else this.set.delete(n);
    return next;
  }
  toString() { return [...this.set].join(' '); }
}

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.hidden = false;
    this.checked = false;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty() {} };
    this.classList = new ClassList();
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this.children = []; }
  get firstChild() { return this.children[0] ?? null; }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof El) { n.parentNode = this; this.children.push(n); }
      else if (typeof n === 'string') { const t = new El('#text'); t.textContent = n; t.parentNode = this; this.children.push(t); }
    }
  }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n) { this.append(n); return n; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); return n; }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.startsWith('data-')) {
      this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    }
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => { if (matches(node, sel)) out.push(node); for (const c of node.children) walk(c); };
    for (const c of this.children) walk(c);
    return out;
  }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
}

function matches(node, selector) {
  for (const part of selector.split(',')) {
    const sel = part.trim();
    if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) return true;
    if (sel.startsWith('#') && node.id === sel.slice(1)) return true;
    if (node.tagName === sel.toUpperCase()) return true;
  }
  return false;
}

function parsePage(rel) {
  const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const attributes = new Map();
  for (const m of source.matchAll(/<(input|select|button|output|table|tbody|section|p|div)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (/\bhidden\b/.test(m[2]) && !/hidden="/.test(m[2])) attrs.hidden = 'hidden';
    if (attrs.id) attributes.set(attrs.id, { tag: m[1], attrs });
  }
  // A select's value is its selected option, or the first option otherwise.
  const selectDefaults = new Map();
  for (const m of source.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...m[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];
    const selected = options.find((o) => /selected/.test(o[2]));
    if (options.length) selectDefaults.set(m[1], (selected || options[0])[1]);
  }
  return { source, ids, attributes, selectDefaults };
}

function makeDom(page) {
  const elements = new Map();
  for (const id of page.ids) {
    const spec = page.attributes.get(id);
    const el = new El(spec?.tag ?? 'div', id);
    if (spec) {
      for (const [k, v] of Object.entries(spec.attrs)) {
        el.setAttribute(k, v);
        if (k === 'value') el.value = v;
        if (k === 'class') el.className = v;
        if (k === 'checked') el.checked = true;
        if (k === 'hidden') el.hidden = true;
      }
    }
    if (page.selectDefaults.has(id)) el.value = page.selectDefaults.get(id);
    elements.set(id, el);
  }
  const body = new El('body');
  const root = new El('html');
  const documentListeners = {};
  const document = {
    documentElement: root,
    body,
    readyState: 'complete',
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    createTextNode: (text) => { const n = new El('#text'); n.textContent = text; return n; },
    querySelector: (sel) => [...elements.values()].find((el) => matches(el, sel)) ?? null,
    querySelectorAll: (sel) => [...elements.values()].filter((el) => matches(el, sel)),
    addEventListener: (type, fn) => (documentListeners[type] ??= []).push(fn)
  };
  const errors = [];
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe(node) { this.callback([{ isIntersecting: true, target: node }]); }
    unobserve() {}
  }
  const window = {
    console: { error: (...args) => errors.push(args.map(String).join(' ')) },
    IntersectionObserver: FakeIntersectionObserver,
    matchMedia: () => ({ matches: false })
  };
  // Load each shipped module into the vm context so the browser globals line up.
  const sandbox = {
    document, window, console: window.console, self: null,
    IntersectionObserver: window.IntersectionObserver,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Math, JSON, Date, Number, String, Object, Array, Set, Map, Boolean, isFinite,
    parseInt, parseFloat, RegExp, Error, Infinity, NaN, undefined
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const modules = [
    'js/data-library.js', 'js/data-rules.js', 'js/data-sensors.js',
    'js/raid.js', 'js/models.js', 'js/tidy.js', 'js/rules.js', 'js/insights.js'
  ];
  for (const rel of modules) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), context, { filename: rel });
  }
  return { document, window, elements, context, errors, getEl: (id) => elements.get(id) ?? null };
}

function runApp(env) {
  const appSource = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');
  vm.runInContext(appSource, env.context, { filename: 'js/app.js' });
  return env;
}

module.exports = { repoRoot, parsePage, makeDom, runApp };
