# NestPulse

A command center dashboard concept for a personal home NAS: five working
planners that run entirely in the browser, on a labeled demo dataset, with
zero dependencies and zero network calls.

NestPulse was built by Aariv Patel for the UGREEN Hackathon 2026, Automate Your
Workflow track. It is positioned as the browser UI for a self-hosted box. No
NAS hardware is connected, nothing is scanned on your machine, and no vendor
relationship is claimed.

## What is in the box

Five panels, each backed by a shared math module that the test suite exercises
directly:

**Storage Doctor.** Enter a drive count, a drive size, and a rebuild speed. All
five common levels (RAID 0, 1, 5, 6, 10) report usable space in both TB and
TiB, raw capacity, efficiency, fault tolerance, and a projected rebuild
window, with the arithmetic line spelled out. Warnings scale with the inputs,
for example large drives stretching RAID 5 rebuild windows.

**Memory Fit.** Enter a RAM or VRAM budget and a context length. Fourteen
illustrative catalog entries are checked against every quantization from Q2 K
to FP16. Each row shows the largest quantization that fits, the weight size,
the KV cache size, the total, and a verdict, and expands to show the full
arithmetic sentence and the whole quantization ladder.

**Tidy Plans.** A planner runs against a 57 item synthetic library manifest
with planted exact duplicates, burst sets, copy suffix patterns, and aging
screenshots. Proposals are ranked by confidence (identical hashes at 100
percent, bursts at 75, copy patterns at 65, aged screenshots at 45), and a
threshold slider moves items between the plan and the suppressed pile. Every
proposal lists the exact files it would keep and remove, and no file is ever
proposed for removal twice.

**Rule Forge.** Nine demo home automation rules are checked pairwise by a real
conflict detector: contradictions (opposite commands on the same device whose
conditions can both be true), shadowed rules (a narrower rule that only ever
fires alongside a wider one), duplicate effects, and validation notes for
sensors the logs do not track. A dry run then replays every rule against 72
hours of synthetic sensor logs and reports, per conflict, whether the
prediction ever actually happened.

**Cross-Panel Insights.** Four frontier searches over the same math modules:
the smallest drive count that reaches a target capacity at each RAID level and
drive size, the exact memory budget at which each catalog entry first fits,
the reclaimable bytes lost as cleanup confidence requirements increase, and
the connected groups of rules that clash together. The target capacity and
context length are interactive controls.

## Run it

Open `index.html` in any modern browser. There is no build step, no install,
and no server requirement; the folder deploys to GitHub Pages as is.

To run the test suite (Node 18 or newer, no packages to install):

```
npm test
```

or directly:

```
node --test tests/*.test.js
```

## How the math works

**Storage Doctor.** Usable bytes are `n * d` for RAID 0, `d` for RAID 1,
`(n - 1) * d` for RAID 5, `(n - 2) * d` for RAID 6, and `(n / 2) * d` for
RAID 10, where `n` is the drive count and `d` is one drive's bytes. TiB
figures divide by 2^40 so the gap between marketing TB and real TiB is
visible. Rebuild hours are one drive's bytes divided by `speed * 1e6 * 3600`,
multiplied by 1.25 for parity arrays (RAID 5 and 6) to account for parity
recomputation. The model assumes a single stream restoring one drive's worth
of data to one spare; it deliberately ignores vendor specific stripe tuning.

**Memory Fit.** Weight bytes are `params * 1e9 * bitsPerWeight / 8`. KV cache
bytes per token are `2 * layers * kvDim * 2` (the K and V tensors, fp16, per
layer). Total bytes add a flat 1.00 GB runtime overhead. A configuration fits
when the total is at most the budget; the verdict is comfortable at or under
80 percent utilization and tight above that. Max context is the largest whole
token count that still fits after weights and overhead are paid.

