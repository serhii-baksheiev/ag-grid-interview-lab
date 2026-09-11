# Performance and accessibility review

Independent review of the local React 19.3 / AG Grid Community 36.1 implementation, 2026-09-11. Source inspection plus Playwright Chromium against the Vite development server. Measurements are local observations, not production benchmarks or FPS guarantees.

## Measured behavior

- Live view: 10,000 devices, 100 ms ticks, 1,000 changes per tick, burst enabled. A five-second sample showed 17,995 input events/second on the application's counter, 21 rendered row elements, and one PerformanceObserver long task of 54 ms. The displayed cumulative counters were 88,000 received and 87,000 applied at sampling; they were sampled during an active stream, not after draining it.
- Historical view: 500,000 records, zero simulated latency, ascending numeric value sort completed in 4,208 ms in an isolated run. A separate run under concurrent activity remained pending after seven seconds. Query latency depends on local load.
- No browser page errors or console errors occurred during the live, history, configuration and analytics navigation sample.
- At 390 x 844, initial document widths were 657 px (live), 624 px (history/configuration), and 768 px (analytics). This was a failing responsive check.
- Selecting a configuration row and opening deletion moved focus to Confirm deletion. Cancelling initially left focus on BODY.

## Findings sent to implementation owner

1. **Blocker: mobile page overflow.** The imported responsive stylesheet's `.app { display: block }` loses to the later base `.app { display: flex }` declaration. The sidebar becomes static but remains beside the workspace. Fix cascade ordering/specificity, then check all views and toolbar wrapping at mobile widths.
2. **Accessibility correction: deletion focus.** Restore focus to the initiating control after cancel/confirmation; provide Escape cancellation. The initial inline alert dialog is not modal, so do not claim a modal focus trap exists.
3. **Accessibility correction: dark contrast.** Calculated CSS color contrast for active stream text `#18785e` against dark surface `#182336` is 2.92:1; eyebrow `#5674c6` against the same surface is 3.53:1. These small text treatments need dark theme overrides to reach 4.5:1.

These record the reviewed revision. Fixes require a subsequent verification; this report does not imply they remain unfixed in later code.

## Source-backed strengths and remaining limits

Large grid props are module constants, React state or memoized objects. Stable row IDs support immutable live transaction updates. Tick updates use `applyTransactionAsync`, with a 50 ms transaction window; React only receives the diagnostics once per second. Timers are cleared when the live view unmounts. Historical requests share an index per query, reject superseded generations, abort ongoing indexing, and resolve pending artificial delays during datasource destruction. Indexing and merge sorting yield periodically. The grid requests at most two concurrent blocks and configures eight 200-row cached blocks. This cache cap does not cap mock-server indexing memory: sorting also allocates typed index buffers and per-column sort keys, proportional to dataset size. A worker or backend is the next step if heavier queries are required.

Configuration drafts remain mounted when switching sections, intentionally preserving edits and an outstanding save. Its cleanup clears the save timer and removes the dirty-state beforeunload listener when appropriate. Dirty comparisons perform nested lookups, acceptable for the default 100 devices but unsuitable as-is for a much larger configuration dataset. Analytics builds a 10,000-row sample once per mount and displays 24 comparable summary groups.

State persistence writes synchronously to localStorage on grid state events; storage failures are caught. Debouncing may help if profiling shows resize or scroll persistence contributing to stalls. A live data reset can temporarily calculate a negative event rate because the sampling effect retains its previous cumulative count; resetting the sample baseline would make diagnostics clearer.

Keyboard-accessible native controls, a skip link, visible focus CSS, labelled inputs, textual status badges and an accessible textual chart summary are present. This was not a complete screen-reader or WCAG audit. Sustained heap growth, CPU percentages, production bundle timing, exact frame rate, every grid keyboard path and assistive-technology behavior remain unmeasured.
