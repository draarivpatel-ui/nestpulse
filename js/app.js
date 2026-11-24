/* NestPulse browser app. Reads the shared math modules and renders the four modules
   as instrument panels on the diagnostic bench. Everything is client side; there are
   no network calls of any kind. */
(function () {
  'use strict';

  /* Marks the page as script capable so the reveal styles only hide sections
     when the code that reveals them is running. */
  document.documentElement.classList.add('js');

  const $ = function (id) { return document.getElementById(id); };

  const LEVEL_ORDER = ['0', '1', '5', '6', '10'];
  const CONFLICT_LABELS = {
    contradiction: 'Contradiction',
    duplicateEffect: 'Duplicate Effect',
    shadowed: 'Shadowed Rule',
  };
  /* LEDs stay semantic: a contradiction is a fault, a shadowed rule wants attention,
     a duplicate effect is informational, so it gets a dim unlit lamp. */
  const CONFLICT_LED = {
    contradiction: 'led-fault',
    duplicateEffect: 'led-dim',
    shadowed: 'led-warn',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  /* Unit boundaries sit just below the round-trip point so a value never
     renders as "1000.0" of the smaller unit. */
  function fmtBytes(bytes) {
    if (!isFinite(bytes)) { return 'Not applicable'; }
    if (bytes >= 999.95e6) { return (bytes / 1e9).toFixed(2) + ' GB'; }
    if (bytes >= 999.95e3) { return (bytes / 1e6).toFixed(1) + ' MB'; }
    if (bytes >= 999.5) { return (bytes / 1e3).toFixed(1) + ' KB'; }
    return Math.round(bytes) + ' B';
  }

  function fmtHours(hours) {
    if (hours === null || hours === undefined || !isFinite(hours)) { return 'Not applicable'; }
    return hours >= 48 ? (hours / 24).toFixed(1) + ' days' : hours.toFixed(1) + ' hours';
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function chip(text, tone) {
    const node = el('span', 'chip chip-' + tone);
    const lamp = el('i', 'led led-' + tone);
    lamp.setAttribute('aria-hidden', 'true');
    node.appendChild(lamp);
    node.appendChild(document.createTextNode(text));
    return node;
  }

  /* ----------------------------- Storage Doctor ----------------------------- */

  /* The bay lamp is a real status light: coral when the configuration cannot be
     built, amber when the projection asks for attention (no redundancy at all, or
     a rebuild measured in days), mint the rest of the time. */
  function ledForRaid(level, result) {
    if (!result.ok) { return 'led-fault'; }
    if (level === '0') { return 'led-warn'; }
    if (result.rebuildHours !== null && result.rebuildHours >= 48) { return 'led-warn'; }
    return 'led-ok';
  }

  /* One segment per drive: solid for data capacity, hatched for the portion the
     level spends on redundancy. Decorative; the readout list carries the numbers. */
  function bayTrack(result) {
    const track = el('div', 'bay-track');
    track.setAttribute('aria-hidden', 'true');
    const dataDrives = Math.round(result.drives - result.redundancyDrives);
    for (let i = 0; i < result.drives; i += 1) {
      track.appendChild(el('i', i < dataDrives ? 'seg seg-data' : 'seg seg-redundant'));
    }
    return track;
  }

  function readoutRow(dl, term, value) {
    const row = el('div', 'readout-row');
    row.appendChild(el('dt', null, term));
    row.appendChild(el('dd', 'mono', value));
    dl.appendChild(row);
  }

  function raidBay(level, result) {
    const label = NestPulseRaid.LEVELS[level] ? NestPulseRaid.LEVELS[level].label : 'RAID ' + level;
    const card = el('article', 'bay-unit' + (result.ok ? '' : ' is-fault'));
    const head = el('header', 'bay-unit-head');
    const lamp = el('i', 'led ' + ledForRaid(level, result));
    lamp.setAttribute('aria-hidden', 'true');
    head.appendChild(lamp);
    head.appendChild(el('h3', 'bay-unit-name', label));
    card.appendChild(head);

    if (!result.ok) {
      card.appendChild(el('p', 'bay-empty', result.error));
      return card;
    }

    card.appendChild(bayTrack(result));

    const big = el('p', 'bay-usable');
    big.appendChild(el('span', 'num', result.usableTb.toFixed(1) + ' TB'));
    big.appendChild(el('span', 'sub', 'usable of ' + result.rawTb.toFixed(1) + ' TB raw'));
    card.appendChild(big);

    card.appendChild(el('p', 'arithmetic mono', result.drives + ' \u00d7 ' + result.driveTb
      + ' TB = ' + result.rawTb.toFixed(1) + ' TB raw, minus '
      + (result.redundancyDrives % 1 === 0 ? result.redundancyDrives : result.redundancyDrives.toFixed(1))
      + ' for redundancy = ' + result.usableTb.toFixed(1) + ' TB usable.'));

    const meta = el('dl', 'readout');
    readoutRow(meta, 'Efficiency', Math.round(result.efficiency * 100) + '%');
    readoutRow(meta, 'Fault tolerance', result.guaranteedFaultTolerance === result.bestCaseFaultTolerance
      ? plural(result.guaranteedFaultTolerance, 'drive')
      : '1 guaranteed, up to ' + result.bestCaseFaultTolerance);
    readoutRow(meta, 'Rebuild', fmtHours(result.rebuildHours));
    readoutRow(meta, 'Usable in TiB', result.usableTib.toFixed(2) + ' TiB');
    card.appendChild(meta);

    const notes = el('ul', 'bay-notes');
    for (const note of result.notes) {
      notes.appendChild(el('li', null, note));
    }
    card.appendChild(notes);
    return card;
  }

  function initStorage() {
    const render = function () {
      const input = $('drive-count');
      const maxDrives = Number(input.max) > 0 ? Math.floor(Number(input.max)) : 64;
      const rawDrives = Math.round(Number(input.value));
      const clamped = Number.isFinite(rawDrives) && rawDrives > maxDrives;
      const drives = clamped ? maxDrives : rawDrives;
      const driveTb = Number($('drive-size').value);
      const rebuildMbps = Number($('rebuild-speed').value);
      $('rebuild-speed-out').textContent = rebuildMbps + ' MB per second';
      $('storage-summary').textContent = Number.isFinite(drives) && drives >= 1
        ? 'Capacity math for ' + plural(drives, 'drive')
          + ' of ' + driveTb + ' TB each, with rebuilds at ' + rebuildMbps + ' MB per second.'
          + (clamped ? ' The count is capped at the field maximum of ' + maxDrives + '.' : '')
        : 'Drive count needs to be a positive whole number to see capacity math.';
      const grid = $('raid-grid');
      clear(grid);
      for (const level of LEVEL_ORDER) {
        const result = NestPulseRaid.computeRaid({
          level: level,
          drives: drives,
          driveTb: driveTb,
          rebuildMbps: rebuildMbps,
        });
        grid.appendChild(raidBay(level, result));
      }
    };
    $('drive-count').addEventListener('input', render);
    $('drive-size').addEventListener('change', render);
    $('rebuild-speed').addEventListener('input', render);
    render();
  }

  /* -------------------------------- Memory Fit ------------------------------- */

  function quantLadder(model, tokens, budgetBytes) {
    const list = el('ul', 'quant-ladder');
    for (const quant of NestPulseModels.QUANTS) {
      const total = NestPulseModels.totalBytes(model, quant, tokens);
      const fits = total <= budgetBytes;
      list.appendChild(el('li', fits ? 'fits' : 'does-not-fit',
        quant.label + ': ' + fmtBytes(total) + ' total, ' + (fits ? 'fits' : 'does not fit')));
    }
    return list;
  }

  /* A small pressure gauge under the total: how much of the budget this model and
     context would consume. Neutral when comfortable, amber when tight, coral when
     it does not fit at all. */
  function utilBar(check) {
    const bar = el('span', 'util-bar');
    bar.setAttribute('aria-hidden', 'true');
    const tone = !check.fits ? 'bar-no' : check.verdict === 'tight' ? 'bar-warn' : 'bar-ok';
    const fill = el('i', 'util-fill ' + tone);
    const pct = isFinite(check.utilization)
      ? Math.max(2, Math.min(100, Math.round(check.utilization * 100)))
      : 100;
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return bar;
  }

  function modelRow(model, best, budgetBytes, tokens) {
    const quant = best || NestPulseModels.QUANTS[0];
    const check = NestPulseModels.fitCheck(model, quant, budgetBytes, tokens);
    const row = el('tr', best ? 'verdict-' + check.verdict : 'row-no-fit');

    const nameCell = el('td', null);
    nameCell.appendChild(el('span', 'model-name', model.name));
    nameCell.appendChild(el('span', 'model-family', model.family));
    row.appendChild(nameCell);
    row.appendChild(el('td', 'mono', model.params + ' B'));
    row.appendChild(el('td', null, best ? best.label : 'None fit'));
    row.appendChild(el('td', 'mono', fmtBytes(NestPulseModels.weightBytes(model.params, quant.bitsPerWeight))));
    row.appendChild(el('td', 'mono', fmtBytes(NestPulseModels.kvBytes(model, tokens))));

    const totalCell = el('td', 'mono total-cell');
    totalCell.appendChild(el('span', null, fmtBytes(check.totalBytes)));
    totalCell.appendChild(utilBar(check));
    row.appendChild(totalCell);

    const verdictCell = el('td', null);
    verdictCell.appendChild(best
      ? chip(check.verdict === 'comfortable' ? 'Fits Well' : 'Fits Tight',
        check.verdict === 'comfortable' ? 'ok' : 'warn')
      : chip('No Fit', 'fault'));
    if (check.beyondContext) {
      verdictCell.appendChild(el('span', 'verdict-note', 'Over the '
        + check.contextMax.toLocaleString('en-US') + '-token rated context'));
    }
    row.appendChild(verdictCell);

    const detailRow = el('tr', 'detail-row');
    const detailCell = el('td', null);
    detailCell.colSpan = 7;
    const details = el('details', null);
    const summary = el('summary', null, 'Show the arithmetic for ' + model.name);
    details.appendChild(summary);
    const body = el('div', 'detail-body');
    if (best) {
      body.appendChild(el('p', null, NestPulseModels.arithmeticLine(model, best, tokens, budgetBytes)));
      const maxTokens = NestPulseModels.maxTokens(model, best, budgetBytes);
      const atCeiling = check.contextMax !== null && maxTokens === check.contextMax;
      body.appendChild(el('p', null, 'At ' + best.label + ' this budget holds up to '
        + maxTokens.toLocaleString('en-US') + ' tokens of context'
        + (atCeiling ? ' - the rated ceiling for this model.' : '.')));
    } else {
      body.appendChild(el('p', null, 'Even ' + quant.label + ' needs ' + fmtBytes(check.totalBytes)
        + ', which is ' + fmtBytes(check.shortfallBytes) + ' over the budget. Nothing to trim.'));
    }
    body.appendChild(el('p', 'ladder-label', 'Full quantization ladder at ' + tokens.toLocaleString('en-US') + ' tokens:'));
    body.appendChild(quantLadder(model, tokens, budgetBytes));
    details.appendChild(body);
    detailCell.appendChild(details);
    detailRow.appendChild(detailCell);

    return [row, detailRow];
  }

  function initModels() {
    const render = function () {
      const budgetGb = Math.max(0, Number($('ram-budget').value) || 0);
      const tokens = Number($('context-tokens').value);
      const fitsOnly = $('fits-only').checked;
      const budgetBytes = budgetGb * 1e9;
      let fitCount = 0;
      const body = $('models-table-body');
      clear(body);
      for (const model of NestPulseModels.CATALOG) {
        const best = NestPulseModels.bestQuant(model, budgetBytes, tokens);
        if (best) { fitCount += 1; }
        if (fitsOnly && !best) { continue; }
        const rows = modelRow(model, best, budgetBytes, tokens);
        body.appendChild(rows[0]);
        body.appendChild(rows[1]);
      }
      $('models-headline').textContent = fitCount + ' of ' + NestPulseModels.CATALOG.length
        + ' catalog models fit a budget of ' + budgetGb + ' GB at '
        + tokens.toLocaleString('en-US') + ' tokens.';
    };
    $('ram-budget').addEventListener('input', render);
    $('context-tokens').addEventListener('change', render);
    $('fits-only').addEventListener('change', render);
    render();
  }

  /* -------------------------------- Tidy Plans ------------------------------ */

  function statBlock(value, label) {
    const block = el('div', 'stat');
    block.appendChild(el('span', 'num', value));
    block.appendChild(el('span', 'stat-label', label));
    return block;
  }

  /* Mint for a proposal backed by identical content, dim for pattern matches that
     deserve a look, amber for the low confidence classes. */
  function tidyLed(action) {
    if (action.confidence >= 0.9) { return 'led-ok'; }
    if (action.confidence >= 0.6) { return 'led-dim'; }
    return 'led-warn';
  }

  function tidyRow(action) {
    const row = el('article', 'ledger-row');
    const head = el('p', 'ledger-head');
    const lamp = el('i', 'led ' + tidyLed(action));
    lamp.setAttribute('aria-hidden', 'true');
    head.appendChild(lamp);
    head.appendChild(el('span', 'ledger-class', NestPulseTidy.CLASS_LABELS[action.class]));
    head.appendChild(el('span', 'ledger-conf mono', Math.round(action.confidence * 100) + '% confident'));
    row.appendChild(head);
    row.appendChild(el('p', 'ledger-bytes mono', fmtBytes(action.bytes)));
    row.appendChild(el('p', 'ledger-reason', action.reason));
    const details = el('details', null);
    details.appendChild(el('summary', null, 'Show the files'));
    const body = el('div', 'detail-body');
    if (action.keep) {
      body.appendChild(el('p', 'keep-line', 'Keep: ' + action.keep.path));
    }
    for (const removed of action.remove) {
      body.appendChild(el('p', 'remove-line', 'Remove: ' + removed.path));
    }
    details.appendChild(body);
    row.appendChild(details);
    return row;
  }

  function initTidy() {
    const manifest = NestPulseLibrary.manifest;
    const render = function () {
      const minConfidence = Number($('tidy-confidence').value);
      const keepNewest = $('keep-newest').checked;
      const cutoff = $('screenshot-cutoff').value;
      $('tidy-confidence-out').textContent = Math.round(minConfidence * 100) + ' percent or higher';

      const summary = NestPulseTidy.summarizeLibrary(manifest);
      const stats = $('tidy-stats');
      clear(stats);
      stats.appendChild(statBlock(String(summary.itemCount), 'items in the demo library'));
      stats.appendChild(statBlock(fmtBytes(summary.totalBytes), 'total size'));
      stats.appendChild(statBlock(String(summary.exactHashGroups), 'exact duplicate groups'));
      stats.appendChild(statBlock(String(summary.burstSets), 'burst sets of three or more'));

      const plan = NestPulseTidy.planCleanup(manifest, {
        minConfidence: minConfidence,
        keepNewest: keepNewest,
        screenshotCutoff: cutoff,
      });
      $('tidy-headline').textContent = plan.actions.length + ' ' + (plan.actions.length === 1 ? 'proposal' : 'proposals')
        + ' could free about ' + fmtBytes(plan.potentialSavingBytes) + '. '
        + (plan.suppressed.count
          ? plural(plan.suppressed.count, 'lower confidence proposal') + ' hiding '
            + fmtBytes(plan.suppressed.bytes) + ' sit below this threshold.'
          : 'Nothing sits below this threshold.');

      const list = $('tidy-actions');
      clear(list);
      for (const action of plan.actions) {
        list.appendChild(tidyRow(action));
      }
    };
    $('tidy-confidence').addEventListener('input', render);
    $('screenshot-cutoff').addEventListener('change', render);
    $('keep-newest').addEventListener('change', render);
    render();
  }

  /* -------------------------------- Rule Forge ------------------------------ */

  function ruleRow(rule) {
    const row = el('article', 'registry-row');
    row.appendChild(el('h4', 'registry-name', rule.name));
    const conditions = el('ul', 'term-row');
    conditions.setAttribute('aria-label', 'Conditions for ' + rule.name);
    for (const cond of rule.conditions) {
      conditions.appendChild(el('li', 'term', NestPulseRules.describeCondition(cond)));
    }
    row.appendChild(conditions);
    const actions = el('ul', 'term-row');
    actions.setAttribute('aria-label', 'Actions for ' + rule.name);
    for (const action of rule.actions) {
      const item = el('li', 'term term-act');
      const lamp = el('i', 'led led-ok');
      lamp.setAttribute('aria-hidden', 'true');
      item.appendChild(lamp);
      item.appendChild(document.createTextNode(NestPulseRules.describeAction(action)));
      actions.appendChild(item);
    }
    row.appendChild(actions);
    return row;
  }

  /* The fault readout panel: every predicted conflict gets a numbered finding,
     a kind lamp, the finding message, and what the demo logs actually observed. */
  function renderConflicts(pairs) {
    const list = $('conflicts-list');
    clear(list);
    if (pairs.length === 0) {
      list.appendChild(el('p', 'fault-empty', 'No potential conflicts found among these rules.'));
      return;
    }
    pairs.forEach(function (pair, index) {
      const row = el('article', 'fault-row kind-' + pair.kind);
      const code = el('p', 'fault-code mono');
      const lamp = el('i', 'led ' + (CONFLICT_LED[pair.kind] || 'led-dim'));
      lamp.setAttribute('aria-hidden', 'true');
      code.appendChild(lamp);
      code.appendChild(document.createTextNode('Finding ' + String(index + 1).padStart(2, '0')));
      row.appendChild(code);
      const body = el('div', 'fault-body');
      body.appendChild(el('p', 'fault-kind', CONFLICT_LABELS[pair.kind] || pair.kind));
      body.appendChild(el('p', 'fault-msg', pair.message));
      if (pair.observedLine) {
        body.appendChild(el('p', 'fault-observed mono', pair.observedLine));
      }
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function renderValidation(issues) {
    const list = $('validation-list');
    clear(list);
    if (issues.length === 0) {
      list.appendChild(el('p', 'validation-empty', 'No validation notes. Every rule references known sensors and devices.'));
      return;
    }
    for (const issue of issues) {
      const note = el('p', 'validation-note');
      const lamp = el('i', 'led led-warn');
      lamp.setAttribute('aria-hidden', 'true');
      note.appendChild(lamp);
      note.appendChild(document.createTextNode(issue.message));
      list.appendChild(note);
    }
  }

  function renderFires(reports, logsCount) {
    const body = $('fires-body');
    clear(body);
    for (const report of reports) {
      const row = el('tr');
      const nameCell = el('th', null, report.name);
      nameCell.setAttribute('scope', 'row');
      row.appendChild(nameCell);
      row.appendChild(el('td', 'mono', report.fires + ' of ' + logsCount + ' samples'));
      const first = report.exampleTimes.length ? report.exampleTimes[0].replace('T', ' ') : 'Never';
      row.appendChild(el('td', 'mono', first));
      body.appendChild(row);
    }
  }

  function initRules() {
    const rules = NestPulseRuleSet.rules;
    const logs = NestPulseSensorLogs.buildLogs();

    const list = $('rules-list');
    clear(list);
    for (const rule of rules) {
      list.appendChild(ruleRow(rule));
    }

    const render = function () {
      const result = NestPulseRules.dryRun(rules, logs);
      const totalFires = result.reports.reduce(function (total, report) { return total + report.fires; }, 0);
      $('rules-summary').textContent = totalFires + ' rule fires across ' + result.logsCount
        + ' hourly demo samples, with ' + result.conflicts.length + ' potential conflict'
        + (result.conflicts.length === 1 ? '' : 's') + ' predicted.';
      renderConflicts(result.pairs);
      renderValidation(result.validation);
      renderFires(result.reports, result.logsCount);
    };
    $('rerun-rules').addEventListener('click', render);
    render();
  }

  /* ---------------------------- Cross-Panel Insights ------------------------ */

  function fmtGb(bytes) {
    return (bytes / 1e9).toFixed(2) + ' GB';
  }

  function initInsights() {
    const insights = NestPulseInsights;
    const manifest = NestPulseLibrary.manifest;
    const rules = NestPulseRuleSet.rules;
    const logs = NestPulseSensorLogs.buildLogs();
    const capacity = $('target-capacity');
    const context = $('context-frontier');

    const render = function () {
      const targetTb = Number(capacity.value);
      const tokens = Number(context.value);
      $('target-capacity-out').textContent = targetTb + ' TB';

      const storage = insights.storageFrontier(targetTb);
      const memory = insights.memoryFrontier(tokens);
      const cleanup = insights.cleanupCurve(manifest);
      const graph = insights.conflictGraph(rules, logs);
      const digest = insights.buildDigest(manifest, rules, logs, { targetTb: targetTb, tokens: tokens });

      $('insights-summary').textContent =
        storage.reachableCount + ' of ' + storage.totalCount + ' array configurations reach ' +
        targetTb + ' TB, ' + memory.fittingCount + ' of ' + memory.catalogCount +
        ' catalog entries fit at ' + tokens + ' tokens, and the rule set forms ' +
        graph.components.length + ' conflict groups.';

      $('storage-frontier-lead').textContent = storage.bestRawEfficiency
        ? 'Least raw capacity: RAID ' + storage.bestRawEfficiency.level + ' with ' +
          storage.bestRawEfficiency.config.drives + ' x ' + storage.bestRawEfficiency.driveTb +
          ' TB drives, ' + storage.bestRawEfficiency.config.rawTb + ' TB raw.'
        : 'No shipped configuration reaches this target.';
      const storageBody = $('storage-frontier-body');
      clear(storageBody);
      for (const row of storage.rows) {
        const tr = el('tr');
        tr.appendChild(el('td', 'mono', 'RAID ' + row.level));
        tr.appendChild(el('td', 'mono', row.driveTb + ' TB'));
        tr.appendChild(el('td', 'mono', row.config ? String(row.config.drives) : 'n/a'));
        tr.appendChild(el('td', 'mono', row.config ? row.config.usableTb + ' TB' : 'n/a'));
        tr.appendChild(el('td', 'mono', row.config ? (row.config.efficiency * 100).toFixed(0) + '%' : 'n/a'));
        storageBody.appendChild(tr);
      }

      $('memory-frontier-lead').textContent = memory.cheapest
        ? 'Easiest fit: ' + memory.cheapest.name + ' at ' + memory.cheapest.exactThresholdGb +
          ' GB. Hardest: ' + (memory.mostDemanding ? memory.mostDemanding.name : 'n/a') + '.'
        : 'No catalog entry fits any shipped budget.';
      const memoryBody = $('memory-frontier-body');
      clear(memoryBody);
      for (const row of memory.rows) {
        const tr = el('tr');
        const nameTd = el('td', null, row.name);
        if (row.withinContext === false) {
          nameTd.appendChild(el('span', 'verdict-note', ' rated to '
            + Number(row.contextMax).toLocaleString('en-US') + ' tokens'));
        }
        tr.appendChild(nameTd);
        tr.appendChild(el('td', 'mono', row.exactThresholdGb === null ? 'n/a' : row.exactThresholdGb + ' GB'));
        tr.appendChild(el('td', 'mono', row.weightGbAtSmallest + ' GB'));
        tr.appendChild(el('td', 'mono', row.kvGbAtContext + ' GB'));
        memoryBody.appendChild(tr);
      }

      $('cleanup-curve-lead').textContent = cleanup.knee
        ? 'Largest marginal loss from ' + cleanup.knee.from.toFixed(2) + ' to ' +
          cleanup.knee.to.toFixed(2) + ' confidence: ' + fmtGb(cleanup.knee.bytesLost) +
          '. Maximum ' + fmtGb(cleanup.maxSavingBytes) + ' reclaimable.'
        : 'The demo library has no cleanup curve.';
      const cleanupBody = $('cleanup-curve-body');
      clear(cleanupBody);
      for (const row of cleanup.rows) {
        const tr = el('tr');
        tr.appendChild(el('td', 'mono', row.threshold.toFixed(2)));
        tr.appendChild(el('td', 'mono', String(row.actionCount)));
        tr.appendChild(el('td', 'mono', fmtGb(row.savingBytes)));
        tr.appendChild(el('td', 'mono', String(row.suppressedCount)));
        cleanupBody.appendChild(tr);
      }

      $('conflict-graph-lead').textContent =
        graph.conflictCount + ' conflicts across ' + graph.ruleCount + ' rules, largest group of ' +
        (graph.largestComponent ? graph.largestComponent.size : 0) + ', ' +
        graph.isolatedCount + ' isolated rules.';
      const graphBody = $('conflict-graph-body');
      clear(graphBody);
      graph.components.forEach(function (component, index) {
        const tr = el('tr');
        tr.appendChild(el('td', 'mono', 'Group ' + String(index + 1).padStart(2, '0') +
          ': ' + component.members.join(', ')));
        tr.appendChild(el('td', 'mono', String(component.size)));
        tr.appendChild(el('td', 'mono', String(component.weightedSeverity)));
        graphBody.appendChild(tr);
      });
      const ranking = $('conflict-ranking');
      clear(ranking);
      for (const entry of graph.ranking.slice(0, 4)) {
        const item = el('li');
        item.appendChild(el('b', null, entry.id));
        item.appendChild(document.createTextNode(' ' + entry.count + ' conflicts, weighted ' + entry.weighted));
        ranking.appendChild(item);
      }

      // A digest is computed even though the panels read the full analyses, so
      // the pure aggregation path is exercised on every render.
      void digest;
    };

    capacity.addEventListener('input', render);
    capacity.addEventListener('change', render);
    context.addEventListener('change', render);
    render();
  }

  /* ------------------------- Resilience and URE Lab ------------------------- */

  function fmtProbPercent(p) {
    if (p === null || p === undefined || !Number.isFinite(p)) { return 'n/a'; }
    const pct = p * 100;
    if (pct >= 99.95) { return 'about 100%'; }
    if (pct >= 0.1) { return pct.toFixed(1) + '%'; }
    if (pct >= 0.001) { return pct.toFixed(2) + '%'; }
    return pct.toExponential(1) + '%';
  }

  function berClassLabel(berExp) {
    const found = NestPulseLab.BER_CLASSES.find(function (c) { return c.berExp === berExp; });
    return found ? found.label + ' media at 1e-' + berExp : 'a nominal BER of 1e-' + berExp;
  }

  function svgNode(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key of Object.keys(attrs)) { node.setAttribute(key, attrs[key]); }
    return node;
  }

  function fireEvent(node, type) {
    if (typeof node.fire === 'function') { node.fire(type); return; }
    node.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function riskLed(risk) {
    switch (risk) {
      case 'low': return 'led-ok';
      case 'elevated': return 'led-warn';
      case 'high': return 'led-fault';
      case 'critical': return 'led-fault';
      default: return 'led-dim';
    }
  }

  /* The comparator table: one row per level, the Storage Doctor numbers next to
     the Poisson rebuild loss probability. */
  function renderCompare(body, compare) {
    clear(body);
    for (const row of compare.rows) {
      const tr = el('tr', row.ok ? null : 'row-no-fit');
      const nameTd = el('th', null, row.label);
      nameTd.setAttribute('scope', 'row');
      tr.appendChild(nameTd);
      if (!row.ok) {
        const bad = el('td', 'bay-empty', row.error);
        bad.colSpan = 6;
        tr.appendChild(bad);
        body.appendChild(tr);
        continue;
      }
      tr.appendChild(el('td', 'mono', row.usableTib.toFixed(2) + ' TiB'));
      tr.appendChild(el('td', 'mono', Math.round(row.efficiency * 100) + '%'));
      tr.appendChild(el('td', 'mono', row.guaranteedFaultTolerance === row.bestCaseFaultTolerance
        ? plural(row.guaranteedFaultTolerance, 'drive')
        : '1 guaranteed, up to ' + row.bestCaseFaultTolerance));
      tr.appendChild(el('td', 'mono', fmtHours(row.rebuildHours)));
      tr.appendChild(el('td', 'mono', row.drivesRead === null ? 'n/a' : plural(row.drivesRead, 'drive')));
      const riskCell = el('td', null);
      const riskChip = chip(row.ureProbability === null ? 'No rebuild' : NestPulseLab.ureRiskLabel(row.ureProbability),
        row.risk === 'na' ? 'warn' : row.risk === 'low' ? 'ok' : row.risk === 'elevated' ? 'warn' : 'fault');
      riskCell.appendChild(riskChip);
      riskCell.appendChild(el('span', 'verdict-note mono',
        row.ureProbability === null ? 'Nothing to rebuild from' : fmtProbPercent(row.ureProbability) + ' rebuild loss risk'));
      tr.appendChild(riskCell);
      body.appendChild(tr);
    }
  }

  /* The sweep chart: log scale URE loss probability against drive capacity for
     the three redundant levels. Every data point is a keyboard focusable
     circle that reports its exact number into the live readout. */
  const SWEEP_COLORS = { '5': '#ef8974', '6': '#5fd3a5', '10': '#f1eee3' };
  const SWEEP_NAMES = { '5': 'RAID 5', '6': 'RAID 6', '10': 'RAID 10' };

  function renderSweepChart(host, sweep, berExp, readout) {
    clear(host);
    const W = 660;
    const H = 300;
    const ML = 62;
    const MR = 14;
    const MT = 14;
    const MB = 36;
    const YMIN = 1e-6;
    const YMAX = 1;
    const sizes = sweep.sizesTb;
    const xMin = Math.min.apply(null, sizes);
    const xMax = Math.max.apply(null, sizes);
    const xOf = function (tb) {
      return ML + (xMax === xMin ? 0 : (tb - xMin) / (xMax - xMin)) * (W - ML - MR);
    };
    const yOf = function (p) {
      const clamped = Math.min(YMAX, Math.max(YMIN, p === null ? YMIN : p));
      const t = (Math.log10(clamped) - Math.log10(YMIN)) / (Math.log10(YMAX) - Math.log10(YMIN));
      return MT + (1 - t) * (H - MT - MB);
    };
    const svg = svgNode('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      class: 'lab-sweep',
      role: 'group',
      'aria-label': 'Rebuild URE loss probability versus drive capacity for RAID 5, RAID 6 and RAID 10',
    });
    const decades = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
    const decadeLabels = ['0.0001%', '0.001%', '0.01%', '0.1%', '1%', '10%', '100%'];
    decades.forEach(function (d, i) {
      const y = yOf(d);
      svg.appendChild(svgNode('line', {
        x1: ML, x2: W - MR, y1: y, y2: y, class: 'chart-grid' + (d === 1 ? ' chart-grid-top' : ''),
      }));
      const label = svgNode('text', { x: ML - 8, y: y + 3.5, class: 'chart-tick', 'text-anchor': 'end' });
      label.textContent = decadeLabels[i];
      svg.appendChild(label);
    });
    for (const tb of sizes) {
      const x = xOf(tb);
      svg.appendChild(svgNode('line', { x1: x, x2: x, y1: H - MB, y2: H - MB + 4, class: 'chart-grid' }));
      const tick = svgNode('text', { x: x, y: H - MB + 16, class: 'chart-tick', 'text-anchor': 'middle' });
      tick.textContent = tb;
      svg.appendChild(tick);
    }
    const axisX = svgNode('text', { x: (ML + W - MR) / 2, y: H - 6, class: 'chart-axis', 'text-anchor': 'middle' });
    axisX.textContent = 'Drive capacity, TB';
    svg.appendChild(axisX);
    const axisY = svgNode('text', {
      x: 12, y: (MT + H - MB) / 2, class: 'chart-axis', 'text-anchor': 'middle',
      transform: 'rotate(-90 12 ' + ((MT + H - MB) / 2) + ')',
    });
    axisY.textContent = 'Loss probability';
    svg.appendChild(axisY);

    for (const series of sweep.series) {
      const pts = series.points.map(function (p) {
        return xOf(p.driveTb).toFixed(2) + ',' + yOf(p.p).toFixed(2);
      });
      svg.appendChild(svgNode('polyline', {
        points: pts.join(' '),
        class: 'chart-line',
        fill: 'none',
        stroke: SWEEP_COLORS[series.level],
      }));
      for (const point of series.points) {
        const circle = svgNode('circle', {
          cx: xOf(point.driveTb), cy: yOf(point.p), r: 4.5,
          class: 'ure-point', fill: SWEEP_COLORS[series.level],
          tabindex: '0', role: 'button',
          'aria-label': SWEEP_NAMES[series.level] + ' at ' + point.driveTb + ' TB, rebuild loss risk '
            + fmtProbPercent(point.p),
        });
        const title = svgNode('title', {});
        title.textContent = SWEEP_NAMES[series.level] + ' at ' + point.driveTb + ' TB: '
          + fmtProbPercent(point.p) + ' rebuild loss risk';
        circle.appendChild(title);
        const announce = function () {
          readout.textContent = SWEEP_NAMES[series.level] + ' at ' + point.driveTb + ' TB: '
            + fmtProbPercent(point.p) + ' rebuild loss risk at ' + berClassLabel(berExp)
            + ', reading ' + plural(NestPulseLab.rebuildDrivesRead(series.level, sweep.state.drives), 'drive')
            + ' end to end.';
        };
        circle.addEventListener('focus', announce);
        circle.addEventListener('mouseover', announce);
        circle.addEventListener('click', announce);
        circle.addEventListener('keydown', function (event) {
          if (event && (event.key === 'Enter' || event.key === ' ')) {
            if (typeof event.preventDefault === 'function') { event.preventDefault(); }
            announce();
          }
        });
        svg.appendChild(circle);
      }
    }

    const legend = el('p', 'chart-legend mono');
    for (const series of sweep.series) {
      const item = el('span', 'chart-legend-item');
      const swatch = el('i', 'chart-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.background = SWEEP_COLORS[series.level];
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(SWEEP_NAMES[series.level]));
      legend.appendChild(item);
    }
    host.appendChild(svg);
    host.appendChild(legend);
  }

  function initResilience() {
    const live = $('lab-live');
    const offline = $('lab-offline');
    if (typeof NestPulseLab === 'undefined' || !NestPulseLab) {
      if (live) { live.hidden = true; }
      if (offline) { offline.hidden = false; }
      return;
    }
    const lab = NestPulseLab;
    const berButtons = [$('lab-ber-14'), $('lab-ber-15'), $('lab-ber-16')].filter(Boolean);
    let berExp = 14;

    function state() {
      return lab.normalizeState({
        drives: Number($('drive-count').value),
        driveTb: Number($('drive-size').value),
        berExp: berExp,
        rebuildMbps: Number($('rebuild-speed').value),
        ramGb: Number($('ram-budget').value),
        tokens: Number($('context-tokens').value),
        panel: 'resilience',
      });
    }

    function markBerButtons() {
      for (const btn of berButtons) {
        btn.setAttribute('aria-pressed', Number(btn.getAttribute('data-ber')) === berExp ? 'true' : 'false');
      }
    }

    const render = function () {
      const current = state();
      markBerButtons();

      $('lab-sync-note').textContent = 'Synced with Storage Doctor: ' + plural(current.drives, 'drive')
        + ' of ' + current.driveTb + ' TB each, rebuilding at ' + current.rebuildMbps
        + ' MB per second. Memory Fit budget: ' + current.ramGb + ' GB at '
        + current.tokens.toLocaleString('en-US') + ' tokens.';

      const compare = lab.compareRaid(current);
      const sweep = lab.ureSweep(current);
      const rollup = lab.architectureRollup(current);
      const report = lab.reportFor(current);

      const p5 = compare.rows.find(function (r) { return r.level === '5'; });
      const p6 = compare.rows.find(function (r) { return r.level === '6'; });
      const p10 = compare.rows.find(function (r) { return r.level === '10'; });
      $('lab-summary').textContent = 'At ' + berClassLabel(current.berExp) + ': RAID 5 rebuild loss risk '
        + fmtProbPercent(p5.ureProbability) + ', RAID 6 ' + fmtProbPercent(p6.ureProbability)
        + ', RAID 10 ' + fmtProbPercent(p10.ureProbability) + ' for ' + current.drives
        + ' x ' + current.driveTb + ' TB drives.';

      renderCompare($('lab-compare-body'), compare);
      renderSweepChart($('lab-chart'), sweep, current.berExp, $('lab-sweep-readout'));

      const rollHost = $('lab-rollup');
      clear(rollHost);
      rollHost.appendChild(statBlock(
        rollup.storage.safest ? 'RAID ' + rollup.storage.safest.level : 'n/a',
        rollup.storage.safest
          ? 'safest rebuild at ' + fmtProbPercent(rollup.storage.safest.ureProbability) + ' loss risk'
          : 'no redundant level available'));
      rollHost.appendChild(statBlock(
        rollup.memory.fitCount + ' of ' + rollup.memory.catalogCount,
        'catalog entries fit the Memory Fit budget'));
      rollHost.appendChild(statBlock(fmtBytes(rollup.tidy.savingBytes),
        'reclaimable at the Tidy default threshold, ' + rollup.tidy.actionCount + ' proposals'));
      rollHost.appendChild(statBlock(String(rollup.rules.conflictCount),
        'predicted rule conflicts, ' + rollup.rules.validationCount + ' validation notes'));

      $('lab-digest').textContent = 'sha256 ' + report.sha256;
      if ($('lab-sweep-readout').textContent === '') {
        $('lab-sweep-readout').textContent = 'Focus or tap a point on the chart to read its exact probability.';
      }
    };

    function download(name, text, mime) {
      const status = $('lab-export-status');
      try {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function'
          || typeof Blob === 'undefined') {
          status.textContent = name + ' is ready: ' + text.length + ' bytes. Downloads need a full browser; the text is deterministic for this state.';
          return;
        }
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        status.textContent = name + ' exported, ' + text.length + ' bytes, stamped with the same sha256 shown above.';
      } catch (err) {
        status.textContent = 'The export could not start a download in this browser. The payload itself is intact.';
      }
    }

    for (const btn of berButtons) {
      btn.addEventListener('click', function () {
        const exp = Number(btn.getAttribute('data-ber'));
        if (Number.isFinite(exp)) { berExp = exp; }
        render();
      });
    }
    for (const id of ['drive-count', 'drive-size', 'rebuild-speed', 'ram-budget', 'context-tokens']) {
      const node = $(id);
      node.addEventListener('input', render);
      node.addEventListener('change', render);
    }

    $('lab-export-json').addEventListener('click', function () {
      download('nestpulse-resilience-report.json', lab.reportFor(state()).json, 'application/json');
    });
    $('lab-export-csv').addEventListener('click', function () {
      download('nestpulse-resilience-report.csv', lab.reportFor(state()).csv, 'text/csv');
    });
    $('lab-export-md').addEventListener('click', function () {
      download('nestpulse-resilience-report.md', lab.reportFor(state()).markdown, 'text/markdown');
    });

    $('lab-copy-link').addEventListener('click', function () {
      const status = $('lab-export-status');
      const hash = lab.encodeState(state());
      const base = typeof location !== 'undefined' && location && location.href
        ? String(location.href).split('#')[0] : '';
      const link = base + '#' + hash;
      const done = function (ok) {
        status.textContent = (ok ? 'Share link copied to the clipboard: ' : 'Share link ready: ') + link;
      };
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); });
        } else {
          done(false);
        }
      } catch (err) {
        done(false);
      }
    });

    $('lab-verify').addEventListener('click', function () {
      const status = $('lab-export-status');
      const report = lab.reportFor(state());
      const intact = lab.verifyReport(report.json);
      const demo = lab.tamperDemo(state());
      status.textContent = intact.ok
        ? 'Digest verified for the current state. The tamper demo then flipped one field and the check caught it: stamped '
          + demo.intactDigest.slice(0, 16) + ' versus recomputed ' + demo.tamperedDigest.slice(0, 16) + '.'
        : 'Digest mismatch on the current payload, the audit trail is doing its job by failing loudly.';
    });

    $('lab-run-tests').addEventListener('click', function () {
      const out = lab.selfTests();
      $('lab-tests-count').textContent = out.passed + ' of ' + out.total + ' deterministic checks passed.';
      const list = $('lab-tests-list');
      clear(list);
      for (const result of out.results) {
        const row = el('p', 'lab-test-row');
        const lamp = el('i', 'led ' + (result.ok ? 'led-ok' : 'led-fault'));
        lamp.setAttribute('aria-hidden', 'true');
        row.appendChild(lamp);
        row.appendChild(el('span', null, (result.ok ? 'Pass' : 'Fail') + ': ' + result.name
          + (result.ok ? '' : ' - ' + result.detail)));
        list.appendChild(row);
      }
    });

    /* A strict bookmark: only a well formed np= hash restores state, and only
       into the real controls so every panel recomputes through its own path. */
    function restoreFromHash() {
      if (typeof location === 'undefined' || !location || typeof location.hash !== 'string') { return; }
      const decoded = lab.decodeState(location.hash);
      if (!decoded) { return; }
      const countEl = $('drive-count');
      countEl.value = String(decoded.drives);
      fireEvent(countEl, 'input');
      const sizeEl = $('drive-size');
      const sizeValue = String(decoded.driveTb);
      sizeEl.value = sizeValue;
      if (sizeEl.value !== sizeValue) { sizeEl.value = '8'; }
      fireEvent(sizeEl, 'change');
      const speedEl = $('rebuild-speed');
      speedEl.value = String(decoded.rebuildMbps);
      fireEvent(speedEl, 'input');
      const ramEl = $('ram-budget');
      ramEl.value = String(decoded.ramGb);
      fireEvent(ramEl, 'input');
      const tokenEl = $('context-tokens');
      const tokenValue = String(decoded.tokens);
      tokenEl.value = tokenValue;
      if (tokenEl.value !== tokenValue) { tokenEl.value = '8192'; }
      fireEvent(tokenEl, 'change');
      berExp = decoded.berExp;
      const target = document.getElementById(decoded.panel);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView();
      }
    }

    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', restoreFromHash);
    }
    restoreFromHash();
    render();
  }

  /* ------------------------------- Page chrome ------------------------------ */

  function initReveal() {
    const targets = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (node) { node.classList.add('in'); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.1 });
    targets.forEach(function (node) { observer.observe(node); });
  }

  function safeInit(name, fn) {
    try {
      fn();
    } catch (err) {
      if (window.console && console.error) { console.error('NestPulse ' + name + ' failed:', err); }
      const slot = $('error-' + name);
      if (slot) {
        slot.hidden = false;
        slot.textContent = 'This panel hit an error while rendering. The rest of the page still works.';
      }
    }
  }

  safeInit('storage', initStorage);
  safeInit('models', initModels);
  safeInit('tidy', initTidy);
  safeInit('rules', initRules);
  safeInit('insights', initInsights);
  safeInit('resilience', initResilience);
  safeInit('reveal', initReveal);
})();
