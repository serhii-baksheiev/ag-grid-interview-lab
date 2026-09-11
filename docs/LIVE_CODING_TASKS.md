# Ten live-coding exercises

Practice in a disposable local branch. Hide only the relevant solution while practising; restore it afterward. Keep the working application free of intentionally broken variants. Start with the seeded demo data, explain your decision aloud, then verify the behavior. Times include a short explanation and focused check.

## 1. Add a column — 5 minutes

**Task:** expose the device's unit in Live Telemetry, or temporarily remove and rebuild that existing column.

**Interviewer checks:** typed `ColDef`, `field`, `headerName`, sizing and locating feature code quickly.

**Possible solution:** add `{ field: 'unit', headerName: 'Unit', width: 115 }` to `src/features/live-telemetry/columns.ts`. Confirm temperature, humidity and pressure show different units. Keep the column array stable.

**Trade-off:** use `field` for a direct property; a `valueGetter` would add unnecessary indirection. A default width is a starting point, not a replacement for user resizing.

**Hide before practice:** only the unit column definition in the Live columns file. Keep the data model and generator visible.

## 2. Format a measurement — 7 minutes

**Task:** format a numeric value to at most two decimals, with a safe empty representation, while retaining numeric sorting.

**Interviewer checks:** separation between stored value and display; undefined/non-finite cases; formatter reuse.

**Possible solution:** implement a pure helper with a cached `Intl.NumberFormat`, call it from `valueFormatter`, and test 0, a fractional number, undefined and NaN. Sort the Value column to confirm it compares numbers.

**Trade-off:** rounding the stored value changes data; formatting does not. Locale formatting should not become an accidental input parser.

**Hide before practice:** replace only the body of exported `formatNumber` in `src/shared/utils/format.ts` with `return numberFormat.format(value ?? 0)`. This intentionally mishandles empty/non-finite input while keeping the cached formatter in use. Keep the export, signature and every column invocation intact so the application still starts. Run `npm run typecheck`, restore the formatter using its tests, then sort Value to verify numeric ordering.

## 3. Render status accessibly — 10 minutes

**Task:** show normal, warning and critical statuses with a small badge containing readable text.

**Interviewer checks:** `cellRenderer` versus formatter, safe DOM text handling, lightweight rendering and non-color-only semantics.

**Possible solution:** return a React span using `createElement('span', { className: allowedStatusClass }, statusText)` (or JSX), with a fallback for missing data. React escapes the text. Point the status column to this renderer and confirm the status name is available to assistive technology. A plain function renderer in the React wrapper must return React content, not an `HTMLElement`.

**Trade-off:** keep the React renderer small and stateless; avoid fetches or state subscriptions in every cell. A JavaScript class renderer with `init` and `getGui` is an alternative only if profiling justifies the extra lifecycle code.

**Hide before practice:** replace only the body of exported `statusRenderer` in `src/shared/grid/base.ts` with `return createElement('span', null, params.value ?? 'offline')`. This keeps the React import used while removing the badge styling. Keep its signature, imports and column references intact. Run `npm run typecheck`; restore the text badge, then inspect the Live and Historical status cells.

## 4. Add a historical filter — 12 minutes

**Task:** filter history by device name/ID text, preserving the other column filters.

**Interviewer checks:** query model ownership, debounce, filtering before block slicing and cleanup.

**Possible solution:** debounce a labelled input for 350 ms, merge the device model with `api.getFilterModel()`, and call `setFilterModel`. In the query function, compare device IDs case-insensitively before computing total and slicing rows. Test with a device known from `telemetryAt(0)`.

**Trade-off:** the Infinite grid does not have the full dataset for Quick Filter. Too much debounce feels slow; too little creates wasted query work.

**Hide before practice:** replace only the text `contains` fallback (`default: return text.includes(filter)`) in `query.ts` with `return true`. The Device filter sends `type: 'contains'`, not `equals`. Keep the UI handler intact. Restore case-insensitive matching, run `npx vitest run src/features/historical-logs/query.test.ts`, then enter `device-0001` and confirm every visible Device ID contains that text. Filtering must precede total calculation and block slicing.

## 5. Add an editable field — 12 minutes

**Task:** restore the Location select editor and make edits participate in dirty-state tracking.

**Interviewer checks:** editor selection, typed allowed values, reuse of a domain validation/save path and avoiding duplicate state ownership.

**Possible solution:** configure `agSelectCellEditor` with `locations` in `cellEditorParams.values`; retain the shared setter and `onCellValueChanged` flow. Edit a location, inspect the dirty list, and revert it.

**Trade-off:** a basic select is sufficient for four values. Rich Select is an Enterprise option for richer UX, not a requirement for all dropdowns.

**Hide before practice:** only the Location editor configuration in `src/features/device-configuration/columns.ts`; keep the setter and model visible.

