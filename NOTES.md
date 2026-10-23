# NestPulse build notes

## What was built

NestPulse is a static single page app for the UGREEN Hackathon 2026, Automate Your Workflow track: a command center dashboard concept for a personal AI NAS. It ships as `index.html` plus vanilla HTML, CSS, and JavaScript at the repo root, with zero dependencies and zero network calls, ready to drop onto GitHub Pages.

Four panels, all computed client side from shared math modules:

1. Storage Doctor: RAID 0, 1, 5, 6, and 10 capacity, efficiency, fault tolerance, and rebuild window calculators with drive count, drive size, and rebuild speed inputs, plus TB versus TiB honesty and per level warnings.
2. Model Fit: fourteen open weight models checked against every quantization (Q2 K through FP16) at a chosen RAM or VRAM budget and context length, with weights, KV cache, totals, verdicts, max context, and the full arithmetic shown per model.
3. Tidy Plans: a dedupe and cleanup planner over a labeled 57 item synthetic manifest, ranking exact hash duplicates, burst sets, copy suffix patterns, and aged screenshots by confidence with a live threshold slider, a keep newest toggle, and per proposal file lists.
4. Rule Forge: nine demo automation rules checked by a real pairwise conflict detector (contradictions, shadowed rules, duplicate effects, validation notes) with a dry run over 72 hours of deterministic synthetic sensor logs that reports observed co-firing per conflict.

Test suite: `node:test` under `tests/`, covering RAID math, model fit math, dedupe ranking, and rule conflict detection, plus static page checks (forbidden dash characters, id wiring, local assets only, syntax compilation, zero dependencies).

## Exact test results

Final run of `node --test tests/` on Node v26.8.1:

- Test files: 5 (raid, models, tidy, rules, ui)
- Tests: 79 passing, 0 failing, 0 skipped
- Assertion calls in the test sources: 244 (raid 51, models 47, tidy 51, rules 78, ui 17); loops in the suites execute many of them more than once, and every run is green
- Duration: about 0.05 seconds, no network

Per file: raid 17 tests, models 17 tests, tidy 18 tests, rules 21 tests, ui 6 tests.

Shipped demo outputs verified in the same run: the 57 item library plans 10 actions for 0.72 GB at the default 50 percent threshold with 3 proposals suppressed; the rule dry run predicts 4 conflicts (1 shadowed, 3 contradictions) and 1 validation note; 11 of 14 catalog models fit an 8 GB budget at 8192 tokens.

## Honest caveats

- No NAS is controlled and no files are scanned. The library manifest and sensor logs are synthetic and labeled, and the UI says demo dataset where relevant.
- Model catalog specs are planning approximations from public model cards, not measured checkpoints. KV cache math assumes fp16, two tensors per layer, and ignores sliding window and paged attention optimizations.
- The RAID rebuild estimate is a single stream model with a flat 1.25x parity penalty. Real controllers, queue depths, and stripe sizes will differ.
- The rule conflict detector covers contradiction, shadowing, duplicate effects, and reference validation. It does not model resource mutexes, notification spam, delayed triggers, or rules whose joint conditions are individually compatible but jointly empty.
- The page has no persistence: inputs reset on reload. There is no backend, account, or sync.
- The build ran fully offline with no browser verification; the DOM wiring was checked by static tests (id references, script compilation, asset existence) rather than a visual session.

## Devpost bullets

- Four working planners, one zero dependency page: RAID capacity and rebuild math, local model fitting, library cleanup planning, and automation rule conflict detection, all computed live in the browser with nothing phoning home.
- Show your work, everywhere: every panel prints its arithmetic, from the 4 x 8 TB parity line to the bits per weight and KV cache sentence behind each model verdict, so judges can check the numbers by hand.
- A rule conflict detector that admits what it cannot see: it predicts contradictions, shadowing, and duplicates from time windows, sensor ranges, and device states, then replays 72 hours of synthetic logs and reports which predicted clashes never actually happened.
- Honesty as a feature: a labeled synthetic library and log generator, TB versus TiB breakdowns, planning approximation notes on every model, and a demo dataset chip wherever synthetic data is used.
- Verified, not vibes: 79 node:test cases (244 assertion calls) across the four math engines plus static page checks, running in a twentieth of a second with zero installs and zero network.
