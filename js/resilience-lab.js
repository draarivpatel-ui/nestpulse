/* NestPulse Resilience and URE Lab: rebuild risk math, audited exports, and a
   strict share codec. Pure UMD module shared by the browser UI
   (window.NestPulseLab) and the node:test suites (module.exports).
   Every probability is a labeled reference model, not a measurement of real
   hardware. The URE figures use vendor published nominal bit error rates. */
(function (root, factory) {
  'use strict';
  const api = factory(
    typeof require === 'function' ? require('./raid.js') : root.NestPulseRaid,
    typeof require === 'function' ? require('./models.js') : root.NestPulseModels,
    typeof require === 'function' ? require('./tidy.js') : root.NestPulseTidy,
    typeof require === 'function' ? require('./rules.js') : root.NestPulseRules,
    typeof require === 'function' ? require('./data-library.js') : root.NestPulseLibrary,
    typeof require === 'function' ? require('./data-rules.js') : root.NestPulseRuleSet,
    typeof require === 'function' ? require('./data-sensors.js') : root.NestPulseSensorLogs
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseLab = api;
  }
})(typeof self !== 'undefined' ? self : this, function (raid, models, tidy, rules, library, ruleSet, sensorLogs) {
  'use strict';

  const LEVEL_ORDER = ['0', '1', '5', '6', '10'];
  const SWEEP_LEVELS = ['5', '6', '10'];
  const SWEEP_SIZES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
  const BER_CLASSES = [
    { id: 'consumer', label: 'Consumer', berExp: 14, note: 'nominal one error per 1e14 bits read' },
    { id: 'nas', label: 'NAS', berExp: 15, note: 'nominal one error per 1e15 bits read' },
    { id: 'enterprise', label: 'Enterprise', berExp: 16, note: 'nominal one error per 1e16 bits read' },
  ];
  const PANELS = ['storage', 'models', 'tidy', 'rules', 'insights', 'resilience'];
  const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];
  const HASH_PREFIX = 'np=';
  const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const DEFAULT_STATE = {
    drives: 4,
    driveTb: 8,
    berExp: 14,
    rebuildMbps: 250,
    ramGb: 8,
    tokens: 8192,
    panel: 'resilience',
  };

  /* ------------------------------ UTF-8 helpers ----------------------------- */

  function utf8Bytes(str) {
    const out = [];
    const s = String(str);
    for (let i = 0; i < s.length; i += 1) {
      let code = s.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return out;
  }

  function utf8String(bytes) {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let cp = 0;
      let len = 0;
      if (b < 0x80) { cp = b; len = 1; }
      else if (b < 0xe0) { cp = b & 31; len = 2; }
      else if (b < 0xf0) { cp = b & 15; len = 3; }
      else { cp = b & 7; len = 4; }
      for (let j = 1; j < len; j += 1) { cp = (cp << 6) | (bytes[i + j] & 63); }
      if (cp <= 0xffff) {
        out += String.fromCharCode(cp);
      } else {
        const adj = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 1023));
      }
      i += len;
    }
    return out;
  }

  /* ------------------------- FIPS 180-4 SHA-256 ----------------------------- */

  const SHA256_H0 = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function sha256hex(message) {
    const bytes = utf8Bytes(message);
    const bitLenHi = Math.floor((bytes.length / 0x20000000));
    const bitLenLo = (bytes.length << 3) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) { bytes.push(0); }
    bytes.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
    bytes.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

    const h = SHA256_H0.slice();
    const w = new Array(64);
    for (let block = 0; block < bytes.length; block += 64) {
      for (let t = 0; t < 16; t += 1) {
        const i = block + t * 4;
        w[t] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      }
      for (let t = 16; t < 64; t += 1) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let t = 0; t < 64; t += 1) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (hh + s1 + ch + SHA256_K[t] + w[t]) | 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    let hex = '';
    for (const word of h) {
      hex += ('00000000' + (word >>> 0).toString(16)).slice(-8);
    }
    return hex;
  }

  /* --------------------------- base64url helpers ---------------------------- */

  function b64urlEncode(str) {
    const bytes = utf8Bytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
      out += B64URL_CHARS[b0 >> 2];
      out += B64URL_CHARS[((b0 & 3) << 4) | (b1 === null ? 0 : b1 >> 4)];
      if (b1 !== null) { out += B64URL_CHARS[((b1 & 15) << 2) | (b2 === null ? 0 : b2 >> 6)]; }
      if (b2 !== null) { out += B64URL_CHARS[b2 & 63]; }
    }
    return out;
  }

  function b64urlDecode(str) {
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of str) {
      const idx = B64URL_CHARS.indexOf(ch);
      if (idx < 0) { return null; }
      buffer = (buffer << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    return utf8String(bytes);
  }

  /* ----------------------------- state handling ----------------------------- */

  function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /* Copies only the whitelisted fields, only when they are own properties, so a
     crafted object can never reach prototype keys or smuggle unknown state. */
  function normalizeState(input) {
    const state = {
      drives: DEFAULT_STATE.drives,
      driveTb: DEFAULT_STATE.driveTb,
      berExp: DEFAULT_STATE.berExp,
      rebuildMbps: DEFAULT_STATE.rebuildMbps,
      ramGb: DEFAULT_STATE.ramGb,
      tokens: DEFAULT_STATE.tokens,
      panel: DEFAULT_STATE.panel,
    };
    if (!input || typeof input !== 'object' || Array.isArray(input)) { return state; }
    const has = function (key) {
      return BLOCKED_KEYS.indexOf(key) < 0 && Object.prototype.hasOwnProperty.call(input, key);
    };
    if (has('drives')) {
      state.drives = clamp(Math.floor(finiteOr(input.drives, DEFAULT_STATE.drives)), 1, 64);
    }
    if (has('driveTb')) {
      state.driveTb = clamp(finiteOr(input.driveTb, DEFAULT_STATE.driveTb), 0.5, 1e6);
    }
    if (has('berExp')) {
      state.berExp = clamp(Math.round(finiteOr(input.berExp, DEFAULT_STATE.berExp)), 6, 24);
    }
    if (has('rebuildMbps')) {
      state.rebuildMbps = clamp(finiteOr(input.rebuildMbps, DEFAULT_STATE.rebuildMbps), 1, 1e5);
    }
    if (has('ramGb')) {
      state.ramGb = clamp(finiteOr(input.ramGb, DEFAULT_STATE.ramGb), 0, 1e7);
    }
    if (has('tokens')) {
      state.tokens = clamp(Math.floor(finiteOr(input.tokens, DEFAULT_STATE.tokens)), 0, 1e9);
    }
    if (has('panel') && PANELS.indexOf(String(input.panel)) >= 0) {
      state.panel = String(input.panel);
    }
    return state;
  }

  function encodeState(input) {
    const state = normalizeState(input);
    const packed = {
      drives: state.drives,
      driveTb: state.driveTb,
      berExp: state.berExp,
      rebuildMbps: state.rebuildMbps,
      ramGb: state.ramGb,
      tokens: state.tokens,
      panel: state.panel,
    };
    return HASH_PREFIX + b64urlEncode(JSON.stringify(packed));
  }

  /* Fail closed: anything that is not a well formed np= hash of a plain object
     returns null. Hashes carrying prototype keys are rejected whole. */
  function decodeState(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) { return null; }
    let body = raw;
    if (body.charAt(0) === '#') { body = body.slice(1); }
    if (body.slice(0, HASH_PREFIX.length) !== HASH_PREFIX) { return null; }
    const payload = body.slice(HASH_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) { return null; }
    const text = b64urlDecode(payload);
    if (text === null) { return null; }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    for (const key of Object.keys(parsed)) {
      if (BLOCKED_KEYS.indexOf(key) >= 0) { return null; }
    }
    return normalizeState(parsed);
  }

  /* --------------------------- URE probability ------------------------------ */

  /* Expected unrecoverable read errors across one full rebuild read.
     Poisson model: P(at least one URE) = 1 - exp(-lambda), computed as
     -expm1(-lambda) so the tiny probabilities on enterprise media keep their
     precision instead of collapsing to zero. */
  function ureLambda(bitsRead, berExp) {
    const bits = Number(bitsRead);
    const exp = Number(berExp);
    if (!Number.isFinite(bits) || !Number.isFinite(exp) || bits < 0) { return null; }
    return bits * Math.pow(10, -exp);
  }

  /* Probability that a Poisson process with mean lambda produces at least k
     events. k is clamped to the two cases this lab uses: a lone URE is fatal
     (k = 1, single parity or mirror) and a double URE is fatal (k = 2, dual
     parity rebuild still running). The k = 2 small lambda path uses its
     convergent series because 1 - exp(-l)(1 + l) loses every digit to
     cancellation well before the probabilities this chart prints. */
  function poissonAtLeast(k, lambda) {
    const lam = Number(lambda);
    if (!Number.isFinite(lam) || lam < 0) { return null; }
    const kk = Math.floor(Number(k));
    if (kk <= 0) { return 1; }
    if (lam === 0) { return 0; }
    if (kk === 1) { return -Math.expm1(-lam); }
    if (kk !== 2) { return null; }
    if (lam >= 0.25) {
      const tail = Math.exp(-lam) * (1 + lam);
      return tail >= 1 ? 0 : 1 - tail;
    }
    let sum = 0.5;
    let term = 0.5;
    for (let m = 1; m < 60; m += 1) {
      term *= lam / (m + 2);
      sum += term;
      if (term < 1e-19) { break; }
    }
    return Math.exp(-lam) * lam * lam * sum;
  }

  /* How many surviving drives a single drive rebuild must read end to end.
     RAID 0 cannot rebuild at all. A mirror rebuild copies its one surviving
     twin. Parity levels read every surviving member. */
  function rebuildDrivesRead(level, drives) {
    const n = Math.floor(Number(drives));
    switch (String(level)) {
      case '0': return null;
      case '1': return 1;
      case '5': return Number.isFinite(n) && n >= 3 ? n - 1 : null;
      case '6': return Number.isFinite(n) && n >= 4 ? n - 1 : null;
      case '10': return Number.isFinite(n) && n >= 4 && n % 2 === 0 ? 1 : null;
      default: return null;
    }
  }

  function ureFatalityThreshold(level) {
    return String(level) === '6' ? 2 : 1;
  }

  /* The exact model behind every URE number on the page: during a single
     failed drive rebuild the array is lost if at least k UREs surface while
     streaming the surviving members. k = 2 only for RAID 6, whose second
     parity block absorbs one bad sector. */
  function rebuildUreProbability(level, drives, driveTb, berExp) {
    const read = rebuildDrivesRead(level, drives);
    const tb = Number(driveTb);
    if (read === null || !Number.isFinite(tb) || tb <= 0) { return null; }
    const bitsRead = read * tb * 1e12 * 8;
    const lam = ureLambda(bitsRead, berExp);
    if (lam === null) { return null; }
    return poissonAtLeast(ureFatalityThreshold(level), lam);
  }

  function ureRiskClass(p) {
    if (p === null || p === undefined || !Number.isFinite(p)) { return 'na'; }
    if (p < 0.001) { return 'low'; }
    if (p < 0.05) { return 'elevated'; }
    if (p < 0.5) { return 'high'; }
    return 'critical';
  }

  function ureRiskLabel(p) {
    switch (ureRiskClass(p)) {
      case 'low': return 'Low';
      case 'elevated': return 'Elevated';
      case 'high': return 'High';
      case 'critical': return 'Critical';
      default: return 'n/a';
    }
  }

  /* --------------------------- comparator + sweep --------------------------- */

  function compareRaid(input) {
    const state = normalizeState(input);
    const rows = [];
    for (const level of LEVEL_ORDER) {
      const res = raid.computeRaid({
        level: level,
        drives: state.drives,
        driveTb: state.driveTb,
        rebuildMbps: state.rebuildMbps,
      });
      const drivesRead = rebuildDrivesRead(level, state.drives);
      const bitsRead = res.ok && drivesRead !== null ? drivesRead * state.driveTb * 1e12 * 8 : null;
      const lambda = bitsRead === null ? null : ureLambda(bitsRead, state.berExp);
      const ureP = res.ok && lambda !== null
        ? poissonAtLeast(ureFatalityThreshold(level), lambda)
        : null;
      rows.push({
        level: level,
        label: raid.LEVELS[level] ? raid.LEVELS[level].label : 'RAID ' + level,
        ok: res.ok,
        error: res.ok ? null : res.error,
        drives: state.drives,
        driveTb: state.driveTb,
        usableTb: res.ok ? res.usableTb : null,
        usableTib: res.ok ? res.usableTib : null,
        rawTb: res.ok ? res.rawTb : null,
        efficiency: res.ok ? res.efficiency : null,
        guaranteedFaultTolerance: res.ok ? res.guaranteedFaultTolerance : null,
        bestCaseFaultTolerance: res.ok ? res.bestCaseFaultTolerance : null,
        rebuildHours: res.ok ? res.rebuildHours : null,
        drivesRead: res.ok ? drivesRead : null,
        bitsRead: bitsRead,
        ureLambda: lambda,
        ureProbability: ureP,
        risk: ureRiskClass(ureP),
      });
    }
    return { ok: true, state: state, rows: rows, berExp: state.berExp };
  }

  /* The curve the chart draws: array loss probability during a single drive
     rebuild as drive capacity scales from small to very large. */
  function ureSweep(input, options) {
    const opts = options || {};
    const state = normalizeState(input);
    const rawSizes = Array.isArray(opts.sizesTb) ? opts.sizesTb : SWEEP_SIZES;
    const seen = new Set();
    const sizes = [];
    for (const size of rawSizes) {
      const tb = Number(size);
      if (!Number.isFinite(tb) || tb <= 0 || seen.has(tb)) { continue; }
      seen.add(tb);
      sizes.push(tb);
    }
    sizes.sort(function (a, b) { return a - b; });
    const series = SWEEP_LEVELS.map(function (level) {
      const points = sizes.map(function (tb) {
        const p = rebuildUreProbability(level, state.drives, tb, state.berExp);
        return { driveTb: tb, p: p };
      });
      return { level: level, label: 'RAID ' + level, points: points };
    });
    return { ok: true, state: state, sizesTb: sizes, berExp: state.berExp, series: series };
  }

  /* --------------------- cross panel architecture rollup -------------------- */

  /* One deterministic snapshot binding every shipped module: the array rows
     Storage Doctor just computed, the catalog count Memory Fit reports, the
     reclaimable bytes Tidy Plans proposes at its page default threshold, and
     the conflict count Rule Forge predicts over its demo logs. */
  function architectureRollup(input) {
    const state = normalizeState(input);
    const compare = compareRaid(state);
    const validRows = compare.rows.filter(function (row) { return row.ok && row.ureProbability !== null; });
    const safest = validRows.slice().sort(function (a, b) {
      return (a.ureProbability - b.ureProbability) || (a.level < b.level ? -1 : 1);
    })[0] || null;
    const riskiest = validRows.slice().sort(function (a, b) {
      return (b.ureProbability - a.ureProbability) || (a.level < b.level ? -1 : 1);
    })[0] || null;
    const budgetBytes = state.ramGb * 1e9;
    let fitCount = 0;
    for (const model of models.CATALOG) {
      if (models.bestQuant(model, budgetBytes, state.tokens)) { fitCount += 1; }
    }
    const plan = tidy.planCleanup(library.manifest, {
      minConfidence: 0.5,
      keepNewest: true,
      screenshotCutoff: '2024-06-01',
    });
    const dry = rules.dryRun(ruleSet.rules, sensorLogs.buildLogs());
    return {
      state: state,
      storage: {
        levelCount: compare.rows.length,
        validCount: validRows.length,
        safest: safest ? { level: safest.level, ureProbability: safest.ureProbability, risk: safest.risk } : null,
        riskiest: riskiest ? { level: riskiest.level, ureProbability: riskiest.ureProbability, risk: riskiest.risk } : null,
      },
      memory: { fitCount: fitCount, catalogCount: models.CATALOG.length, ramGb: state.ramGb, tokens: state.tokens },
      tidy: {
        actionCount: plan.actions.length,
        savingBytes: plan.potentialSavingBytes,
        suppressedCount: plan.suppressed.count,
      },
      rules: {
        ruleCount: ruleSet.rules.length,
        conflictCount: dry.conflicts.length,
        validationCount: dry.validation.length,
        totalFires: dry.reports.reduce(function (sum, r) { return sum + r.fires; }, 0),
      },
    };
  }

  /* ----------------------- canonical report + exports ----------------------- */

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') { return JSON.stringify(value); }
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }

  function csvEscape(value) {
    let s = value === null || value === undefined ? '' : String(value);
    const needsQuote = /[",\n\r]/.test(s);
    if (/^[\s=+\-@]/.test(s)) { s = "'" + s; }
    if (needsQuote) { s = '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  const reportCache = new Map();

  /* Builds the one canonical payload for a state, stamps its SHA-256 once, and
     caches every derived artifact off that single digest so the on page line,
     the JSON document, the CSV provenance header and the Markdown footer can
     never disagree. Nothing time dependent enters the payload. */
  function reportFor(input) {
    const state = normalizeState(input);
    const key = encodeState(state);
    const cached = reportCache.get(key);
    if (cached) { return cached; }

    const compare = compareRaid(state);
    const sweep = ureSweep(state);
    const rollup = architectureRollup(state);
    const payload = {
      schema: 'nestpulse-resilience-report/1',
      generator: 'NestPulse Resilience and URE Lab',
      disclosure: 'Reference model on labeled demo data. No live NAS hardware is connected.',
      inputs: state,
      ber: { berExp: state.berExp, nominalRate: '1e-' + state.berExp + ' errors per bit read' },
      comparator: compare.rows.map(function (row) {
        return {
          level: row.level,
          usableTb: row.usableTb,
          usableTib: row.usableTib,
          efficiency: row.efficiency,
          rebuildHours: row.rebuildHours,
          drivesRead: row.drivesRead,
          ureLambda: row.ureLambda,
          ureProbability: row.ureProbability,
          risk: row.risk,
        };
      }),
      sweep: {
        berExp: sweep.berExp,
        levels: SWEEP_LEVELS.slice(),
        sizesTb: sweep.sizesTb.slice(),
        series: sweep.series.map(function (s) {
          return { level: s.level, probabilities: s.points.map(function (p) { return p.p; }) };
        }),
      },
      rollup: rollup,
    };
    const canonical = stableStringify(payload);
    const digest = sha256hex(canonical);

    const json = JSON.stringify({
      format: 'nestpulse-resilience-report/1',
      sha256: digest,
      payload: payload,
    }, null, 2);

    const csvLines = [
      '# nestpulse resilience and ure report',
      '# sha256 ' + digest,
      '# state ' + key,
      '# reference model on labeled demo data; no live NAS hardware is connected',
      'level,drives,drive_tb,usable_tb,usable_tib,efficiency_pct,rebuild_hours,drives_read,ure_lambda,ure_loss_probability,risk',
    ];
    for (const row of compare.rows) {
      csvLines.push([
        'RAID ' + row.level,
        row.drives,
        row.driveTb,
        row.usableTb === null ? '' : row.usableTb,
        row.usableTib === null ? '' : row.usableTib,
        row.efficiency === null ? '' : Math.round(row.efficiency * 1000) / 10,
        row.rebuildHours === null ? '' : row.rebuildHours,
        row.drivesRead === null ? '' : row.drivesRead,
        row.ureLambda === null ? '' : row.ureLambda,
        row.ureProbability === null ? '' : row.ureProbability,
        row.risk,
      ].map(csvEscape).join(','));
    }
    const csv = csvLines.join('\n') + '\n';

    const md = [
      '# NestPulse Resilience and URE Report',
      '',
      'Inputs: ' + state.drives + ' drives of ' + state.driveTb + ' TB each, rebuild at '
        + state.rebuildMbps + ' MB per second, nominal BER 1e-' + state.berExp
        + ', memory budget ' + state.ramGb + ' GB, context ' + state.tokens + ' tokens.',
      '',
      '| Level | Usable TiB | Efficiency | Rebuild hours | Drives read | URE loss probability |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const row of compare.rows) {
      md.push('| ' + row.label + ' | '
        + (row.usableTib === null ? 'n/a' : row.usableTib.toFixed(2) + ' TiB') + ' | '
        + (row.efficiency === null ? 'n/a' : Math.round(row.efficiency * 100) + ' percent') + ' | '
        + (row.rebuildHours === null ? 'n/a' : row.rebuildHours.toFixed(2)) + ' | '
        + (row.drivesRead === null ? 'n/a' : row.drivesRead) + ' | '
        + (row.ureProbability === null ? 'n/a' : (row.ureProbability * 100).toPrecision(4) + ' percent') + ' |');
    }
    md.push('');
    md.push('Rule Forge predicts ' + rollup.rules.conflictCount + ' conflicts, Memory Fit holds '
      + rollup.memory.fitCount + ' of ' + rollup.memory.catalogCount + ' catalog entries, and Tidy Plans reclaims '
      + rollup.tidy.savingBytes + ' bytes at its page default threshold.');
    md.push('');
    md.push('Reference model on labeled demo data. No live NAS hardware is connected.');
    md.push('');
    md.push('sha256: ' + digest);
    md.push('');
    const markdown = md.join('\n');

    const report = {
      state: state,
      stateKey: key,
      payload: payload,
      canonical: canonical,
      sha256: digest,
      json: json,
      csv: csv,
      markdown: markdown,
    };
    reportCache.set(key, report);
    return report;
  }

  /* Recomputes the digest over a report payload and compares. Accepts the
     report object, a parsed JSON document, or the raw JSON string. */
  function verifyReport(reportOrJson) {
    let doc = reportOrJson;
    if (typeof doc === 'string') {
      try {
        doc = JSON.parse(doc);
      } catch (err) {
        return { ok: false, expected: null, actual: null, error: 'the document is not valid JSON' };
      }
    }
    if (!doc || typeof doc !== 'object') {
      return { ok: false, expected: null, actual: null, error: 'nothing to verify' };
    }
    const payload = doc.payload !== undefined ? doc.payload : doc;
    const expected = typeof doc.sha256 === 'string' ? doc.sha256 : null;
    const actual = sha256hex(stableStringify(payload));
    return { ok: expected !== null && expected === actual, expected: expected, actual: actual };
  }

  /* The tamper demo behind the button: rebuild the report, corrupt one field,
     and show the recomputed digest no longer matches the stamped one. */
  function tamperDemo(input) {
    const report = reportFor(input);
    const mutated = JSON.parse(report.json);
    const rows = mutated.payload && mutated.payload.comparator;
    if (rows && rows.length) {
      rows[0].usableTb = rows[0].usableTb === null ? 1 : rows[0].usableTb + 0.5;
    } else {
      mutated.payload.inputs.drives += 1;
    }
    const recomputed = verifyReport(mutated);
    return {
      ok: !recomputed.ok,
      intactDigest: report.sha256,
      tamperedDigest: recomputed.actual,
      detected: !recomputed.ok,
    };
  }

  /* ------------------------------- self tests ------------------------------- */

  function selfTests() {
    const results = [];
    const run = function (id, name, fn) {
      let ok = false;
      let detail = '';
      try {
        detail = fn() || '';
        ok = true;
      } catch (err) {
        detail = String(err && err.message ? err.message : err);
      }
      results.push({ id: id, name: name, ok: ok, detail: detail });
    };
    const eq = function (a, b, msg) {
      if (a !== b) { throw new Error((msg || 'mismatch') + ': ' + a + ' !== ' + b); }
    };
    const near = function (a, b, eps, msg) {
      if (!(Math.abs(a - b) <= eps)) { throw new Error((msg || 'not close') + ': ' + a + ' vs ' + b); };
    };

    run('sha256-empty', 'SHA-256 known answer, empty message', function () {
      eq(sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
    run('sha256-abc', 'SHA-256 known answer, abc', function () {
      eq(sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
    run('sha256-long', 'SHA-256 known answer, 448 bit message', function () {
      eq(sha256hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });
    run('sha256-utf8', 'SHA-256 digests UTF-8 bytes, not code units', function () {
      eq(sha256hex('café'), '850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e');
      eq(utf8String(utf8Bytes('Größe 日本語')), 'Größe 日本語');
    });
    run('expm1-accuracy', 'expm1 keeps precision where 1 - exp(-x) cancels', function () {
      const lam = 1e-10;
      const p = poissonAtLeast(1, lam);
      near(p, lam - lam * lam / 2, 1e-18);
      eq(poissonAtLeast(1, 0), 0);
    });
    run('ure-bounds', 'URE probability stays inside [0, 1]', function () {
      for (const tb of [0.5, 2, 8, 24, 40]) {
        for (const exp of [14, 15, 16]) {
          for (const level of ['1', '5', '6', '10']) {
            const p = rebuildUreProbability(level, 4, tb, exp);
            if (p === null || p < 0 || p > 1) { throw new Error('out of bounds ' + level + ' ' + tb + ' ' + exp); }
          }
        }
      }
      eq(rebuildUreProbability('0', 4, 8, 14), null);
    });
    run('ure-monotonic-size', 'loss risk never shrinks as drives grow', function () {
      let prev = -1;
      for (const tb of [2, 4, 8, 12, 16, 20, 24]) {
        const p = rebuildUreProbability('5', 4, tb, 14);
        if (p < prev) { throw new Error('not monotone at ' + tb); }
        prev = p;
      }
    });
    run('ure-monotonic-ber', 'loss risk never rises as media gets cleaner', function () {
      for (const level of ['5', '6', '10']) {
        const c = rebuildUreProbability(level, 4, 16, 14);
        const n = rebuildUreProbability(level, 4, 16, 15);
        const e = rebuildUreProbability(level, 4, 16, 16);
        if (!(c >= n && n >= e)) { throw new Error('ordering broken for RAID ' + level); }
      }
    });
    run('raid-usable-exact', 'comparator usable capacity matches Storage Doctor exactly', function () {
      const compare = compareRaid({ drives: 6, driveTb: 10, berExp: 15, rebuildMbps: 300 });
      for (const row of compare.rows) {
        const res = raid.computeRaid({ level: row.level, drives: 6, driveTb: 10, rebuildMbps: 300 });
        eq(row.ok, res.ok);
        if (res.ok) { eq(row.usableTb, res.usableTb); eq(row.rebuildHours, res.rebuildHours); }
      }
    });
    run('raid6-survives-lone-ure', 'RAID 6 risk is the two event tail, below single parity', function () {
      const p5 = rebuildUreProbability('5', 6, 8, 14);
      const p6 = rebuildUreProbability('6', 6, 8, 14);
      if (!(p6 < p5)) { throw new Error('dual parity did not reduce the risk'); }
      const lam = ureLambda(5 * 8e12 * 8, 14);
      near(p6, 1 - Math.exp(-lam) * (1 + lam), 1e-12);
      near(poissonAtLeast(2, 0.01), 0.00005 * Math.exp(-0.01) * (1 + 0.01 / 3), 1e-9);
    });
    run('rollup-invariant', 'rollup conflict count matches a direct dry run', function () {
      const roll = architectureRollup({ drives: 4, driveTb: 8 });
      const dry = rules.dryRun(ruleSet.rules, sensorLogs.buildLogs());
      eq(roll.rules.conflictCount, dry.conflicts.length);
      eq(roll.rules.ruleCount, ruleSet.rules.length);
    });
    run('csv-formula-escape', 'CSV cells cannot open as spreadsheet formulas', function () {
      eq(csvEscape('=CMD()'), "'=CMD()");
      eq(csvEscape('+1+2'), "'+1+2");
      eq(csvEscape('@SUM(A1)'), "'@SUM(A1)");
      eq(csvEscape('-9'), "'-9");
      eq(csvEscape('a,b'), '"a,b"');
      eq(csvEscape('say "hi"'), '"say ""hi"""');
      eq(csvEscape('plain'), 'plain');
    });
    run('digest-parity', 'one digest stamps JSON, CSV and Markdown', function () {
      const report = reportFor({ drives: 4, driveTb: 8, berExp: 15 });
      if (report.json.indexOf(report.sha256) < 0) { throw new Error('json missing digest'); }
      if (report.csv.indexOf(report.sha256) < 0) { throw new Error('csv missing digest'); }
      if (report.markdown.indexOf(report.sha256) < 0) { throw new Error('markdown missing digest'); }
      const verified = verifyReport(report.json);
      if (!verified.ok || verified.actual !== report.sha256) { throw new Error('verify failed'); }
    });
    run('tamper-detected', 'mutating the payload flips verification to fail', function () {
      const demo = tamperDemo({ drives: 4, driveTb: 8 });
      if (!demo.detected) { throw new Error('tamper went undetected'); }
      if (demo.intactDigest === demo.tamperedDigest) { throw new Error('digests did not diverge'); }
    });
    run('codec-roundtrip', 'np= hash restores every field', function () {
      const state = { drives: 6, driveTb: 12, berExp: 16, rebuildMbps: 400, ramGb: 24, tokens: 32768, panel: 'storage' };
      const decoded = decodeState('#' + encodeState(state));
      for (const key of Object.keys(state)) {
        eq(decoded[key], state[key], 'field ' + key);
      }
    });
    run('codec-hostile', 'malformed and hostile hashes fail closed', function () {
      eq(decodeState('#np=!!!'), null);
      eq(decodeState('np='), null);
      eq(decodeState('#np=' + b64urlEncode('{"drives":4,"__proto__":{"x":1}}')), null);
      eq(decodeState('#np=' + b64urlEncode('{"constructor":{"x":1}}')), null);
      eq(decodeState('#np=' + b64urlEncode('[1,2,3]')), null);
      eq(decodeState('#other=abc'), null);
      eq(decodeState(''), null);
      eq(decodeState(null), null);
      eq(decodeState(42), null);
      eq(decodeState('#np=' + b64urlEncode('{bad json')), null);
    });
    run('self-determinism', 'two reports for one state are byte identical', function () {
      const a = reportFor({ drives: 4, driveTb: 8, berExp: 14 });
      const b = reportFor({ drives: 4, driveTb: 8, berExp: 14 });
      eq(a.sha256, b.sha256);
      eq(a.json, b.json);
    });

    const passed = results.filter(function (r) { return r.ok; }).length;
    return { total: results.length, passed: passed, results: results };
  }

  return {
    LEVEL_ORDER: LEVEL_ORDER,
    SWEEP_LEVELS: SWEEP_LEVELS,
    SWEEP_SIZES: SWEEP_SIZES,
    BER_CLASSES: BER_CLASSES,
    PANELS: PANELS,
    DEFAULT_STATE: DEFAULT_STATE,
    HASH_PREFIX: HASH_PREFIX,
    utf8Bytes: utf8Bytes,
    utf8String: utf8String,
    sha256hex: sha256hex,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    normalizeState: normalizeState,
    encodeState: encodeState,
    decodeState: decodeState,
    ureLambda: ureLambda,
    poissonAtLeast: poissonAtLeast,
    rebuildDrivesRead: rebuildDrivesRead,
    ureFatalityThreshold: ureFatalityThreshold,
    rebuildUreProbability: rebuildUreProbability,
    ureRiskClass: ureRiskClass,
    ureRiskLabel: ureRiskLabel,
    compareRaid: compareRaid,
    ureSweep: ureSweep,
    architectureRollup: architectureRollup,
    stableStringify: stableStringify,
    csvEscape: csvEscape,
    reportFor: reportFor,
    verifyReport: verifyReport,
    tamperDemo: tamperDemo,
    selfTests: selfTests,
  };
});
