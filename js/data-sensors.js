/* NestPulse demo dataset: three days of hourly synthetic sensor logs for dry runs.
   A fixed seed linear congruential generator adds small jitter, so every run of this
   file produces the exact same 72 rows. No real sensor produced any of it. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseSensorLogs = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = ['2026-01-12', '2026-01-13', '2026-01-14'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function buildLogs() {
    let seed = 42;
    const rand = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const logs = [];
    for (const day of DAYS) {
      for (let h = 0; h < 24; h += 1) {
        const daylight = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
        const livingTemp = Math.round((18.5 + 9 * daylight + (rand() - 0.5) * 1.2) * 10) / 10;
        const humidity = Math.round((40 + 8 * Math.sin(((h - 3) / 12) * Math.PI) + (rand() - 0.5) * 4) * 10) / 10;
        const outdoorLux = (h >= 7 && h <= 18)
          ? Math.round(2500 + 6500 * Math.sin(((h - 7) / 12) * Math.PI))
          : Math.round(rand() * 2);
        const busyHour = (h >= 6 && h <= 9) || (h >= 17 && h <= 22);
        const motionHall = rand() < (busyHour ? 0.35 : 0.04) ? 1 : 0;
        logs.push({
          t: day + 'T' + pad2(h) + ':00',
          livingTemp: livingTemp,
          humidity: humidity,
          outdoorLux: outdoorLux,
          motionHall: motionHall,
          devices: {
            deskLamp: 'off',
            porchLight: 'off',
            hallLight: 'off',
            heater: 'off',
            fan: 'off',
            speaker: 'off',
          },
        });
      }
    }
    return logs;
  }

  return {
    synthetic: true,
    note: 'Synthetic demo sensor logs generated for NestPulse. No real sensor produced them.',
    buildLogs: buildLogs,
  };
});