## 6. Validate related values — 15 minutes

**Task:** enforce `warningThreshold < criticalThreshold` and a whole-number sampling interval between 1 and 3,600 seconds.

**Interviewer checks:** domain invariants, parser/validator separation, reject behavior and useful error messages.

**Possible solution:** write failing tests in `model.test.ts`, implement rules in `validateDevice`, validate a candidate before mutation in `valueSetter`, and validate again before Save. Test equality, reversed thresholds, NaN, fractional sampling and valid boundaries. Confirm a rejected edit preserves the prior valid value.

**Trade-off:** cell-by-cell threshold editing may require changing critical first. Full-row editing could validate both new values together but adds interaction complexity.

**Hide before practice:** the threshold/sampling rules in `src/features/device-configuration/model.ts`; keep tests and save caller visible. Do not weaken the tests to accept invalid values.

## 7. Update one row by transaction — 15 minutes

**Task:** write a button that updates a chosen device measurement without replacing the complete `rowData` array.

**Interviewer checks:** stable IDs, immutable changed-row objects, Grid API lifecycle and correct status recalculation.

**Possible solution:** obtain the current row with `getRowNode(id)`, build a replacement object, calculate status with its thresholds and call `applyTransaction({ update: [next] })`. Demonstrate that sorting does not cause another device to change. Then explain when you would switch to `applyTransactionAsync`.

**Trade-off:** a single manual update does not need batching. Streaming bursts do. A displayed row index is not a stable device identifier.

**Hide before practice:** temporarily collapse the tick-loop update code in `src/features/live-telemetry/LiveTelemetry.tsx`; leave `getRowId` visible. Add the practice button only in the exercise branch.

## 8. Persist a view safely — 20 minutes

**Task:** restore column order, visibility and sort after reload, while gracefully handling corrupted storage.

**Interviewer checks:** Grid State lifecycle, versioned keys, runtime validation and scope of persistence.

**Possible solution:** persist selected sections from `stateUpdated`, validate JSON on read, pass restored state via `initialState`, and use `partialColumnState` when supplying only some column sections. Add a reset action. Test invalid JSON and a valid JSON object with the wrong nested shape.

**Trade-off:** saving all state is easy but retains unnecessary interaction details. Persisting every keystroke synchronously can have a cost; debounce writes if measured workload justifies it. Do not save row data.

**Hide before practice:** the implementation of `src/shared/grid/useGridState.ts` or one serializer validator in `storage.ts`, retaining the public function signatures and tests.

## 9. Implement a cancellable datasource — 25 minutes

**Task:** load two history blocks concurrently, report an active failure and reject an obsolete filter response.

**Interviewer checks:** half-open ranges, exactly one terminal callback for an active request, retry, cancellation and parallel correctness.

**Possible solution:** implement `IDatasource.getRows`, simulate latency, call the existing `queryHistory`/prepared-index helpers, and pass rows plus filtered total to success. Scope cancellation to the query generation. Share work for parallel blocks; cancel timers and processing in `destroy`. Use a controlled test to finish an older query after a newer one.

**Trade-off:** a single latest-request counter breaks concurrent blocks. Abort reduces wasted work, but a generation guard is still useful before applying results. Returning an exact count can be expensive on a real backend.

**Hide before practice:** `src/features/historical-logs/datasource.ts` internals while keeping interface types, `query.ts` and tests visible. Start with a small dataset; discuss the 500,000-record case afterward.

## 10. Diagnose performance from evidence — 30 minutes

**Task:** profile 10,000 live rows and a filtered/sorted 500,000-record history. Identify one cost, propose an improvement and preserve query correctness.

**Interviewer checks:** distinction between React renders, DOM virtualization, model work and object generation; measurement discipline; cancellation/cleanup.

**Possible solution:** use browser Performance/React profiling, record the exact preset and browser, inspect stable grid props, compare no-filter block loading with an indexed query, and inspect task durations. Candidates include narrower registered modules, reducing repeated scalar key work, a Worker for query indexing, or stream coalescing by device. Add a focused regression test for any changed semantics. Re-run the same workload and report only the measured difference.

**Trade-off:** a Worker adds serialization and lifecycle complexity; coalescing may omit intermediate events; aggressively shrinking rowBuffer may expose blanking during scroll. A faster average must not hide worse input latency or broken ordering.

**Hide before practice:** the implementation notes in `docs/PERFORMANCE.md` and these suggested solutions; keep production code unchanged. There is no deliberately slow production component to activate.

## Recommended first session

Complete **1, 2 and 6**, then narrate one full edit from editor through parsing, validation, dirty state and save. In the next session, attempt **7, 8 and 9** with the request inspector open. Finish by explaining which work would move to a Node.js backend and which capabilities require Enterprise.