**Tidy Plans.** Exact duplicate groups come from shared content hashes, burst
groups from shared burst ids (three or more shots), copy patterns from
normalized file names that differ only by a `(1)` or `copy` suffix with
matching sizes but different hashes, and aged screenshots from the kind plus
the cutoff date. Each action keeps exactly one file, keeps and removes never
overlap across actions, and ranking is deterministic: confidence descending,
then bytes descending, then id.

**Rule Forge.** Two rules can co-occur when their time windows intersect
(overnight windows wrap past midnight), their sensor ranges intersect (open
and closed bounds handled, so `> 25` and `>= 25` can co-occur but `== 25` and
`> 25` cannot), and their required device states agree. A contradiction needs
opposite commands plus co-occurrence; a shadowed rule needs identical actions
plus a strictly narrower condition set; a duplicate effect needs the same
command plus co-occurrence. The dry run evaluates every rule per log row and
cross-checks each predicted conflict against the logs.

**Cross-Panel Insights.** The storage frontier calls `computeRaid` for each
level, drive size and drive count and takes the first count that reaches the
target. The memory frontier bisects the budget between the last failing grid
point and the first fitting one until the boundary is pinned to a thousandth
of a GB. The cleanup curve calls `planCleanup` at 15 thresholds and reports
the largest marginal byte loss. The conflict graph treats each predicted
conflict as an edge between two rule ids, builds connected components, and
ranks rules by a weighted severity (contradictions count 3, shadowed findings
2, duplicate effects 1).

## Data honesty

- Every dataset on the page is synthetic and labeled: the library manifest
  says `synthetic: true`, the sensor logs are generated by a fixed seed
  generator, and panels that use them carry a demo dataset chip.
- Catalog specs are illustrative planning values (parameter counts, layer
  counts, KV dimensions), not measured checkpoints. Quantization bits per
  weight are community standard approximations for Q2 K through Q8.
- The RAID rebuild model is a simplification, stated on the page, not a
  simulation of any specific controller.
- Nothing on the page represents a real NAS, a real purchase, or a
  relationship with any hardware vendor.

## Design and accessibility

- A hardware diagnostic bench direction: powder coated charcoal canvas,
  hairline rules, drive bay slot motifs, and a hero appliance panel with a
  live pulse trace.
- Status colors drawn from drive bay lamps and used only as semantic LEDs:
  mint for healthy, amber for attention, coral for fault. Bone is the single
  neutral instrument accent.
- System fonts only, with monospaced tabular numerals for every readout.
- Semantic HTML with landmarks, labeled controls, live regions for computed
  results, table captions, keyboard operable native controls, and visible
  focus rings.
- Scroll reveals and the hero pulse trace respect `prefers-reduced-motion`.
- No emoji icons, no all-caps labels, no em dashes or en dashes anywhere in
  the copy.

## Project layout

```
index.html            the whole app, static and dependency free
styles.css            the design system
js/raid.js            Storage Doctor math
js/models.js          Memory Fit math and catalog
js/tidy.js            Tidy Plans grouping, ranking, and planning
js/rules.js           Rule Forge conflict detection and dry runs
js/insights.js        frontier searches and conflict graph diagnostics
js/data-library.js    synthetic 57 item library manifest
js/data-rules.js      the nine demo rules
js/data-sensors.js    deterministic 72 hour synthetic sensor logs
js/app.js             panel rendering, no frameworks
tests/                math, invariant, regression, DOM and live UI suites
tests/helpers/dom.js  a zero dependency DOM shim that runs app.js
DEVPOST_UPGRADE.md    the upgrade log and exact verification commands
```

## Verification

`npm test` runs the math suites, the static page checks, the insights
frontier and graph tests, and live execution of `js/app.js` against a DOM
shim. Compliance tests walk every text file in the repository and reject two
dash characters, vendor model names and generated text disclosures. The
regression tests pin the 24 TB frontier, the exact memory thresholds, the
cleanup curve endpoints, and the largest conflict component.

## Author and license

Built by Aariv Patel. MIT licensed, see `LICENSE`.

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
