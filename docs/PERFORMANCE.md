# Performance, accessibility and practical limits

This is a learning application, not a universal benchmark. The current figures were measured on 2026-09-15 at `main` `9318ab5` on a Windows 11 laptop in Playwright Chromium, with other applications running; each table names its commit, date and method. Figures from different sessions are not directly comparable: the engine before AGL-1 measured 1,591 ms in its 2026-09-14 baseline run, while the remediation run on 2026-09-11 recorded 680 ms for the engine of that day, under different load, harness settings and intervening query changes. Compare before and after within one table. Machine load, development validation, browser, data distribution and filter complexity affect the result. No FPS guarantee is made.

## Measured observations

The independent [review](PERFORMANCE_REVIEW.md) sampled 10,000 live rows at 100 ms ticks, 1,000 changes per tick and burst enabled. It observed 21 rendered row elements, an input-rate sample of 17,995 events/second, and one 54 ms long task during a five-second interval. This checks that the grid virtualizes DOM rows; it is not a heap-leak or sustained-load proof. Metrics are sampled once per second and can lag the actual grid.

### Historical 500k sorting

The isolated 500,000-record ascending Value sort has been measured at each stage. Each row compares against a baseline from its own session.

| Date       | Revision                                   | Method                                  | Median                      |
| ---------- | ------------------------------------------ | --------------------------------------- | --------------------------- |
| 2026-09-11 | Initial implementation                     | Independent review, development server  | 4,208 ms (one isolated run) |
| 2026-09-11 | `b406f07` → remediation                    | Minified engine, three runs             | 4,599 → 680 ms              |
| 2026-09-14 | `d8032cd` → index-native engine (AGL-1 PR) | Minified engine, five runs per scenario | 1,591 → 129 ms              |
| 2026-09-15 | `9318ab5`                                  | Same harness, five runs per scenario    | 117 ms                      |

#### Index-native engine (AGL-1)

Run `node scripts/history-benchmark.mjs <label> [--entry <query.ts>] [--runs <n>]` from the repository root. It builds `query.ts` with Vite as a minified IIFE, loads it into a blank Playwright Chromium page and runs each scenario over the virtual 500,000 records, without grid rendering or network latency. `--entry` points the same harness at another revision's `query.ts`; the baseline was a `git worktree` of `d8032cd`, the last commit before AGL-1.

| Scenario (median of 5)                 | Before, `d8032cd` (2026-09-14) | AGL-1 PR (2026-09-14) | `9318ab5` (2026-09-15) |
| -------------------------------------- | ------------------------------ | --------------------- | ---------------------- |
| Value ascending                        | 1,591 ms (1,015–1,999)         | 129 ms (120–143)      | 117 ms (115–123)       |
| Timestamp ascending                    | 1,649 ms                       | 0 ms                  | 0 ms                   |
| Timestamp descending                   | 1,582 ms                       | 8 ms                  | 5 ms (4–12)            |
| `type = temperature`, Value descending | 1,277 ms                       | 33 ms                 | 25 ms (24–33)          |
| Cooperative yields, Value ascending    | 123–235                        | 13–16                 | 13                     |
| Abort signal → rejection (one sample)  | 0.5 ms                         | 0.5 ms                | 2.7 ms                 |

The owner's local targets were Value ≤ 120 ms and Timestamp ≤ 30 ms. The AGL-1 PR met the timestamp target and missed the Value target at 129 ms; the final run meets both. Between those two runs the engine's scan, key and merge loops did not change (AGL-8 only tightened which filter and sort models compile), so the 12 ms difference is run-to-run and load variance, not an optimisation. A CPU profile of the unminified Value sort during AGL-1 attributed about 112 ms of self time to the bottom-up merge: 19 passes and about 9.5 million merge outputs at about 12 ns each. The remaining cost is the comparison sort itself.

Preparation compiles each filter once against the seeded generator's field accessors and builds no telemetry records (`src/features/historical-logs/query.parity.test.ts` › "index-native preparation never materialises a full row while preparing"). Timestamps follow source order: an unfiltered ascending timestamp sort needs no index, a descending one is its reverse, and a lone date bound or range is an index interval rather than a per-row scan (› "the timestamp sort fast path skips keying and merging entirely", › "a lone timestamp range filter skips the per-row scan"). A filter or sort model outside the supported grammar rejects the query instead of matching more rows (› "unsupported query models fail closed instead of silently matching").

