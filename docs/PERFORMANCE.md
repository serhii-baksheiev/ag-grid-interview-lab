# Performance, accessibility and practical limits

This is a learning application, not a universal benchmark. Measurements below were taken locally in Chromium against a Vite development build on 2026-09-11. Machine load, development validation, browser, data distribution and filter complexity affect the result. No FPS guarantee is made.

## Measured observations

The independent [review](PERFORMANCE_REVIEW.md) sampled 10,000 live rows at 100 ms ticks, 1,000 changes per tick and burst enabled. It observed 21 rendered row elements, an input-rate sample of 17,995 events/second, and one 54 ms long task during a five-second interval. This checks that the grid virtualizes DOM rows; it is not a heap-leak or sustained-load proof. Metrics are sampled once per second and can lag the actual grid.

A 500,000-record historical value sort with zero simulated latency completed in 4,208 ms in an isolated review run. Another run under concurrent load was still pending after seven seconds. The mock server uses the main thread cooperatively, so this is a visible loading operation rather than a claim of instant queries. `e2e/lab.spec.ts` exercises the 10,000-row and 500,000-record presets and interaction with filtering.

The production build includes all Community modules and reports a JavaScript chunk around 1.37 MB minified, about 390 KB gzip. This is an intentional simplicity/bundle-size trade-off for an offline interview lab. Vite's chunk-size warning remains visible. Selectively registering modules and splitting optional screens is a possible next optimization; splitting a vendor chunk alone does not reduce downloaded bytes.

## Where work happens

| Surface                  | Allocation and update strategy                                                                                        | Remaining cost                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Live                     | One initial fleet; stable `getRowId`; fresh objects only for changed rows; `applyTransactionAsync` with 50 ms batches | Each batch may re-run sorting/filtering. A burst can affect the full 10,000-row fleet.                                              |
| History, default query   | Direct deterministic access by index; 200-row blocks; eight cached blocks; two concurrent requests                    | Artificial network delay; row formatting/rendering. The grid cache is bounded, not all mock-server memory.                          |
| History, filtered/sorted | One shared index promise per query; `Uint32Array` indices; temporary scalar sort keys; cooperative merge sort         | O(N) scan and O(N log N) sort; index and keys consume memory proportional to N. Transient row objects are generated while scanning. |
| Configuration            | Small 100-device fleet; stable editable row array; separate saved baseline and dirty metadata                         | Dirty/deletion detection includes nested lookups. Do not scale this unchanged to hundreds of thousands of editable rows.            |
| Analytics                | One deterministic 10,000-reading sample per mount; 24 summary rows; small independent bar chart                       | A bounded synchronous sample aggregation on entry. Not a full-history analytics query.                                              |

The historical mock yields every 4,096 scan items and every 16,384 merge-sort output items, plus between merge passes. Superseded query generations are aborted. Concurrent requests for different blocks of the same query share computation and remain valid. Destroy clears pending delay timers and aborts indexing. This is materially different from dropping every response except the globally newest request.

## React and lifecycle decisions

`columnDefs`, `defaultColDef`, themes, row IDs and major object-valued grid props are stable constants or memoized values. Live ticks mutate only diagnostic refs and submit transactions; React state is updated once per second for counters. The status renderer returns a small React element and does no fetching, effects or expensive formatting. Formatters reuse `Intl` instances.

Live timers stop on unmount, and pending transactions are flushed. Each deferred transaction callback captures its own counter object, so it can count a paused stream's final batch without crediting a later reset. Callbacks only update that captured diagnostic object, never React state after unmount. Resetting data handles the counter sampling baseline, preventing negative event-rate readings. Live stream controls reset when leaving the screen; column/filter state is restored on return.

Configuration stays mounted after the first visit so drafts and an in-progress save survive navigation. It does not run a background stream. A save disables editing and mutation controls until completion, and the baseline only advances after success. Unmount clears its save timer. A `beforeunload` handler warns while dirty rows exist; no configuration rows are stored in localStorage.

Grid State serialization retains only view-related sections, caps input length and validates stored shapes. Storage writes are synchronous and bounded; errors are caught. Debounce persistence only if profiling shows a meaningful cost during resizing. Avoid storing row selection, scroll state and full row datasets unnecessarily.

## Accessibility corrections and validation

The independent review caught a CSS import-order defect that made the mobile sidebar and workspace sit beside each other. After moving responsive rules after base styles, a browser check reported document width equal to viewport width (390 px) for all four screens. The tables themselves scroll horizontally, preserving readable column widths.

Deletion cancellation now returns keyboard focus to **Delete selected**; confirmation moves it to **Add device**. Escape cancels the inline confirmation. It is not presented as a modal focus trap. Dark active-stream and eyebrow text have lighter overrides. Status badges contain words, not only color. Native controls have labels, a skip link and visible focus styles; the chart has a textual accessible description.

Browser tests capture console errors and uncaught page errors before navigation. This is not a complete WCAG or assistive-technology certification. Exact React render counts, sustained heap growth, screen-reader output, production CPU use and frame rates remain unmeasured.

## Next steps if the scope grows

1. Move mock query indexing/sorting into a Web Worker with typed cancellation messages, or replace it with an actual Node.js query API.
2. Query a bounded time window on the backend; authorize and allow-list sort/filter fields, parameterize queries, impose limits, and use cursor pagination with a stable secondary key.
3. Profile before trimming modules, moving aggregation or changing cell renderers. Use React Profiler for component commits and browser Performance/Memory tools for main-thread and allocation behavior.
4. Add a sustained-load test that repeatedly changes queries and navigates between screens while observing settled heap size. The current E2E tests prove workflows, not absence of every possible leak.
