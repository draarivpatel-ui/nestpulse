/* NestPulse Insights: cross-panel frontier searches and graph diagnostics.
   Shared by the browser UI (window.NestPulseInsights) and the node:test suites.
   Pure functions only. Every candidate is scored by calling the existing math
   modules, so an insight can never claim a number those modules do not produce. */
(function (root, factory) {
  'use strict';
  const api = factory(
    typeof require === 'function' ? require('./raid.js') : root.NestPulseRaid,
    typeof require === 'function' ? require('./models.js') : root.NestPulseModels,
    typeof require === 'function' ? require('./tidy.js') : root.NestPulseTidy,
    typeof require === 'function' ? require('./rules.js') : root.NestPulseRules
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseInsights = api;
  }
})(typeof self !== 'undefined' ? self : this, function (raid, models, tidy, rules) {
  'use strict';

  function round(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  /* ------------------------------------------------------------------ *
   * Storage frontier: the smallest drive count for a target capacity
   * ------------------------------------------------------------------ */

  /**
   * For one RAID level and a desired usable capacity, find the smallest drive
   * count at each candidate drive size that reaches the target. A level that
   * cannot reach the target at a given size reports null rather than a fake
   * projection. The result is the capacity frontier, not a single answer.
   */
  function storageFrontier(targetTb, options) {
    const opts = options || {};
    const sizes = Array.isArray(opts.driveSizesTb) ? opts.driveSizesTb : [2, 4, 8, 12, 16, 20];
    const levels = Array.isArray(opts.levels) ? opts.levels : ['0', '1', '5', '6', '10'];
    const maxDrives = Math.max(2, Math.floor(opts.maxDrives || 16));
    const target = Math.max(0, Number(targetTb) || 0);
    const rows = [];
    for (const level of levels) {
      for (const driveTb of sizes) {
        let chosen = null;
        for (let drives = 2; drives <= maxDrives; drives += 1) {
          const res = raid.computeRaid({ level: level, drives: drives, driveTb: driveTb, rebuildMbps: 200 });
          if (!res.ok) { continue; }
          if (res.usableTb + 1e-9 >= target) {
            chosen = {
              drives: drives,
              usableTb: round(res.usableTb, 2),
              rawTb: round(res.rawTb, 2),
              efficiency: round(res.efficiency, 4),
              rebuildHours: res.rebuildHours === null ? null : round(res.rebuildHours, 2),
              faultTolerance: res.guaranteedFaultTolerance
            };
            break;
          }
        }
        rows.push({ level: level, driveTb: driveTb, targetTb: target, config: chosen });
      }
    }
    const reachable = rows.filter(function (row) { return row.config !== null; });
    const cheapest = reachable.slice().sort(function (a, b) {
      return (a.config.rawTb - b.config.rawTb) ||
        (a.config.drives - b.config.drives) ||
        (a.level < b.level ? -1 : 1);
    });
    return {
      targetTb: target,
      rows: rows,
      reachableCount: reachable.length,
      totalCount: rows.length,
      bestRawEfficiency: cheapest.length ? cheapest[0] : null,
      levels: levels.slice(),
      driveSizesTb: sizes.slice()
    };
  }

  /* ------------------------------------------------------------------ *
   * Memory frontier: the smallest budget that fits each catalog entry
   * ------------------------------------------------------------------ */

  /**
   * For each catalog entry, find the smallest budget (in GB) at which the best
   * quantization fits at a fixed context length, by a coarse to fine search.
   * The exact threshold is then solved by bisection over the arithmetic, so the
   * reported budget is a boundary rather than a grid point.
   */
  function memoryFrontier(tokens, options) {
    const opts = options || {};
    const context = Math.max(0, Math.floor(opts.tokens || tokens || 8192));
    const budgets = Array.isArray(opts.budgetsGb) ? opts.budgetsGb : [2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
    const rows = [];
    for (const model of models.CATALOG) {
      let firstFit = null;
      for (let i = 0; i < budgets.length; i += 1) {
        const bytes = budgets[i] * 1e9;
        const quant = models.bestQuant(model, bytes, context);
        if (quant) {
          firstFit = { budgetGb: budgets[i], quantId: quant.id, quantLabel: quant.label, index: i };
          break;
        }
      }
      let exactBudgetGb = null;
      if (firstFit) {
        let low = firstFit.index === 0 ? 0 : budgets[firstFit.index - 1];
        let high = firstFit.budgetGb;
        for (let step = 0; step < 40; step += 1) {
          const mid = (low + high) / 2;
          if (models.bestQuant(model, mid * 1e9, context)) { high = mid; } else { low = mid; }
        }
        // Round up so the published threshold is on the fitting side of the
        // boundary rather than a hair below it.
        exactBudgetGb = Math.ceil(high * 1000) / 1000;
      }
      const thresholdQuant = exactBudgetGb === null ? null
        : models.bestQuant(model, exactBudgetGb * 1e9, context);
      const smallest = models.QUANTS[0];
      rows.push({
        id: model.id,
        name: model.name,
        family: model.family,
        params: model.params,
        contextTokens: context,
        firstGridFitGb: firstFit ? firstFit.budgetGb : null,
        exactThresholdGb: exactBudgetGb,
        quantAtThreshold: thresholdQuant ? thresholdQuant.label : null,
        weightGbAtSmallest: round(models.weightBytes(model.params, smallest.bitsPerWeight) / 1e9, 3),
        kvGbAtContext: round(models.kvBytes(model, context) / 1e9, 3)
      });
    }
    const fitting = rows.filter(function (row) { return row.exactThresholdGb !== null; });
    return {
      contextTokens: context,
      rows: rows,
      fittingCount: fitting.length,
      catalogCount: rows.length,
      budgetsGb: budgets.slice(),
      cheapest: fitting.slice().sort(function (a, b) {
        return a.exactThresholdGb - b.exactThresholdGb || (a.id < b.id ? -1 : 1);
      })[0] || null,
      mostDemanding: fitting.slice().sort(function (a, b) {
        return b.exactThresholdGb - a.exactThresholdGb || (a.id < b.id ? -1 : 1);
      })[0] || null
    };
  }

  /* ------------------------------------------------------------------ *
   * Cleanup curve: savings against the confidence threshold
   * ------------------------------------------------------------------ */

  /**
   * Sweep the tidy confidence threshold and report, for each step, how many
   * proposals pass, how many bytes they reclaim, and how many bytes stay in the
   * suppressed pile. The knee is the step with the largest marginal byte loss
   * from raising the threshold. It measures suppressed demo proposals, not loss
   * of real files. Deterministic because planCleanup is deterministic.
   */
  function cleanupCurve(manifest, options) {
    const opts = options || {};
    const steps = Array.isArray(opts.thresholds) ? opts.thresholds
      : [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.0, 1.01];
    const base = Object.assign({}, opts.planOptions || {});
    const rows = steps.map(function (threshold) {
      const plan = tidy.planCleanup(manifest, Object.assign({}, base, { minConfidence: threshold }));
      return {
        threshold: threshold,
        actionCount: plan.actions.length,
        savingBytes: plan.potentialSavingBytes,
        suppressedCount: plan.suppressed.count,
        suppressedBytes: plan.suppressed.bytes,
        totalLibraryBytes: plan.totalLibraryBytes
      };
    });
    let knee = null;
    let biggestLoss = -1;
    for (let i = 1; i < rows.length; i += 1) {
      const loss = rows[i - 1].savingBytes - rows[i].savingBytes;
      if (loss > biggestLoss) { biggestLoss = loss; knee = { from: rows[i - 1].threshold, to: rows[i].threshold, bytesLost: loss }; }
    }
    return {
      rows: rows,
      knee: knee,
      maxSavingBytes: rows.length ? Math.max.apply(null, rows.map(function (r) { return r.savingBytes; })) : 0,
      finalSavingBytes: rows.length ? rows[rows.length - 1].savingBytes : 0
    };
  }

  /* ------------------------------------------------------------------ *
   * Conflict graph: connected components and severity ranking
   * ------------------------------------------------------------------ */

  /**
   * Treat every predicted conflict as an edge between two rule ids and build
   * the connected components. A rule in a large component is a systemic risk;
   * an isolated rule is self contained. Severity is the number of conflicts a
   * rule participates in, with contradictions weighted above duplicates.
   */
  function conflictGraph(ruleSet, logs) {
    const result = rules.dryRun(ruleSet, logs);
    const ids = ruleSet.map(function (rule) { return rule.id; });
    const adjacency = new Map();
    const severity = new Map();
    for (const id of ids) { adjacency.set(id, new Set()); severity.set(id, { count: 0, weighted: 0, contradiction: 0, shadowed: 0, duplicateEffect: 0 }); }
    for (const pair of result.pairs) {
      const a = pair.ruleA || (pair.a && pair.a.id) || pair.aId;
      const b = pair.ruleB || (pair.b && pair.b.id) || pair.bId;
      if (!a || !b || !adjacency.has(a) || !adjacency.has(b)) { continue; }
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
      const weight = pair.kind === 'contradiction' ? 3 : pair.kind === 'shadowed' ? 2 : 1;
      for (const id of [a, b]) {
        const entry = severity.get(id);
        entry.count += 1;
        entry.weighted += weight;
        if (Object.prototype.hasOwnProperty.call(entry, pair.kind)) { entry[pair.kind] += 1; }
      }
    }
    const seen = new Set();
    const components = [];
    for (const id of ids) {
      if (seen.has(id)) { continue; }
      const queue = [id];
      const members = [];
      seen.add(id);
      while (queue.length) {
        const current = queue.shift();
        members.push(current);
        for (const neighbor of adjacency.get(current)) {
          if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
        }
      }
      members.sort();
      components.push({
        members: members,
        size: members.length,
        weightedSeverity: members.reduce(function (sum, m) { return sum + severity.get(m).weighted; }, 0)
      });
    }
    components.sort(function (a, b) { return b.size - a.size || (a.members[0] < b.members[0] ? -1 : 1); });
    const ranking = ids.map(function (id) {
      return Object.assign({ id: id }, severity.get(id));
    }).sort(function (a, b) { return b.weighted - a.weighted || (a.id < b.id ? -1 : 1); });
    return {
      ruleCount: ids.length,
      conflictCount: result.pairs.length,
      components: components,
      largestComponent: components.length ? components[0] : null,
      isolatedCount: components.filter(function (c) { return c.size === 1; }).length,
      ranking: ranking,
      mostEntangled: ranking.length && ranking[0].count > 0 ? ranking[0] : null,
      validationCount: result.validation.length,
      totalFires: result.reports.reduce(function (sum, r) { return sum + r.fires; }, 0)
    };
  }

  /* ------------------------------------------------------------------ *
   * Panel digest: one object the UI can render without recomputing
   * ------------------------------------------------------------------ */

  function buildDigest(manifest, ruleSet, logs, options) {
    const opts = options || {};
    const storage = storageFrontier(opts.targetTb || 24, opts.storage);
    const memory = memoryFrontier(opts.tokens || 8192, opts.memory);
    const cleanup = cleanupCurve(manifest, opts.cleanup);
    const graph = conflictGraph(ruleSet, logs);
    return {
      storage: {
        targetTb: storage.targetTb,
        reachableCount: storage.reachableCount,
        totalCount: storage.totalCount,
        bestRawEfficiency: storage.bestRawEfficiency
      },
      memory: {
        contextTokens: memory.contextTokens,
        fittingCount: memory.fittingCount,
        catalogCount: memory.catalogCount,
        cheapest: memory.cheapest,
        mostDemanding: memory.mostDemanding
      },
      cleanup: {
        knee: cleanup.knee,
        maxSavingBytes: cleanup.maxSavingBytes,
        finalSavingBytes: cleanup.finalSavingBytes,
        stepCount: cleanup.rows.length
      },
      rules: {
        ruleCount: graph.ruleCount,
        conflictCount: graph.conflictCount,
        largestComponent: graph.largestComponent,
        isolatedCount: graph.isolatedCount,
        mostEntangled: graph.mostEntangled,
        totalFires: graph.totalFires
      }
    };
  }

  return {
    round: round,
    clamp: clamp,
    storageFrontier: storageFrontier,
    memoryFrontier: memoryFrontier,
    cleanupCurve: cleanupCurve,
    conflictGraph: conflictGraph,
    buildDigest: buildDigest
  };
});
