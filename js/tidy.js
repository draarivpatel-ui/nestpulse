/* NestPulse Tidy Plans: duplicate grouping and cleanup planning over a manifest.
   Shared by the browser UI (window.NestPulseTidy) and the node:test suites (module.exports).
   The planner never touches a real disk; it ranks proposals over the labeled demo manifest. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseTidy = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIDENCE = {
    exact: 1.0,
    burst: 0.75,
    copyPattern: 0.65,
    agedScreenshot: 0.45,
  };

  const CLASS_LABELS = {
    exact: 'Exact duplicate',
    burst: 'Burst set',
    copyPattern: 'Copy pattern',
    agedScreenshot: 'Aged screenshot',
  };

  const MIN_BURST_SIZE = 3;

  function baseName(path) {
    const parts = String(path).split('/');
    return parts[parts.length - 1];
  }

  function stripExtension(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  function normalizeName(name) {
    return stripExtension(name)
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\s+copy$/i, '')
      .trim()
      .toLowerCase();
  }

  function isCopiedName(name) {
    return normalizeName(name) !== stripExtension(name).trim().toLowerCase();
  }

  function compareByPath(a, b) {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  }

  /* Newest modified date wins; ties break on the lower path so the plan is deterministic. */
  function pickKeeper(items, keepNewest) {
    const sorted = items.slice().sort(function (a, b) {
      if (keepNewest && a.modified !== b.modified) {
        return a.modified < b.modified ? 1 : -1;
      }
      return compareByPath(a, b);
    });
    return sorted[0];
  }

  function sumBytes(items) {
    return items.reduce(function (total, item) { return total + item.bytes; }, 0);
  }

  function groupByHash(manifest) {
    const groups = new Map();
    for (const item of manifest.items) {
      if (!groups.has(item.contentHash)) {
        groups.set(item.contentHash, []);
      }
      groups.get(item.contentHash).push(item);
    }
    return groups;
  }

  function groupBursts(manifest) {
    const groups = new Map();
    for (const item of manifest.items) {
      if (!item.burstId) { continue; }
      if (!groups.has(item.burstId)) {
        groups.set(item.burstId, []);
      }
      groups.get(item.burstId).push(item);
    }
    return groups;
  }

  function summarizeLibrary(manifest) {
    const byKind = {};
    let totalBytes = 0;
    for (const item of manifest.items) {
      if (!byKind[item.kind]) {
        byKind[item.kind] = { count: 0, bytes: 0 };
      }
      byKind[item.kind].count += 1;
      byKind[item.kind].bytes += item.bytes;
      totalBytes += item.bytes;
    }
    let exactHashGroups = 0;
    for (const group of groupByHash(manifest).values()) {
      if (group.length >= 2) { exactHashGroups += 1; }
    }
    let burstSets = 0;
    for (const group of groupBursts(manifest).values()) {
      if (group.length >= MIN_BURST_SIZE) { burstSets += 1; }
    }
    return {
      itemCount: manifest.items.length,
      totalBytes: totalBytes,
      byKind: byKind,
      exactHashGroups: exactHashGroups,
      burstSets: burstSets,
    };
  }

  /* Classes run highest confidence first; anything consumed by an earlier class is
     never proposed again, so no file is removed by two different actions. */
  function buildActions(manifest, options) {
    const opts = {
      keepNewest: options.keepNewest !== false,
      screenshotCutoff: options.screenshotCutoff || '2024-06-01',
    };
    const consumed = new Set();
    const actions = [];

    for (const pair of groupByHash(manifest)) {
      const hash = pair[0];
      const items = pair[1];
      if (items.length < 2) { continue; }
      const keeper = pickKeeper(items, opts.keepNewest);
      const remove = items.filter(function (item) {
        return item !== keeper && !consumed.has(item.id);
      });
      if (remove.length === 0) { continue; }
      for (const item of items) { consumed.add(item.id); }
      actions.push({
        id: 'exact:' + hash,
        class: 'exact',
        confidence: CONFIDENCE.exact,
        bytes: sumBytes(remove),
        keep: keeper,
        remove: remove,
        reason: 'Identical content hash in ' + (items.length) + ' files. Keeps ' + keeper.path + '.',
      });
    }

    const nameGroups = new Map();
    for (const item of manifest.items) {
      if (consumed.has(item.id)) { continue; }
      const key = normalizeName(baseName(item.path));
      if (!nameGroups.has(key)) { nameGroups.set(key, []); }
      nameGroups.get(key).push(item);
    }
    for (const pair of nameGroups) {
      const key = pair[0];
      const items = pair[1];
      if (items.length < 2) { continue; }
      const bytes = items[0].bytes;
      const sameBytes = items.every(function (item) { return item.bytes === bytes; });
      const distinctHashes = new Set(items.map(function (item) { return item.contentHash; })).size >= 2;
      const hasCopyName = items.some(function (item) { return isCopiedName(baseName(item.path)); });
      if (!sameBytes || !distinctHashes || !hasCopyName) { continue; }
      const sorted = items.slice().sort(function (a, b) {
        const aLen = baseName(a.path).length;
        const bLen = baseName(b.path).length;
        if (aLen !== bLen) { return aLen - bLen; }
        return compareByPath(a, b);
      });
      const keeper = sorted[0];
      const remove = sorted.slice(1);
      for (const item of items) { consumed.add(item.id); }
      actions.push({
        id: 'pattern:' + key,
        class: 'copyPattern',
        confidence: CONFIDENCE.copyPattern,
        bytes: sumBytes(remove),
        keep: keeper,
        remove: remove,
        reason: 'Same name and size with a copy suffix and a different content hash. Keeps ' + keeper.path + '.',
      });
    }

    for (const pair of groupBursts(manifest)) {
      const burstId = pair[0];
      const items = pair[1].filter(function (item) { return !consumed.has(item.id); });
      if (items.length < MIN_BURST_SIZE) { continue; }
      const keeper = pickKeeper(items, opts.keepNewest);
      const remove = items.filter(function (item) { return item !== keeper; });
      if (remove.length === 0) { continue; }
      for (const item of items) { consumed.add(item.id); }
      actions.push({
        id: 'burst:' + burstId,
        class: 'burst',
        confidence: CONFIDENCE.burst,
        bytes: sumBytes(remove),
        keep: keeper,
        remove: remove,
        reason: 'Burst set of ' + items.length + ' near duplicate shots. Keeps ' + keeper.path
          + (opts.keepNewest ? ', the newest shot.' : ', the first shot.'),
      });
    }

    for (const item of manifest.items) {
      if (consumed.has(item.id)) { continue; }
      if (item.kind !== 'screenshot') { continue; }
      if (item.modified >= opts.screenshotCutoff) { continue; }
      consumed.add(item.id);
      actions.push({
        id: 'shot:' + item.id,
        class: 'agedScreenshot',
        confidence: CONFIDENCE.agedScreenshot,
        bytes: item.bytes,
        keep: null,
        remove: [item],
        reason: 'Screenshot taken before the ' + opts.screenshotCutoff + ' cutoff. Low confidence because only the date is considered.',
      });
    }

    return actions;
  }

  function rankActions(actions) {
    return actions.slice().sort(function (a, b) {
      if (a.confidence !== b.confidence) { return b.confidence - a.confidence; }
      if (a.bytes !== b.bytes) { return b.bytes - a.bytes; }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  function planCleanup(manifest, options) {
    const opts = {
      keepNewest: !options || options.keepNewest !== false,
      screenshotCutoff: (options && options.screenshotCutoff) || '2024-06-01',
      minConfidence: (options && options.minConfidence !== undefined) ? options.minConfidence : 0.5,
    };
    const all = rankActions(buildActions(manifest, opts));
    const threshold = opts.minConfidence - 1e-9;
    const actions = all.filter(function (action) { return action.confidence >= threshold; });
    const suppressed = all.filter(function (action) { return action.confidence < threshold; });
    return {
      actions: actions,
      potentialSavingBytes: sumBytes(actions),
      suppressed: {
        count: suppressed.length,
        bytes: sumBytes(suppressed),
      },
      totalLibraryBytes: summarizeLibrary(manifest).totalBytes,
    };
  }

  return {
    CONFIDENCE: CONFIDENCE,
    CLASS_LABELS: CLASS_LABELS,
    MIN_BURST_SIZE: MIN_BURST_SIZE,
    baseName: baseName,
    normalizeName: normalizeName,
    isCopiedName: isCopiedName,
    pickKeeper: pickKeeper,
    summarizeLibrary: summarizeLibrary,
    groupByHash: groupByHash,
    groupBursts: groupBursts,
    buildActions: buildActions,
    rankActions: rankActions,
    planCleanup: planCleanup,
  };
});
