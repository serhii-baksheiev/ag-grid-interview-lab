# Performance, accessibility and practical limits

This is a learning application, not a universal benchmark. The historical remediation measurements below use an isolated, production-minified query engine in Playwright Chromium on 2026-09-11. Earlier live observations explicitly identify their own scope. Machine load, development validation, browser, data distribution and filter complexity affect the result. No FPS guarantee is made.

## Measured observations

The independent [review](PERFORMANCE_REVIEW.md) sampled 10,000 live rows at 100 ms ticks, 1,000 changes per tick and burst enabled. It observed 21 rendered row elements, an input-rate sample of 17,995 events/second, and one 54 ms long task during a five-second interval. This checks that the grid virtualizes DOM rows; it is not a heap-leak or sustained-load proof. Metrics are sampled once per second and can lag the actual grid.

### Historical 500k sorting: remediation comparison

Run `node scripts/history-benchmark.mjs <label>` from the repository root. It builds `query.ts` with Vite (minified IIFE), loads it into a blank Chromium page, then runs three 500,000-record ascending Value sorts. No network latency or grid rendering is included. Baseline is `b406f07`; measurements are local observations, not a browser-independent guarantee.

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

Work yields after an 8 ms budget, checked every 256 scan rows and 1,024 merge outputs. `MessageChannel` tasks avoid nested timer clamping; environments without that API use a timer with the same time budget. A tested `scheduler.yield()` variant starved ordinary timer probes in this harness and was discarded. Message ports close after each yield. Cancellation checks occur after each yield and each merge pass. Input responsiveness remains subject to browser scheduling and GC; the budget is not a hard maximum task duration.

The benchmark now rejects unrelated errors, a query that resolves without cancellation, and an AbortError before the requested signal is aborted. Four regression tests protect this evidence check; three additional corrected-engine runs measured 671 / 669 / 682 ms with verified cancellation. A baseline rerun with the same stricter check also verified cancellation, but wall times varied from 6.5 to 11.2 seconds (still 711 yields), illustrating timer/scheduling sensitivity; the original comparison above is retained rather than selecting this slower baseline.

Raw runs are saved locally to ignored `.claude/runs/history-<label>.json`. A separate production-preview E2E verifies the complete grid sort workflow; its duration includes UI work and should not be compared directly with these isolated numbers.

Selective Community module registration reduced the production JavaScript from 1,370.96 kB / 389.92 kB gzip to 1,237.06 kB / 354.23 kB gzip (about 9% less gzip) at the time of that change. The current build (2026-09-14, with `DateFilterModule` registered for the historical timestamp filter and `EventApiModule` for the column-visibility listener) emits 1,255.12 kB / 359.09 kB gzip of JavaScript and 12.73 kB / 3.59 kB gzip of CSS; the figure moves with every dependency or module change, so read `npm run build` output rather than this paragraph for the number of the day. The initial screen uses the same grid library as the other screens, so splitting a vendor chunk alone would not reduce initial downloaded bytes. Screen lazy loading was considered but not added without evidence of further worthwhile savings. The size warning remains visible; no limit was raised to hide it. CI's quality job runs `npm run check:bundle` after the build, which fails when the built JavaScript's gzip size exceeds the baseline recorded in `scripts/bundle-budget.json` by more than 5%; moving the baseline means recording a new measured figure, not raising the tolerance.

### Live 10k reset

The first baseline reset of a paused 10,000-row fleet produced long tasks of 609 and 255 ms; warm repeats measured 108 and 84 ms. After reusing the seeded baseline and restoring only changed rows, three paused resets produced no observed tasks over the browser's 50 ms long-task threshold (wall 119 / 126 / 79 ms, including automation and paints). Run `node scripts/live-benchmark.mjs` with production preview on port 4175.

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

This section exists because an external review of the same configuration reported materially longer tasks than the unsorted figures; that report is not part of this repository, so only the runs in the table are cited here. The long-task count already varies fivefold between windows on the same machine (3 to 15 above), so treat the sorted rows as "tens of milliseconds per batch, repeatedly, with visible timer drift", not as a bound. These are single-machine observations: another CPU, a busier browser or a different value distribution moves every number. What does not move is the shape — unsorted streaming produced no long task in any window, sorted streaming produced them in every window. If a sorted live view is a product requirement, the options are a slower tick or fewer changes per tick, sorting on a value that changes rarely, or a coarser batch window; none of them is a code fix in this repository.

## Where work happens

