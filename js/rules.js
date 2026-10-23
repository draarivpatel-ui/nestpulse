/* NestPulse Rule Forge: home automation rule conflict detection and dry runs.
   Shared by the browser UI (window.NestPulseRules) and the node:test suites (module.exports).
   Rules are lists of conditions (time windows, sensor thresholds, device states) ANDed
   together, plus actions. The detector compares every rule pair for contradictions,
   shadowing, and duplicate effects, and can verify predictions against synthetic logs. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseRules = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COMMANDS = ['on', 'off'];
  const OPS = ['>', '<', '==', '>=', '<='];
  const DAY_MINUTES = 1440;

  const SENSOR_CATALOG = {
    livingTemp: { label: 'Living room temperature', unit: 'C' },
    outdoorLux: { label: 'Outdoor light', unit: 'lux' },
    motionHall: { label: 'Hall motion', unit: 'flag' },
    humidity: { label: 'Indoor humidity', unit: '%' },
  };

  const DEVICE_CATALOG = {
    deskLamp: { label: 'Desk Lamp' },
    porchLight: { label: 'Porch Light' },
    hallLight: { label: 'Hall Light' },
    heater: { label: 'Heater' },
    fan: { label: 'Fan' },
    speaker: { label: 'Speaker' },
  };

  function parseTime(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text));
    if (!match) { return null; }
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) { return null; }
    return h * 60 + m;
  }

  /* A daily window as half open minute segments. Start equal to end is a zero length
     window (validation flags it); start after end wraps past midnight. */
  function windowSegments(cond) {
    const start = parseTime(cond.start);
    const end = parseTime(cond.end);
    if (start === null || end === null || start === end) { return []; }
    if (start < end) { return [[start, end]]; }
    return [[start, DAY_MINUTES], [0, end]];
  }

  function segmentsOverlap(a, b) {
    return Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
  }

  function windowsOverlap(condA, condB) {
    for (const segA of windowSegments(condA)) {
      for (const segB of windowSegments(condB)) {
        if (segmentsOverlap(segA, segB)) { return true; }
      }
    }
    return false;
  }

  function minuteInWindow(minutes, cond) {
    return windowSegments(cond).some(function (seg) {
      return minutes >= seg[0] && minutes < seg[1];
    });
  }

  /* AND several time conditions into one segment set. Empty input means "always". */
  function foldSegments(conds) {
    let segments = [[0, DAY_MINUTES]];
    for (const cond of conds) {
      const next = [];
      for (const outer of segments) {
        for (const inner of windowSegments(cond)) {
          const start = Math.max(outer[0], inner[0]);
          const end = Math.min(outer[1], inner[1]);
          if (start < end) { next.push([start, end]); }
        }
      }
      segments = next;
      if (segments.length === 0) { return []; }
    }
    return segments;
  }

  function intersectSegmentSets(setA, setB) {
    const out = [];
    for (const segA of setA) {
      for (const segB of setB) {
        if (segmentsOverlap(segA, segB)) { out.push(segA); }
      }
    }
    return out;
  }

  function sensorInterval(cond) {
    const v = cond.value;
    switch (cond.op) {
      case '>': return { lo: v, loClosed: false, hi: Infinity, hiClosed: false };
      case '>=': return { lo: v, loClosed: true, hi: Infinity, hiClosed: false };
      case '<': return { lo: -Infinity, loClosed: false, hi: v, hiClosed: false };
      case '<=': return { lo: -Infinity, loClosed: false, hi: v, hiClosed: true };
      case '==': return { lo: v, loClosed: true, hi: v, hiClosed: true };
      default: return null;
    }
  }

  function intervalContainsPoint(interval, p) {
    const loOk = interval.lo < p || (interval.lo === p && interval.loClosed);
    const hiOk = interval.hi > p || (interval.hi === p && interval.hiClosed);
    return loOk && hiOk;
  }

  function intervalsIntersect(a, b) {
    const lo = Math.max(a.lo, b.lo);
    const hi = Math.min(a.hi, b.hi);
    if (lo < hi) { return true; }
    if (lo === hi) { return intervalContainsPoint(a, lo) && intervalContainsPoint(b, lo); }
    return false;
  }

  function intervalContains(outer, inner) {
    const loOk = inner.lo > outer.lo
      || (inner.lo === outer.lo && (inner.loClosed ? outer.loClosed : true));
    const hiOk = inner.hi < outer.hi
      || (inner.hi === outer.hi && (inner.hiClosed ? outer.hiClosed : true));
    return loOk && hiOk;
  }

  function segmentsContain(outerSegs, innerSegs) {
    return innerSegs.every(function (inner) {
      return outerSegs.some(function (outer) {
        return outer[0] <= inner[0] && inner[1] <= outer[1];
      });
    });
  }

  /* True when condition a being satisfied forces condition b to be satisfied. */
  function conditionCovers(a, b) {
    if (a.type !== b.type) { return false; }
    if (a.type === 'time') {
      return segmentsContain(windowSegments(b), windowSegments(a));
    }
    if (a.type === 'sensor') {
      if (a.sensor !== b.sensor) { return false; }
      const ia = sensorInterval(a);
      const ib = sensorInterval(b);
      if (!ia || !ib) { return false; }
      return intervalContains(ib, ia);
    }
    if (a.type === 'device') {
      return a.device === b.device && a.state === b.state;
    }
    return false;
  }

  /* Rule A implies rule B when every condition of B is forced by some condition of A.
     Extra conditions in A only narrow it further. */
  function conditionsImply(ruleA, ruleB) {
    return ruleB.conditions.every(function (condB) {
      return ruleA.conditions.some(function (condA) {
        return conditionCovers(condA, condB);
      });
    });
  }

  function condsOf(rule, type) {
    return rule.conditions.filter(function (cond) { return cond.type === type; });
  }

  /* Can both rules be satisfied at the same moment? Checks time windows, sensor
     ranges, and required device states for contradictions. */
  function rulesCanCooccur(ruleA, ruleB) {
    const joint = intersectSegmentSets(
      foldSegments(condsOf(ruleA, 'time')),
      foldSegments(condsOf(ruleB, 'time'))
    );
    if (joint.length === 0) { return false; }

    const sensorNames = new Set();
    condsOf(ruleA, 'sensor').forEach(function (c) { sensorNames.add(c.sensor); });
    condsOf(ruleB, 'sensor').forEach(function (c) { sensorNames.add(c.sensor); });
    for (const sensor of sensorNames) {
      const conds = condsOf(ruleA, 'sensor').concat(condsOf(ruleB, 'sensor'))
        .filter(function (c) { return c.sensor === sensor; });
      let intervals = conds.map(sensorInterval);
      if (intervals.some(function (i) { return i === null; })) { continue; }
      let current = intervals[0];
      for (let k = 1; k < intervals.length; k += 1) {
        if (!intervalsIntersect(current, intervals[k])) { return false; }
        current = {
          lo: Math.max(current.lo, intervals[k].lo),
          loClosed: current.lo > intervals[k].lo ? current.loClosed
            : intervals[k].lo > current.lo ? intervals[k].loClosed
              : (current.loClosed && intervals[k].loClosed),
          hi: Math.min(current.hi, intervals[k].hi),
          hiClosed: current.hi < intervals[k].hi ? current.hiClosed
            : intervals[k].hi < current.hi ? intervals[k].hiClosed
              : (current.hiClosed && intervals[k].hiClosed),
        };
      }
    }

    const devicesA = {};
    condsOf(ruleA, 'device').forEach(function (c) { devicesA[c.device] = c.state; });
    for (const cond of condsOf(ruleB, 'device')) {
      if (Object.prototype.hasOwnProperty.call(devicesA, cond.device) && devicesA[cond.device] !== cond.state) {
        return false;
      }
    }
    return true;
  }

  function actionMap(rule) {
    const map = {};
    for (const action of rule.actions) {
      map[action.device] = action.command;
    }
    return map;
  }

  function actionsEqual(ruleA, ruleB) {
    const a = actionMap(ruleA);
    const b = actionMap(ruleB);
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) { return false; }
    return keysA.every(function (device) { return a[device] === b[device]; });
  }

  function sharedDevices(ruleA, ruleB) {
    const a = Object.keys(actionMap(ruleA));
    const b = new Set(Object.keys(actionMap(ruleB)));
    return a.filter(function (device) { return b.has(device); });
  }

  function impliesStrictly(ruleNarrow, ruleWide) {
    return ruleNarrow.conditions.length > ruleWide.conditions.length
      && conditionsImply(ruleNarrow, ruleWide);
  }

  function findConflicts(rules) {
    const conflicts = [];
    for (let i = 0; i < rules.length; i += 1) {
      for (let j = i + 1; j < rules.length; j += 1) {
        const ruleA = rules[i];
        const ruleB = rules[j];
        const cooccur = rulesCanCooccur(ruleA, ruleB);
        if (!cooccur) { continue; }
        if (actionsEqual(ruleA, ruleB)) {
          if (impliesStrictly(ruleA, ruleB)) {
            conflicts.push({
              kind: 'shadowed', ruleA: ruleA.id, ruleB: ruleB.id, device: null,
              message: '"' + ruleA.name + '" can only fire when "' + ruleB.name
                + '" also fires, so it adds nothing on its own.',
            });
          } else if (impliesStrictly(ruleB, ruleA)) {
            conflicts.push({
              kind: 'shadowed', ruleA: ruleB.id, ruleB: ruleA.id, device: null,
              message: '"' + ruleB.name + '" can only fire when "' + ruleA.name
                + '" also fires, so it adds nothing on its own.',
            });
          } else {
            conflicts.push({
              kind: 'duplicateEffect', ruleA: ruleA.id, ruleB: ruleB.id, device: null,
              message: '"' + ruleA.name + '" and "' + ruleB.name + '" perform the same actions under overlapping conditions, so the same command can fire twice.',
            });
          }
          continue;
        }
        for (const device of sharedDevices(ruleA, ruleB)) {
          const commandA = actionMap(ruleA)[device];
          const commandB = actionMap(ruleB)[device];
          const deviceLabel = DEVICE_CATALOG[device] ? DEVICE_CATALOG[device].label : device;
          if (commandA !== commandB) {
            conflicts.push({
              kind: 'contradiction', ruleA: ruleA.id, ruleB: ruleB.id, device: device,
              message: '"' + ruleA.name + '" and "' + ruleB.name + '" both set the ' + deviceLabel
                + ' with opposite commands and their conditions can be true at the same time.',
            });
          } else {
            conflicts.push({
              kind: 'duplicateEffect', ruleA: ruleA.id, ruleB: ruleB.id, device: device,
              message: '"' + ruleA.name + '" and "' + ruleB.name + '" both turn the ' + deviceLabel
                + ' ' + commandA + ' under overlapping conditions.',
            });
          }
        }
      }
    }
    return conflicts;
  }

  function describeCondition(cond) {
    if (cond.type === 'time') {
      const wraps = parseTime(cond.start) > parseTime(cond.end);
      return wraps
        ? 'Overnight from ' + cond.start + ' to ' + cond.end
        : 'Daily from ' + cond.start + ' to ' + cond.end;
    }
    if (cond.type === 'sensor') {
      const meta = SENSOR_CATALOG[cond.sensor];
      const label = meta ? meta.label : cond.sensor;
      const unit = meta ? meta.unit : '';
      if (unit === 'flag' && cond.op === '==') {
        return Number(cond.value) === 1 ? label + ' detected' : 'No ' + label.toLowerCase();
      }
      const opText = { '>': 'above', '<': 'below', '>=': 'at or above', '<=': 'at or below', '==': 'equal to' }[cond.op] || cond.op;
      return label + ' ' + opText + ' ' + cond.value + (unit && unit !== 'flag' ? ' ' + unit : '');
    }
    if (cond.type === 'device') {
      const meta = DEVICE_CATALOG[cond.device];
      return (meta ? meta.label : cond.device) + ' is ' + cond.state;
    }
    return 'Unknown condition';
  }

  function describeAction(action) {
    const meta = DEVICE_CATALOG[action.device];
    return 'Turn ' + (meta ? meta.label : action.device) + ' ' + action.command;
  }

  function validateRule(rule) {
    const issues = [];
    for (const cond of rule.conditions) {
      if (cond.type === 'time') {
        if (parseTime(cond.start) === null || parseTime(cond.end) === null) {
          issues.push({ ruleId: rule.id, message: '"' + rule.name + '" has a malformed time value in its window.' });
        } else if (cond.start === cond.end) {
          issues.push({ ruleId: rule.id, message: '"' + rule.name + '" has a time window that spans zero minutes.' });
        }
      } else if (cond.type === 'sensor') {
        if (!Object.prototype.hasOwnProperty.call(SENSOR_CATALOG, cond.sensor)) {
          issues.push({ ruleId: rule.id, message: '"' + rule.name + '" references the sensor "' + cond.sensor + '", which the demo logs do not track.' });
        }
        if (OPS.indexOf(cond.op) === -1) {
          issues.push({ ruleId: rule.id, message: '"' + rule.name + '" uses an unknown comparison operator on sensor "' + cond.sensor + '".' });
        }
      } else if (cond.type === 'device') {
        if (!Object.prototype.hasOwnProperty.call(DEVICE_CATALOG, cond.device)) {
          issues.push({ ruleId: rule.id, message: '"' + rule.name + '" references the device "' + cond.device + '", which is not in the device catalog.' });
        }
      }
    }
    for (const action of rule.actions) {
      if (!Object.prototype.hasOwnProperty.call(DEVICE_CATALOG, action.device)) {
        issues.push({ ruleId: rule.id, message: '"' + rule.name + '" controls the device "' + action.device + '", which is not in the device catalog.' });
      }
      if (COMMANDS.indexOf(action.command) === -1) {
        issues.push({ ruleId: rule.id, message: '"' + rule.name + '" uses the unknown command "' + action.command + '".' });
      }
    }
    return issues;
  }

  function timeOfLog(log) {
    return parseTime(String(log.t).slice(11, 16));
  }

  function compareValue(actual, op, expected) {
    switch (op) {
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '==': return actual === expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      default: return false;
    }
  }

  function ruleMatchesLog(rule, log) {
    return rule.conditions.every(function (cond) {
      if (cond.type === 'time') {
        const minutes = timeOfLog(log);
        return minutes !== null && minuteInWindow(minutes, cond);
      }
      if (cond.type === 'sensor') {
        const value = log[cond.sensor];
        return typeof value === 'number' && compareValue(value, cond.op, cond.value);
      }
      if (cond.type === 'device') {
        return Boolean(log.devices) && log.devices[cond.device] === cond.state;
      }
      return false;
    });
  }

  function ruleById(rules, id) {
    return rules.filter(function (rule) { return rule.id === id; })[0] || null;
  }

  /* Runs every rule against the synthetic logs and checks each predicted conflict
     against what the logs actually show. */
  function dryRun(rules, logs) {
    const fireSets = new Map();
    const reports = rules.map(function (rule) {
      const indexes = [];
      logs.forEach(function (log, index) {
        if (ruleMatchesLog(rule, log)) { indexes.push(index); }
      });
      fireSets.set(rule.id, indexes);
      return {
        ruleId: rule.id,
        name: rule.name,
        fires: indexes.length,
        exampleTimes: indexes.slice(0, 3).map(function (i) { return logs[i].t; }),
      };
    });

    const conflicts = findConflicts(rules);
    const pairs = conflicts.map(function (conflict) {
      if (conflict.kind === 'shadowed') {
        const narrow = ruleById(rules, conflict.ruleA);
        const wide = ruleById(rules, conflict.ruleB);
        const narrowFires = fireSets.get(conflict.ruleA);
        const wideFireSet = new Set(fireSets.get(conflict.ruleB));
        const narrowOnly = narrowFires.filter(function (i) { return !wideFireSet.has(i); }).length;
        return {
          kind: conflict.kind,
          ruleA: conflict.ruleA,
          ruleB: conflict.ruleB,
          device: conflict.device,
          message: conflict.message,
          narrowFires: narrowFires.length,
          wideFires: fireSets.get(conflict.ruleB).length,
          narrowOnlyFires: narrowOnly,
          fullyShadowed: narrowOnly === 0,
          observedLine: narrowOnly === 0
            ? 'On the demo logs, every hour "' + narrow.name + '" fired, "' + wide.name + '" also fired.'
            : 'On the demo logs, "' + narrow.name + '" fired ' + narrowOnly + ' time(s) without "' + wide.name + '" firing.',
        };
      }
      const setA = new Set(fireSets.get(conflict.ruleA));
      const shared = fireSets.get(conflict.ruleB).filter(function (i) { return setA.has(i); });
      return {
        kind: conflict.kind,
        ruleA: conflict.ruleA,
        ruleB: conflict.ruleB,
        device: conflict.device,
        message: conflict.message,
        coFires: shared.length,
        exampleTimes: shared.slice(0, 3).map(function (i) { return logs[i].t; }),
        observedLine: shared.length === 0
          ? 'Never actually co-fired in the demo logs.'
          : 'Co-fired ' + shared.length + ' time(s) in the demo logs, for example at '
            + shared.slice(0, 3).map(function (i) { return logs[i].t.replace('T', ' '); }).join(', ') + '.',
      };
    });

    const validation = [];
    for (const rule of rules) {
      for (const issue of validateRule(rule)) { validation.push(issue); }
    }

    return {
      logsCount: logs.length,
      reports: reports,
      conflicts: conflicts,
      pairs: pairs,
      validation: validation,
    };
  }

  return {
    COMMANDS: COMMANDS,
    OPS: OPS,
    SENSOR_CATALOG: SENSOR_CATALOG,
    DEVICE_CATALOG: DEVICE_CATALOG,
    parseTime: parseTime,
    windowSegments: windowSegments,
    windowsOverlap: windowsOverlap,
    minuteInWindow: minuteInWindow,
    sensorInterval: sensorInterval,
    intervalsIntersect: intervalsIntersect,
    intervalContains: intervalContains,
    conditionCovers: conditionCovers,
    conditionsImply: conditionsImply,
    rulesCanCooccur: rulesCanCooccur,
    actionsEqual: actionsEqual,
    findConflicts: findConflicts,
    validateRule: validateRule,
    ruleMatchesLog: ruleMatchesLog,
    dryRun: dryRun,
    describeCondition: describeCondition,
    describeAction: describeAction,
  };
});