Hot loops run as synchronous chunks of 4,096 rows for scans and sort keys (`QUERY_CHUNK_ROWS`) and 65,536 outputs for the merge (`MERGE_CHUNK_OUTPUTS`). Between chunks the engine checks an 8 ms budget; once it is spent, the engine yields through a `MessageChannel` task, or a zero-delay timer where that API is missing, and closes the message ports afterwards. A chunk is never interrupted, so a task can run past the budget by up to one chunk's work: the budget is not a hard maximum task duration. Cancellation is checked before any work, after every yield, after the filter scan, after key extraction and after each merge pass.

Memory figures here are typed-array allocations read from the code, not measured peak heap. For an unfiltered 500,000-row Value sort the primary key `Float64Array` and its merge scratch take 4.0 MB each, and the two position arrays 2.0 MB each; one position array is returned as the 2.0 MB index (› "produces a full-length Uint32Array for an unfiltered value sort"). Each further sort key adds a 4.0 MB `Float64Array`. A filter first allocates 4 bytes per scanned row for matches and, when fewer rows match, copies them into an index of 4 bytes per match (› "sizes the index to the match count for a filter"); the temperature filter above keeps a 334,000-byte index. An unfiltered ascending timestamp sort allocates no index. The datasource drops a superseded query's index when the query changes, and garbage collection reclaims its arrays.

#### Remediation comparison (2026-09-11)

The remediation run built `query.ts` with Vite (minified IIFE), loaded it into a blank Chromium page and ran three 500,000-record ascending Value sorts, without network latency or grid rendering. Its baseline was `b406f07`.

| Metric (three runs)                       | Before                | After              |
| ----------------------------------------- | --------------------- | ------------------ |
| Wall time, ms                             | 4,153 / 4,765 / 4,599 | 690 / 680 / 631    |
| CDP task CPU time, ms                     | 970 / 1,518 / 1,387   | 725 / 713 / 665    |
| Cooperative yields                        | 711 / 711 / 711       | 83 / 82 / 77       |
| Maximum 16 ms timer drift, ms             | 7 / 31 / 11           | 17 / 17 / 9        |
| Abort signal to rejection, ms             | 4.7 / 4.3 / 4.4       | 0.6 / 0.1 / <0.1   |
| Abort request scheduling to rejection, ms | 25 / 28 / 25          | 34 / 33 / 33       |
| Sampled heap-used delta, MB               | 18.2 / 10.1 / 8.8     | 14.9 / 20.3 / 21.1 |
| Final typed index, MB                     | 2.0                   | 2.0                |

The median wall time fell from 4,599 to 680 ms (about 85%). CDP CPU and heap samples include a second query aborted after a nominal 20 ms timer; CPU is task time, not a profiler attribution to only the sort. Heap deltas are allocation/GC-sensitive samples, not retained-heap or peak-memory measurements. The algorithm retains the same index/scratch/scalar-key structure; the final index remains exactly 2,000,000 bytes. No heap-leak claim is made.

That remediation engine checked its 8 ms budget every 256 scan rows and 1,024 merge outputs; AGL-1 replaced that cadence with the chunks described above. A tested `scheduler.yield()` variant starved ordinary timer probes in the remediation harness and was discarded.

The benchmark now rejects unrelated errors, a query that resolves without cancellation, and an AbortError before the requested signal is aborted. Regression tests in `scripts/require-abort.test.mjs` protect this evidence check; three additional corrected-engine runs measured 671 / 669 / 682 ms with verified cancellation. A baseline rerun with the same stricter check also verified cancellation, but wall times varied from 6.5 to 11.2 seconds (still 711 yields), illustrating timer/scheduling sensitivity; the original comparison above is retained rather than selecting this slower baseline.

Raw runs are saved locally to ignored `.claude/runs/history-<label>.json`. A separate production-preview E2E verifies the complete grid sort workflow; its duration includes UI work and should not be compared directly with these isolated numbers.