| Surface                  | Allocation and update strategy                                                                                        | Remaining cost                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Live                     | One initial fleet; stable `getRowId`; fresh objects only for changed rows; `applyTransactionAsync` with 50 ms batches | Each batch may re-run sorting/filtering. A burst can affect the full 10,000-row fleet.                                              |
| History, default query   | Direct deterministic access by index; 200-row blocks; eight cached blocks; two concurrent requests                    | Artificial network delay; row formatting/rendering. The grid cache is bounded, not all mock-server memory.                          |
| History, filtered/sorted | One shared index promise per query; `Uint32Array` indices; temporary scalar sort keys; cooperative merge sort         | O(N) scan and O(N log N) sort; index and keys consume memory proportional to N. Transient row objects are generated while scanning. |
| Configuration            | Small 100-device fleet; stable editable row array; separate saved baseline and dirty metadata                         | Dirty/deletion detection includes nested lookups. Do not scale this unchanged to hundreds of thousands of editable rows.            |
| Analytics                | One deterministic 10,000-reading sample per mount; 24 summary rows; small independent bar chart                       | A bounded synchronous sample aggregation on entry. Not a full-history analytics query.                                              |

The historical mock yields according to the time budget described above. Superseded query generations are aborted. Concurrent requests for different blocks of the same query share computation and remain valid. Destroy clears pending delay timers, aborts indexing and settles each pending grid callback exactly once. Changing only latency preserves the query index and existing requests. This is materially different from dropping every response except the globally newest request.

## React and lifecycle decisions

`columnDefs`, `defaultColDef`, themes, row IDs and major object-valued grid props are stable constants or memoized values. Live ticks mutate only diagnostic refs and submit transactions; React state is updated once per second for counters. The status renderer returns a small React element and does no fetching, effects or expensive formatting. Formatters reuse `Intl` instances.

Live timers stop on unmount, and pending transactions are flushed. Each deferred transaction callback captures its own counter object, so it can count a paused stream's final batch without crediting a later reset. Callbacks only update that captured diagnostic object, never React state after unmount. Resetting data handles the counter sampling baseline, preventing negative event-rate readings. Live stream controls reset when leaving the screen; column/filter state is restored on return.

Configuration stays mounted after the first visit so drafts and an in-progress save survive navigation. It does not run a background stream. A save disables editing and mutation controls until completion, and the baseline only advances after success. Unmount clears its save timer. A `beforeunload` handler warns while dirty rows exist; no configuration rows are stored in localStorage.

Grid State serialization retains only view-related sections, caps input length and validates stored shapes. Storage writes are synchronous and errors are caught; a write is skipped when the serialized sections equal the text this screen last read or wrote, so scroll, focus and selection events do not rewrite localStorage. Serialization has no explicit output-size cap. Debounce persistence only if profiling shows a meaningful cost during resizing. Avoid storing row selection, scroll state and full row datasets unnecessarily.

## Accessibility corrections and validation

The independent review caught a CSS import-order defect that made the mobile sidebar and workspace sit beside each other. After moving responsive rules after base styles, a browser check reported document width equal to viewport width (390 px) for all four screens. The tables themselves scroll horizontally, preserving readable column widths.

Deletion cancellation now returns keyboard focus to **Delete selected**; confirmation moves it to **Add device**. Escape cancels the inline confirmation. It is not presented as a modal focus trap. Dark active-stream and eyebrow text have lighter overrides. Status badges contain words, not only color. Native controls have labels, a skip link and visible focus styles; the chart has a textual accessible description.

Browser tests capture console errors, uncaught page errors and AG Grid warnings (`console.warn` messages prefixed `AG Grid:`) before navigation, so a restored filter the column cannot hold or a missing module fails the test that provoked it. Other browser warnings are deliberately not captured. The 500k sort test also measures the main thread while the scan runs — the longest `longtask` and the worst 16 ms timer drift — and bounds both at 250 ms. That bound is a regression tripwire for an unyielding scan (seconds), not a frame-rate target: CI runners paint and collect garbage on their own schedule, and a tighter bound would fail on noise rather than on code. This is not a complete WCAG or assistive-technology certification. Exact React render counts, sustained heap growth, screen-reader output, production CPU use and frame rates remain unmeasured.

## Next steps if the scope grows

1. Move mock query indexing/sorting into a Web Worker with typed cancellation messages, or replace it with an actual Node.js query API.
2. Query a bounded time window on the backend; authorize and allow-list sort/filter fields, parameterize queries, impose limits, and use cursor pagination with a stable secondary key.
3. Profile before trimming modules, moving aggregation or changing cell renderers. Use React Profiler for component commits and browser Performance/Memory tools for main-thread and allocation behavior.
4. Add a sustained-load test that repeatedly changes queries and navigates between screens while observing settled heap size. The current E2E tests prove workflows, not absence of every possible leak.
