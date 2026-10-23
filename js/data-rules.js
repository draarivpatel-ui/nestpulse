/* NestPulse demo dataset: nine home automation rules for the Rule Forge panel.
   The set deliberately includes an adjacent pair that never clashes, a shadowed rule,
   two contradictions, and one rule referencing a sensor the logs do not track. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseRuleSet = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const rules = [
    {
      id: 'r1',
      name: 'Evening Porch Light',
      conditions: [
        { type: 'time', start: '18:30', end: '23:00' },
      ],
      actions: [{ device: 'porchLight', command: 'on' }],
    },
    {
      id: 'r2',
      name: 'Night Porch Shutdown',
      conditions: [
        { type: 'time', start: '23:00', end: '06:00' },
      ],
      actions: [{ device: 'porchLight', command: 'off' }],
    },
    {
      id: 'r3',
      name: 'Warm Room Fan',
      conditions: [
        { type: 'sensor', sensor: 'livingTemp', op: '>', value: 25 },
        { type: 'time', start: '10:00', end: '18:00' },
      ],
      actions: [{ device: 'fan', command: 'on' }],
    },
    {
      id: 'r4',
      name: 'Cool Evening Heater',
      conditions: [
        { type: 'sensor', sensor: 'livingTemp', op: '<', value: 20 },
        { type: 'time', start: '20:00', end: '23:00' },
      ],
      actions: [{ device: 'heater', command: 'on' }],
    },
    {
      id: 'r5',
      name: 'Warm Room Airflow',
      conditions: [
        { type: 'sensor', sensor: 'livingTemp', op: '>', value: 21 },
      ],
      actions: [{ device: 'fan', command: 'on' }],
    },
    {
      id: 'r6',
      name: 'Night Hall Light',
      conditions: [
        { type: 'sensor', sensor: 'motionHall', op: '==', value: 1 },
        { type: 'sensor', sensor: 'outdoorLux', op: '<', value: 30 },
      ],
      actions: [{ device: 'hallLight', command: 'on' }],
    },
    {
      id: 'r7',
      name: 'Daytime Hall Light Guard',
      conditions: [
        { type: 'time', start: '08:00', end: '18:00' },
      ],
      actions: [{ device: 'hallLight', command: 'off' }],
    },
    {
      id: 'r8',
      name: 'Afternoon Quiet Fan',
      conditions: [
        { type: 'time', start: '14:00', end: '16:00' },
      ],
      actions: [{ device: 'fan', command: 'off' }],
    },
    {
      id: 'r9',
      name: 'Air Quality Speaker Alert',
      conditions: [
        { type: 'sensor', sensor: 'co2Ppm', op: '>', value: 1200 },
      ],
      actions: [{ device: 'speaker', command: 'on' }],
    },
  ];

  return { rules: rules };
});