Selective Community module registration reduced the production JavaScript from 1,370.96 kB / 389.92 kB gzip to 1,237.06 kB / 354.23 kB gzip (about 9% less gzip) at the time of that change. The budget baseline is the build of `main` at `85b046b`: `npm run check:bundle`, which gzips the JavaScript with zlib at its default level, measured 358,171 bytes, while Vite reported 1,261.47 kB / 361.44 kB gzip for the same file; the two gzip figures differ by method, not by build. The build at `9318ab5` (2026-09-15, after AGL-3 added the configuration store) measures 358,529 bytes, 0.10% above that baseline; Vite reports 1,261.99 kB / 361.80 kB gzip of JavaScript and 12.73 kB / 3.59 kB gzip of CSS. Both move with every dependency or module change, so read the command output rather than this paragraph for the number of the day. The initial screen uses the same grid library as the other screens, so splitting a vendor chunk alone would not reduce initial downloaded bytes. Screen lazy loading was considered but not added without evidence of further worthwhile savings. The size warning remains visible; no limit was raised to hide it. CI's quality job runs `npm run check:bundle` after the build, which fails when the built JavaScript's gzip size exceeds the baseline recorded in `scripts/bundle-budget.json` by more than 5%; moving the baseline means recording a new measured figure, not raising the tolerance.

### Live 10k reset

The first baseline reset of a paused 10,000-row fleet produced long tasks of 609 and 255 ms; warm repeats measured 108 and 84 ms. Reusing the seeded baseline and restoring only changed rows removed every observed task over the browser's 50 ms long-task threshold. Run `node scripts/live-benchmark.mjs` against a production preview on port 4175; each run reports wall time, including automation and two animation frames, and the long tasks it observed.

| Paused 10k reset, three runs         | Wall, ms       | Long tasks |
| ------------------------------------ | -------------- | ---------- |
| Remediation (2026-09-11)             | 119 / 126 / 79 | none       |
| Before AGL-2, `efbf934` (2026-09-14) | 134 / 108 / 82 | none       |
| AGL-2 PR (2026-09-14)                | 97 / 113 / 79  | none       |
| `9318ab5` (2026-09-15)               | 68 / 82 / 94   | none       |

Since AGL-2 a `TelemetrySource` owns the fleet and computes the reset diff from array positions; the grid is never asked for its rows (`src/features/live-telemetry/LiveTelemetry.test.tsx` › "never reads row data back from the grid: ticks, a burst, a same-size reset, and a resize"). Runs vary by tens of milliseconds within one session, so the table shows the absence of a regression, not a bound.

Reset and resize now submit at most 200 rows per operation type per transaction, waiting for each async batch before queuing the next. This trades total completion time for responsiveness: a heavily changed 10k fleet or resize can take several seconds. Reset controls show a pending state, streaming pauses its updates during the operation, and grid sorting/filtering still contributes work to each batch. The paused-reset figures do not guarantee a sub-200 ms task for every active/sorted workload. The 10k stress E2E checks reset completion after streaming and a subsequent resize to 1k.

### Live stream with a sorted view

The figures above describe an unsorted stream. Sorting changes the cost class. When the values that change on every tick also decide the row order — Reading sorted ascending while 1,000 readings per tick change — each 50 ms async batch must re-run the sort and reorder rows in the model, and the visible rows may be replaced rather than updated in place. Async transactions still coalesce the batch's work into one model pass, but they cannot remove the cost of keeping a continuously sorted view of 10,000 changing rows. Filtering on a changing value has the same shape.

Measured on 2026-09-14 with `node scripts/live-stream-benchmark.mjs` against the production preview (Windows 11, Playwright Chromium, 1440×1080, 10,000 devices, 100 ms tick, 1,000 changes per tick, burst enabled; the stream was paused, sorted, then restarted). Each row is one observation window; long tasks are the browser's `longtask` entries (> 50 ms) and drift is the worst lateness of a 16 ms timer.

| Window | View              | Long tasks | Longest, ms | Median, ms | Total, ms | Max timer drift, ms |
| ------ | ----------------- | ---------- | ----------- | ---------- | --------- | ------------------- |
| 10 s   | unsorted          | 0          | 0           | 0          | 0         | 21                  |
| 10 s   | sorted by Reading | 3          | 60          | 59         | 175       | 92                  |
| 15 s   | unsorted          | 0          | 0           | 0          | 0         | 26                  |
| 15 s   | sorted by Reading | 15         | 74          | 54         | 843       | 91                  |
| 15 s   | unsorted          | 0          | 0           | 0          | 0         | 15                  |
| 15 s   | sorted by Reading | 3          | 78          | 58         | 186       | 92                  |

A rerun on 2026-09-15 at `9318ab5`, one 10 s window per view, recorded no long task and 27 ms maximum drift unsorted, and 17 long tasks (longest 68 ms, median 55 ms, total 946 ms) with 95 ms maximum drift sorted by Reading.

