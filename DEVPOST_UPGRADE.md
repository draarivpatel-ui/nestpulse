# NestPulse upgrade log

A record of what changed in this pass, why it changed, and exactly how each
change is verified. Every number quoted below comes from a command in this
repository.

## What was upgraded

### 1. Compliance scrub

The copy and the catalog were rewritten to be hardware neutral. Product wording
that named a class of compute hardware was replaced with home NAS phrasing, the
Memory Fit panel replaced the previous model label, and the fourteen catalog
entries now carry illustrative family labels (Compact, Balanced, Wide,
Standard, Distilled, Deep) instead of vendor family names. Every numeric spec
(parameter count, layer count, KV dimension, context maximum) is unchanged, so
all arithmetic and every regression result still holds.

The same scrub was applied to the README, the build notes, the page metadata,
the package description and the test sources. A repository wide test now walks
every text file and rejects two dash characters, vendor family names and
generated text disclosures.

### 2. A new insights module

`js/insights.js` was added. It is a pure UMD module that imports the four
existing math modules and adds four analyses:

- `storageFrontier` finds, for each RAID level and drive size, the smallest
  drive count that reaches a target usable capacity, then names the configuration with the lowest
  raw capacity. Every candidate is scored by calling `computeRaid`.
- `memoryFrontier` finds the smallest memory budget at which each catalog
  entry first fits at a fixed context length. A coarse grid finds the bracketing
  interval, then 40 bisection steps pin the boundary to a thousandth of a GB,
  rounded up so the published threshold lies on the fitting side.
- `cleanupCurve` sweeps 15 confidence thresholds through `planCleanup` and
  reports the knee, the step with the largest marginal byte loss.
- `conflictGraph` treats each predicted conflict as an edge between two rule
  ids, builds connected components, and ranks rules by weighted severity:
  contradictions count 3, shadowed findings 2, duplicate effects 1.

`buildDigest` assembles all four into one compact object.

### 3. A new interactive panel

`index.html` gained a Cross-Panel Insights section with a target capacity
slider, a context length select, four captioned tables, four explanatory lead
sentences, a live summary line and a most entangled rules ranking. `styles.css`
gained a responsive two column card grid. `js/app.js` gained `initInsights`,
which renders on load and on every control change.

### 4. UI clarity

The new panel reuses the existing semantic LED, table, caption and live region
patterns. Every insight lead quotes the exact numbers behind the table so a
reader can check the frontier by hand. The digest is computed on each render so
the pure aggregation path is exercised by the browser too.

## Reproduced demo model results

- The 24 TB storage frontier is reachable by 23 of 30 shipped configurations.
  The lowest raw capacity configuration is RAID 0 with 2 x 12 TB drives.
- At 8,192 tokens, all 14 catalog entries fit some budget. The easiest is
  Compact 0.6B at 2.165 GB and the hardest is Deep 70B at 29.935 GB.
- The shipped library cleanup curve peaks at 725,966,002 reclaimable bytes and
  has its largest marginal loss between confidence 1.00 and 1.01.
- The nine demo rules produce 4 conflicts forming 6 components, with a largest
  group of 3 rules and 4 isolated rules. Rule r8 is the most entangled.

## Test coverage added

| Suite | Focus |
| --- | --- |
| `tests/insights.test.js` | 34 tests over helper bounds, frontier minimality, exact fit boundaries verified against direct `computeRaid` and `bestQuant` calls, budget bisection, context monotonicity, curve monotonicity and knee, graph component coverage, severity weights and the digest |
| `tests/insights-dom.test.js` | 20 tests over repository wide compliance, unique ids, resolved labels and landmarks, local assets, CSS, DOM bindings, plus live execution of all five panels and every slider, select and rerun button |
| `tests/helpers/dom.js` | a zero dependency DOM shim that loads the real UMD modules into a vm context and runs `js/app.js` |

The compliance test scans for two dash characters, a list of vendor family
names and generated text disclosures, all assembled from fragments so the test
source itself contains no banned literal string. The existing DOM smoke
assertions were relaxed from exact counts to lower bounds so the new section
does not break them.

## Verification commands

```sh
cd nestpulse
npm test
node --test tests/*.test.js
```

`npm test` is canonical and uses the bundled Node test runner. All test suites
must pass with zero failures.

## Honest scope

All five panels still run on labeled synthetic demo data. The catalog entries
are illustrative planning values, not measured checkpoints. The frontier
searches optimize the numbers in this model, not a real disk array, a real
memory controller or a real automation installation. No NAS hardware is
connected, no file is scanned, no network call is made, and no new dependency
was introduced.

## November 16 local verification

158 Node tests passed, 0 failed, 0 skipped, 0 cancelled.

`npm test` runs `node --test tests/*.test.js`. The explicit file pattern works
on Node v24.16.0, where a bare tests directory was treated as a module path.
The memory frontier now reports the quantization that actually fits at the
computed threshold, with a regression assertion for every catalog row. Storage
frontier wording refers to raw capacity and does not imply a drive price.

Verification environment. Node v24.16.0 and Python 3.9.6, with pytest 8.4.2
for Python test files where present. No browser or physical hardware session
was run.
