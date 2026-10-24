/* NestPulse browser app. Reads the shared math modules and renders the four modules
   as instrument panels on the diagnostic bench. Everything is client side; there are
   no network calls of any kind. */
(function () {
  'use strict';

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
        grid.appendChild(raidBay(level, result));
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