This section exists because an external review of the same configuration reported materially longer tasks than the unsorted figures; that report is not part of this repository, so only the runs in the table are cited here. The long-task count already varies more than fivefold between windows on the same machine (3 to 15 in the table, 17 in the rerun), so treat the sorted rows as "tens of milliseconds per batch, repeatedly, with visible timer drift", not as a bound. These are single-machine observations: another CPU, a busier browser or a different value distribution moves every number. What does not move is the shape — unsorted streaming produced no long task in any window, sorted streaming produced them in every window. If a sorted live view is a product requirement, the options are a slower tick or fewer changes per tick, sorting on a value that changes rarely, or a coarser batch window; none of them is a code fix in this repository.

### Analytics sample aggregation

`node scripts/analytics-benchmark.mjs aggregate <label> [--root <checkout>] [--runs <n>]` times the aggregation the Analytics screen performs, as a minified IIFE in a blank Chromium page. `render <label> --url <preview> [--runs <n>]` marks a click on Analytics in a fresh production-preview page and measures until the summary grid shows a cell, which includes grid construction.

| Measurement                                         | Before AGL-6   | AGL-6 PR (2026-09-14) | `9318ab5` (2026-09-15) |
| --------------------------------------------------- | -------------- | --------------------- | ---------------------- |
| 10,000-record aggregation, first run / median of 20 | 25.3 / 11.2 ms | 4.8 / 0.9 ms          | 18.2 / 1.15 ms         |
| Click → first summary cell, first run / median of 7 | 72 / 82 ms     | 52 / 62 ms            | 54 / 63 ms             |

Before AGL-6 the screen built 10,000 telemetry records, summarised them and filtered them once per location; the aggregation baseline was `d8032cd`, and the render baseline a preview of `main` before that PR. The screen now makes one pass over sample indices through the generator's field accessors (`src/features/analytics/model.test.ts` › "never materialises a Telemetry record while preparing the 10,000-sample summary") and produces the same 24 groups and location alert rates. Medians of an even number of runs are the mean of the two middle samples (`scripts/median.test.mjs` › "averages the two middle samples of an even count"); the AGL-6 figures predate that and used the upper middle sample. The final first aggregation sample (18.2 ms) is a single cold measurement that varies between sessions; the medians agree with the AGL-6 run.

## Where work happens

| Surface                  | Allocation and update strategy                                                                                                                                                                          | Remaining cost                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live                     | One initial fleet; stable `getRowId`; fresh objects only for changed rows; `applyTransactionAsync` with 50 ms batches                                                                                   | Each batch may re-run sorting/filtering. A burst can affect the full 10,000-row fleet.                                                                                                     |
| History, default query   | Direct deterministic access by index; 200-row blocks; eight cached blocks; two concurrent requests                                                                                                      | Artificial network delay; row formatting/rendering. The grid cache is bounded, not all mock-server memory.                                                                                 |
| History, filtered/sorted | Filters compiled once over generator field accessors; `Uint32Array` match index; dense `Float64Array` sort keys; timestamp order and lone date ranges as index arithmetic; chunked bottom-up merge sort | O(N) scan and O(M log M) sort of M matches on the main thread, in chunks between yields; typed-array memory proportional to M. Only the requested 200-row block becomes telemetry objects. |
| Configuration            | A store owns the 100 draft rows, which accepted edits mutate in place, plus a separate saved baseline; its id indexes are rebuilt only when either array is replaced                                    | Each store change re-derives dirty rows in O(N). Do not scale this unchanged to hundreds of thousands of editable rows.                                                                    |
| Analytics                | One pass over 10,000 sample indices per mount through generator field accessors; 24 summary rows; small independent bar chart                                                                           | A bounded synchronous aggregation on entry. Not a full-history analytics query.                                                                                                            |

The historical mock yields according to the time budget described above. Superseded query generations are aborted. Concurrent requests for different blocks of the same query share computation and remain valid. Destroy clears pending delay timers, aborts indexing and settles each pending grid callback exactly once. Changing only latency preserves the query index and existing requests. This is materially different from dropping every response except the globally newest request.

## React and lifecycle decisions

`columnDefs`, `defaultColDef`, themes, row IDs and major object-valued grid props are stable constants or memoized values. Live ticks mutate only diagnostic refs and submit transactions; React state is updated once per second for counters. The status renderer returns a small React element and does no fetching, effects or expensive formatting. Formatters reuse `Intl` instances.

