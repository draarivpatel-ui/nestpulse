/* NestPulse Storage Doctor math: RAID capacity, efficiency, and rebuild estimates.
   Shared by the browser UI (window.NestPulseRaid) and the node:test suites (module.exports). */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseRaid = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TB = 1e12;
  const TIB = 1099511627776; // 2^40, so a "1 TB" drive shows its real TiB size.

  const LEVELS = {
    '0': { id: '0', label: 'RAID 0', minDrives: 2, needsEvenDrives: false, guaranteedFaultTolerance: 0 },
    '1': { id: '1', label: 'RAID 1', minDrives: 2, needsEvenDrives: false, guaranteedFaultTolerance: null },
    '5': { id: '5', label: 'RAID 5', minDrives: 3, needsEvenDrives: false, guaranteedFaultTolerance: 1 },
    '6': { id: '6', label: 'RAID 6', minDrives: 4, needsEvenDrives: false, guaranteedFaultTolerance: 2 },
    '10': { id: '10', label: 'RAID 10', minDrives: 4, needsEvenDrives: true, guaranteedFaultTolerance: 1 },
  };

  function usableBytesFor(level, drives, bytesPerDrive) {
    switch (level) {
      case '0': return drives * bytesPerDrive;
      case '1': return bytesPerDrive;
      case '5': return (drives - 1) * bytesPerDrive;
      case '6': return (drives - 2) * bytesPerDrive;
      case '10': return (drives / 2) * bytesPerDrive;
      default: return null;
    }
  }

  function bestCaseFaultTolerance(level, drives) {
    switch (level) {
      case '0': return 0;
      case '1': return drives - 1;
      case '5': return 1;
      case '6': return 2;
      case '10': return Math.floor(drives / 2);
      default: return 0;
    }
  }

  function levelNotes(level, drives, driveTb) {
    switch (level) {
      case '0':
        return ['No redundancy. Any single drive failure loses everything on the array.'];
      case '1':
        return drives === 2
          ? ['A classic two drive mirror. Recovery is a straight copy.']
          : ['A multi drive mirror. Data survives until only one copy is left.'];
      case '5':
        return driveTb >= 10
          ? ['Large drives stretch the rebuild window. RAID 6 adds a second parity drive for safety.']
          : ['One drive can fail and the array stays online while the spare rebuilds.'];
      case '6':
        return ['Two drives can fail at once and the array keeps running.'];
      case '10':
        return ['Each mirrored pair tolerates one failed drive without data loss.'];
      default:
        return [];
    }
  }

  /* options: { level, drives, driveTb, rebuildMbps }
     Returns a plain result object with every number the UI needs, or { ok: false, error }. */
  function computeRaid(options) {
    const level = String(options.level);
    const drives = Math.floor(Number(options.drives));
    const driveTb = Number(options.driveTb);
    const rebuildMbps = options.rebuildMbps === undefined ? 0 : Number(options.rebuildMbps);

    if (!Object.prototype.hasOwnProperty.call(LEVELS, level)) {
      return { ok: false, error: 'Unknown RAID level ' + level + '.' };
    }
    if (!Number.isFinite(drives) || drives < 1) {
      return { ok: false, error: 'Drive count must be a positive whole number.' };
    }
    if (!Number.isFinite(driveTb) || driveTb <= 0) {
      return { ok: false, error: 'Drive size must be greater than zero.' };
    }
    const meta = LEVELS[level];
    if (drives < meta.minDrives) {
      return { ok: false, error: meta.label + ' needs at least ' + meta.minDrives + ' drives.' };
    }
    if (meta.needsEvenDrives && drives % 2 !== 0) {
      return { ok: false, error: meta.label + ' needs an even number of drives.' };
    }

    const bytesPerDrive = driveTb * TB;
    const rawBytes = bytesPerDrive * drives;
    const usableBytes = usableBytesFor(level, drives, bytesPerDrive);
    const redundancyDrives = drives - usableBytes / bytesPerDrive;
    const efficiency = usableBytes / rawBytes;
    const bestCase = bestCaseFaultTolerance(level, drives);
    const guaranteed = meta.guaranteedFaultTolerance === null ? bestCase : meta.guaranteedFaultTolerance;

    /* Rebuild model: one stream restores a single drive's worth of bytes at the spare's
       write speed, with a 1.25x penalty on parity arrays for parity recomputation.
       It deliberately ignores vendor specific stripe tuning. */
    let rebuildHours = null;
    if (level !== '0' && Number.isFinite(rebuildMbps) && rebuildMbps > 0) {
      const bytesPerHour = rebuildMbps * 1e6 * 3600;
      const parityPenalty = (level === '5' || level === '6') ? 1.25 : 1;
      rebuildHours = (bytesPerDrive / bytesPerHour) * parityPenalty;
    }

    const notes = levelNotes(level, drives, driveTb).slice();
    if (rebuildHours !== null) {
      notes.push(rebuildHours >= 48
        ? 'A full rebuild is projected to take about ' + (rebuildHours / 24).toFixed(1) + ' days.'
        : 'A full rebuild is projected to take about ' + rebuildHours.toFixed(1) + ' hours.');
    }
    if (level === '0') {
      notes.push('No rebuild happens after a failure because there is nothing to rebuild from.');
    }

    return {
      ok: true,
      level: level,
      label: meta.label,
      drives: drives,
      driveTb: driveTb,
      bytesPerDrive: bytesPerDrive,
      rawBytes: rawBytes,
      rawTb: rawBytes / TB,
      usableBytes: usableBytes,
      usableTb: usableBytes / TB,
      usableTib: usableBytes / TIB,
      redundancyDrives: redundancyDrives,
      efficiency: efficiency,
      guaranteedFaultTolerance: guaranteed,
      bestCaseFaultTolerance: bestCase,
      rebuildHours: rebuildHours,
      notes: notes,
    };
  }

  return {
    TB: TB,
    TIB: TIB,
    LEVELS: LEVELS,
    computeRaid: computeRaid,
    usableBytesFor: usableBytesFor,
    bestCaseFaultTolerance: bestCaseFaultTolerance,
  };
});
