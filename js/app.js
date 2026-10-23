/* NestPulse browser app. Reads the shared math modules and renders the four panels.
   Everything is client side; there are no network calls of any kind. */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  const LEVEL_ORDER = ['0', '1', '5', '6', '10'];
  const KIND_LABELS = { photo: 'Photos', screenshot: 'Screenshots', video: 'Videos', document: 'Documents' };
  const CONFLICT_LABELS = {
    contradiction: 'Contradiction',
    duplicateEffect: 'Duplicate effect',
    shadowed: 'Shadowed rule',
  };
  const CONFLICT_CLASS = {
    contradiction: 'chip-no',
    duplicateEffect: 'chip-info',
    shadowed: 'chip-warn',
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

  function fmtBytes(bytes) {
    if (!isFinite(bytes)) { return 'Not applicable'; }
    if (bytes >= 1e9) { return (bytes / 1e9).toFixed(2) + ' GB'; }
    if (bytes >= 1e6) { return (bytes / 1e6).toFixed(1) + ' MB'; }
    if (bytes >= 1e3) { return (bytes / 1e3).toFixed(1) + ' KB'; }
    return Math.round(bytes) + ' B';
  }

  function fmtHours(hours) {
    if (hours === null || hours === undefined || !isFinite(hours)) { return 'Not applicable'; }
    return hours >= 48 ? (hours / 24).toFixed(1) + ' days' : hours.toFixed(1) + ' hours';
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  /* ----------------------------- Storage Doctor ----------------------------- */

  function raidCard(level, result) {
    const card = el('article', 'card raid-card' + (result.ok ? '' : ' is-invalid'));
    const label = NestPulseRaid.LEVELS[level] ? NestPulseRaid.LEVELS[level].label : 'RAID ' + level;
    card.appendChild(el('h3', 'card-title', label));

    if (!result.ok) {
      card.appendChild(el('p', 'card-empty', result.error));
      return card;
    }

    const big = el('p', 'raid-usable');
    big.appendChild(el('span', 'num', result.usableTb.toFixed(1) + ' TB'));
    big.appendChild(el('span', 'sub', 'usable of ' + result.rawTb.toFixed(1) + ' TB raw'));
    card.appendChild(big);

    card.appendChild(el('p', 'arithmetic mono', result.drives + ' \u00d7 ' + result.driveTb
      + ' TB = ' + result.rawTb.toFixed(1) + ' TB raw, minus '
      + (result.redundancyDrives % 1 === 0 ? result.redundancyDrives : result.redundancyDrives.toFixed(1))
      + ' for redundancy = ' + result.usableTb.toFixed(1) + ' TB usable.'));

    const meta = el('dl', 'card-meta');
    const efficiency = Math.round(result.efficiency * 100) + '%';
    meta.appendChild(el('dt', null, 'Efficiency'));
    meta.appendChild(el('dd', null, efficiency));
    meta.appendChild(el('dt', null, 'Fault tolerance'));
    meta.appendChild(el('dd', null, result.guaranteedFaultTolerance === result.bestCaseFaultTolerance
      ? plural(result.guaranteedFaultTolerance, 'drive')
      : '1 guaranteed, up to ' + result.bestCaseFaultTolerance));
    meta.appendChild(el('dt', null, 'Rebuild'));
    meta.appendChild(el('dd', null, fmtHours(result.rebuildHours)));
    meta.appendChild(el('dt', null, 'Usable in TiB'));
    meta.appendChild(el('dd', null, result.usableTib.toFixed(2) + ' TiB'));
    card.appendChild(meta);

    const notes = el('ul', 'card-notes');
    for (const note of result.notes) {
      notes.appendChild(el('li', null, note));
    }
    card.appendChild(notes);
    return card;
  }

  function initStorage() {
    const render = function () {
      const drives = Math.round(Number($('drive-count').value));
      const driveTb = Number($('drive-size').value);
      const rebuildMbps = Number($('rebuild-speed').value);
      $('rebuild-speed-out').textContent = rebuildMbps + ' MB per second';
      $('storage-summary').textContent = 'Capacity math for ' + plural(drives, 'drive')
        + ' of ' + driveTb + ' TB each, with rebuilds at ' + rebuildMbps + ' MB per second.';
      const grid = $('raid-grid');
      clear(grid);
      for (const level of LEVEL_ORDER) {
        const result = NestPulseRaid.computeRaid({
          level: level,
          drives: drives,
          driveTb: driveTb,
          rebuildMbps: rebuildMbps,
        });
        grid.appendChild(raidCard(level, result));
      }
    };
    $('drive-count').addEventListener('input', render);
    $('drive-size').addEventListener('change', render);
    $('rebuild-speed').addEventListener('input', render);
    render();
  }

  /* -------------------------------- Model Fit ------------------------------- */

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
    row.appendChild(el('td', 'mono', fmtBytes(check.totalBytes)));

    const verdictCell = el('td', null);
    const verdictChipClass = !best ? 'chip-no'
      : check.verdict === 'comfortable' ? 'chip-ok'
        : check.verdict === 'tight' ? 'chip-tight' : 'chip-no';
    verdictCell.appendChild(el('span', 'chip ' + verdictChipClass,
      best ? (check.verdict === 'comfortable' ? 'Fits well' : 'Fits tight') : 'No fit'));
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
      body.appendChild(el('p', null, 'At ' + best.label + ' this budget holds up to '
        + maxTokens.toLocaleString('en-US') + ' tokens of context.'));
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
        + ' catalog models fit a ' + budgetGb + ' GB budget at ' + tokens.toLocaleString('en-US') + ' tokens.';
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

  function tidyCard(action) {
    const card = el('article', 'card tidy-card');
    const head = el('p', 'tidy-head');
    head.appendChild(el('span', 'chip ' + (action.confidence >= 0.9 ? 'chip-ok' : action.confidence >= 0.6 ? 'chip-info' : 'chip-warn'),
      Math.round(action.confidence * 100) + '% confident'));
    head.appendChild(el('span', 'tidy-class', NestPulseTidy.CLASS_LABELS[action.class]));
    head.appendChild(el('span', 'tidy-bytes mono', fmtBytes(action.bytes)));
    card.appendChild(head);
    card.appendChild(el('p', 'tidy-reason', action.reason));
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
    card.appendChild(details);
    return card;
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
        list.appendChild(tidyCard(action));
      }
    };
    $('tidy-confidence').addEventListener('input', render);
    $('screenshot-cutoff').addEventListener('change', render);
    $('keep-newest').addEventListener('change', render);
    render();
  }

  /* -------------------------------- Rule Forge ------------------------------ */

  function ruleCard(rule) {
    const card = el('article', 'card rule-card');
    card.appendChild(el('h4', 'card-title', rule.name));
    const conditions = el('ul', 'chip-row');
    conditions.setAttribute('aria-label', 'Conditions for ' + rule.name);
    for (const cond of rule.conditions) {
      conditions.appendChild(el('li', 'chip chip-quiet', NestPulseRules.describeCondition(cond)));
    }
    card.appendChild(conditions);
    const actions = el('ul', 'chip-row');
    actions.setAttribute('aria-label', 'Actions for ' + rule.name);
    for (const action of rule.actions) {
      actions.appendChild(el('li', 'chip chip-action', NestPulseRules.describeAction(action)));
    }
    card.appendChild(actions);
    return card;
  }

  function renderConflicts(pairs) {
    const list = $('conflicts-list');
    clear(list);
    if (pairs.length === 0) {
      list.appendChild(el('p', 'card-empty', 'No potential conflicts found among these rules.'));
      return;
    }
    for (const pair of pairs) {
      const card = el('article', 'card conflict-card');
      const head = el('p', 'tidy-head');
      head.appendChild(el('span', 'chip ' + (CONFLICT_CLASS[pair.kind] || 'chip-warn'),
        CONFLICT_LABELS[pair.kind] || pair.kind));
      card.appendChild(head);
      card.appendChild(el('p', 'tidy-reason', pair.message));
      if (pair.observedLine) {
        card.appendChild(el('p', 'observed mono', pair.observedLine));
      }
      list.appendChild(card);
    }
  }

  function renderValidation(issues) {
    const list = $('validation-list');
    clear(list);
    if (issues.length === 0) {
      list.appendChild(el('p', 'card-empty', 'No validation notes. Every rule references known sensors and devices.'));
      return;
    }
    for (const issue of issues) {
      list.appendChild(el('p', 'validation-note', issue.message));
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
      list.appendChild(ruleCard(rule));
    }

    const render = function () {
      const result = NestPulseRules.dryRun(rules, logs);
      const totalFires = result.reports.reduce((total, report) => total + report.fires, 0);
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
  safeInit('reveal', initReveal);
})();
