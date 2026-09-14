# Architecture

## Feature boundaries

The shell owns navigation and theme. Each feature owns its column definitions, interaction state and AG Grid integration. Shared code has narrow responsibilities: domain types, seeded generation, formatters, module registration, visual primitives and validated view-state storage. There is no abstraction intended to hide Grid API or unify all row models.

The four datasets are intentionally independent. Configuration edits demonstrate an editing workflow; they are not wired into the live stream. Historical and analytics values come from the same deterministic generator but represent separate query/sample surfaces.

Local state keeps ownership next to each feature because the scenarios share no mutable business state. A global store would become useful for cross-screen synchronization, shared server caches or durable drafts. A universal grid wrapper would obscure the different row models and edit lifecycles; shared helpers cover repeated concerns without owning feature behavior.

## Domain and reproducibility

Devices have identity, descriptive metadata, status, enabled flag, unit, sampling interval, two thresholds and last-seen time. Telemetry adds its own identity, device reference, timestamp, value, quality and optional diagnostics. Six sensor types span four locations.

`randomAt(index, seed)` is an addressable integer hash. `telemetryAt(index)` can create any measurement without generating preceding records; seed 42 and a fixed UTC epoch make historical expectations reproducible. Live values also derive from seed/tick/index, while their last-seen timestamp uses wall time. Battery measures percentage used: high values mean greater depletion.

## Live updates

```mermaid
flowchart LR
  Timer[Tick timer] --> Generator[Seeded changed measurements]
  Generator --> IDs[Lookup current rows by stable ID]
  IDs --> Transaction[applyTransactionAsync update]
  Transaction --> Grid[Client-Side model and visible cells]
  Transaction --> Counters[Applied-update counters]
```

The complete current fleet is available in memory, so the Client-Side Row Model can sort, filter and update it directly. The initial `rowData` array stays stable. Reset and resize reuse the seeded baseline and submit only changed, added or removed rows in bounded async transaction batches. Each tick builds replacement objects for changed devices and submits one transaction. AG Grid batches transactions with a 50 ms window. Row identity comes from `getRowId`, never the current displayed index.

Metrics use refs for stream counters and update React separately from every individual event. Timer cleanup stops input and flushes pending grid work when appropriate. Column definitions and shared grid props keep stable references. Rendering uses ordinary formatting where possible and a small status renderer where visual semantics justify it.

Stable IDs keep updates attached to devices after sorting; display indices cannot do that. Async batching trades a short display delay for fewer repeated model passes. Occasional manual updates can use synchronous transactions. Coalescing a faster stream to the latest event per device would reduce work but discard intermediate states, so it requires an explicit product decision. Received and applied counters measure different pipeline stages.

## Historical queries

```mermaid
flowchart LR
  Grid[Infinite grid] --> Request[start/end + filters + sort]
  Request --> Source[Datasource: latency and generation]
  Source --> Index[Shared query index promise]
  Index --> Page[Materialize requested block]
  Page --> Callback[successCallback rows and total]
  Callback --> Grid
```

The Infinite Row Model supplies a Community-compatible block-loading interface for a flat history. It requests half-open ranges `[startRow, endRow)` through `getRows`. The datasource returns the filtered record count to stop further scrolling and uses `failCallback` for active request failures.

The default unfiltered, unsorted query addresses a block directly. Filtering or sorting requires a scan across the virtual dataset. Matching source indices are retained in a `Uint32Array`; temporary scalar sort keys avoid repeatedly generating full records inside a comparator. A stable merge sort yields during work. Only the requested block becomes retained telemetry objects in the grid.

The datasource caches a promise for the current query index so valid concurrent blocks share processing. Query signature changes abort obsolete index work; request sequence numbers are diagnostic identities, not a latest-request-wins rule. Different blocks for the same query remain valid concurrently. Destroying the datasource cancels pending timers and processing. The inspector retains eight entries, not an unbounded request history.

AG Grid caches eight blocks of 200 rows. Text and number filters are processed by the mock before pagination, including supported AND/OR conditions. ColumnControls toggles column visibility; filterParams.debounceMs and the separate Device input timer debounce filters. Quick Filter is used only on the client-side live grid. Historical position jumping targets the current result ordering, not a raw timestamp lookup.

Cooperative yielding does not make this a server: index construction still consumes main-thread CPU and O(N) scalar/index memory. This local implementation keeps the request contract inspectable without backend setup. No full 500,000-record object array is recreated on React renders.

Filtering and sorting must precede slicing: ordering a cached block alone cannot produce globally correct pages. A device ID is not a historical row ID because a device has many measurements. Likewise, aggregating only loaded grid rows cannot describe the full history. Small histories could use Client-Side; larger production histories should delegate queries to a backend.

## Configuration editing and save

The editing pipeline separates display and persistence:

```mermaid
flowchart LR
  Editor[Cell editor] --> Parser[valueParser]
  Parser --> Validator[Domain validateDevice]
  Validator --> Setter[valueSetter accepts or rejects]
  Setter --> Draft[Draft row and dirty comparison]
  Draft --> Save[Async Save selected / all]
  Save --> Baseline[Saved baseline on success]
  Save --> Failure[Error leaves draft intact]
```