Live timers stop on unmount, and pending transactions are flushed. Each deferred transaction callback captures its own counter object, so it can count a paused stream's final batch without crediting a later reset. Callbacks only update that captured diagnostic object, never React state after unmount. Resetting data handles the counter sampling baseline, preventing negative event-rate readings. Live stream controls reset when leaving the screen; column/filter state is restored on return.

Configuration unmounts when you navigate away; the store the app shell owns keeps drafts and an in-progress save. It does not run a background stream. A save disables editing and mutation controls until completion, and the baseline only advances after success. Unmounting the app shell clears the save timer. The shell's `beforeunload` handler warns while dirty rows or staged deletions exist, whichever screen is open; no configuration rows are stored in localStorage.

Grid State serialization retains only view-related sections, caps input length and validates stored shapes. Storage writes are synchronous and errors are caught; a write is skipped when the serialized sections equal the text this screen last read or wrote, so scroll, focus and selection events do not rewrite localStorage. Serialization has no explicit output-size cap. Debounce persistence only if profiling shows a meaningful cost during resizing. Avoid storing row selection, scroll state and full row datasets unnecessarily.

## Accessibility corrections and validation

The independent review caught a CSS import-order defect that made the mobile sidebar and workspace sit beside each other. After moving responsive rules after base styles, a browser check reported document width equal to viewport width (390 px) for all four screens. The tables themselves scroll horizontally, preserving readable column widths.

Deletion cancellation now returns keyboard focus to **Delete selected**; confirmation moves it to **Add device**. Escape cancels the inline confirmation. It is not presented as a modal focus trap. Dark active-stream and eyebrow text have lighter overrides. Status badges contain words, not only color. Native controls have labels, a skip link and visible focus styles; the chart has a textual accessible description.

Live and Configuration set `ensureDomOrder`, so rows and columns sit in the DOM in the order they appear on screen, which is what text selection and copy follow. AG Grid 36.1 documents that the option disables row animations (`ensureDomOrder` in `gridOptions.d.ts`), so sorted or reordered rows move into place without animating. Its rendering cost was not measured separately; the live stream figures above include it.

Browser tests capture console errors, uncaught page errors and AG Grid warnings (`console.warn` messages prefixed `AG Grid:`) before navigation, so a restored filter the column cannot hold or a missing module fails the test that provoked it. Other browser warnings are deliberately not captured. The 500k sort test also records the main thread while the scan runs — the longest `longtask` (Firefox reports none) and the worst 16 ms timer drift — as a test annotation. It does not assert a bound: CI runners paint, collect garbage and share CPU on their own schedule, so a wall-clock bound fails on the machine rather than on the code. Until AGL-7 both were bounded at 250 ms. Cooperative yielding is gated deterministically instead: `src/features/historical-logs/query.parity.test.ts` › "yields at every key chunk and between merge chunks when each budget check is due" replaces the clock with one on which every budget check is due and asserts the exact number of yields for a 100,000-row sort; › "yields at every scan chunk of a filter when each budget check is due" does the same for a 50,000-row filter scan, and › "keeps each synchronous chunk small enough for the time budget to be checked often" bounds the chunk sizes those counts are computed from. This is not a complete WCAG or assistive-technology certification. Exact React render counts, sustained heap growth, screen-reader output, production CPU use and frame rates remain unmeasured.

## Next steps if the scope grows

1. A Web Worker was re-evaluated after AGL-1 and not added. The final 500k Value sort is 117 ms of main-thread work split by 13 yields, and timestamp queries take at most a few milliseconds. A worker would move that work off the main thread at the cost of a second bundle entry, transferring each index back and keeping cancellation in step across threads. Revisit it when a measured interaction stalls behind query work or query CPU grows, for example with larger histories or several sort keys; replacing the mock with a real Node.js query API remains the production answer.
2. Query a bounded time window on the backend; authorize and allow-list sort/filter fields, parameterize queries, impose limits, and use cursor pagination with a stable secondary key.
3. Profile before trimming modules, moving aggregation or changing cell renderers. Use React Profiler for component commits and browser Performance/Memory tools for main-thread and allocation behavior.
4. Add a sustained-load test that repeatedly changes queries and navigates between screens while observing settled heap size. The current E2E tests prove workflows, not absence of every possible leak.