A custom React name editor (`NameEditor.tsx`) demonstrates `CustomCellEditorProps`, `onValueChange`, `parseValue` and `useGridCellEditor` validation. It preserves raw typing while passing a parsed draft to the grid. Number, select and checkbox fields use provided Community editors. Numeric parsing is separate from locale-aware display formatting. The setter validates a candidate device before mutation, returning false for invalid data. Errors appear both in a message and cell styling. Save validates again: a UI editor is not a sufficient domain boundary.

The invariant is `warningThreshold < criticalThreshold`; sampling is an integer from 1 to 3,600 seconds. A stable grid row array supports native edit undo/redo while React refreshes dirty metadata. The saved baseline is copied independently. Save is pessimistic: editing/actions are restricted while the simulated request is in flight, and the baseline advances only on success. Failed saves retain drafts.

Sharing draft and baseline objects would let a grid edit mutate both and incorrectly clear dirty state. Pessimistic saves avoid optimistic rollback and concurrent-snapshot reconciliation while still showing the draft immediately. Optimistic persistence would suit a latency-sensitive workflow with defined version/conflict handling. Cell-level validation means critical may need raising before warning; full-row editing would allow validating both new thresholds together. An external store could instead own edits through `readOnlyEdit` and `onCellEditRequest`, with undo handled by that owner.

Adding a row marks it dirty. Deletion requires confirmation and is staged; Save all commits staged deletions and Revert all restores them before saving. Native undo/redo handles cell edits, not the complete application transaction history. Sorting, filtering, row replacement and column movement, pinning or visibility changes clear native undo stacks. Columns and Reset State can therefore clear edit history too.

The shell keeps Configuration mounted once visited, preserving in-memory drafts when navigating. Reload starts a fresh mock session. In production, saved configuration would come from an API and draft durability would be an explicit product decision.

## Analytics

A deterministic 10,000-record sample is aggregated by location, sensor type and unit. Summary records contain count, min, max, average and warning/critical share. Mixing temperature, pressure and percentage values in one average would be meaningless, so units remain separate. The result is a flat Community grid plus a small separate HTML/CSS bar chart.

This is application-level aggregation, not AG Grid's native grouping or `aggFunc` pipeline. Native grouping, pivot, tool panels and integrated charting are documented Enterprise extension points.

Filtering summary rows does not recalculate the underlying sample. Combining group averages would require count weighting and compatible units; the sample is not an aggregate of the entire historical dataset.

## View state

`useGridState` connects `initialState`, `onStateUpdated` and `onGridPreDestroyed` to storage. Per-grid keys are versioned (`iot-lab:v1:*`). Persisted sections are column order, sizing, pinning, visibility, sorting and filters; unnecessary state and row data are excluded. Shape validation and size/depth bounds protect the Grid API from malformed localStorage. Storage exceptions fall back to usable in-memory interaction.

`initialState` is read on grid construction, not on every render. Partial column-state restoration sets `partialColumnState`. Analytics also provides explicit saved-view restoration. Reset State clears column/filter changes. Theme has its own independent key.

## Cell presentation boundaries

Direct properties use `field`; computed values belong in pure getters that retain numeric types. Formatters change display text without rounding stored measurements, and cached `Intl` formatters avoid per-cell construction. A small React status renderer adds readable text and styling without owning data or performing requests. Provided editors cover numbers, booleans and short option lists; richer selection UI is an edition trade-off described in the [feature matrix](FEATURE_MATRIX.md).

Parsing converts input, while domain validation determines whether it is acceptable. An empty numeric input must not silently become a valid zero. Memoization stabilizes grid props where reference identity matters; it does not make an expensive calculation cheap. DOM virtualization bounds rendered cells, not query CPU or model memory; the [performance report](PERFORMANCE.md) separates those costs.

## A real Node.js / Timestream boundary

The browser would send a validated query DTO: time range, device/location/type predicates, numeric limits, supported sort order, block/page size and continuation information. Node.js would whitelist query fields/operators, apply access rules and translate the DTO into parameterized queries or safely validated query construction. It would map Timestream results into telemetry DTOs and normalize time/unit semantics.

Large queries would use time windows and continuation tokens rather than assume arbitrary offsets are cheap. An exact filtered count may require separate expensive work; the grid can initially operate without it. Cancellation would abort fetches and, where supported, backend work. Client generations would still protect against late responses.

Live events would come from a subscription such as WebSocket/SSE; reconnect, deduplication, ordering, backpressure and retention policies would become explicit. Configuration saves would need version/conflict checks and server validation. SSRM would be appropriate when server-backed grouping, aggregation or pivot is required, and would introduce an Enterprise dependency.

## References

- [Row models](https://www.ag-grid.com/react-data-grid/row-models/)
- [Infinite datasource contract](https://www.ag-grid.com/react-data-grid/infinite-scrolling/)
- [High-frequency transactions](https://www.ag-grid.com/react-data-grid/data-update-high-frequency/)
- [Saving edited values](https://www.ag-grid.com/react-data-grid/value-setters/)
- [Grid State](https://www.ag-grid.com/react-data-grid/grid-state/)
