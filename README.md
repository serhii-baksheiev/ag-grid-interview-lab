# AG Grid IoT Interview Lab

A local React + TypeScript console for practising Senior Frontend / Fullstack interviews involving large grids, streaming telemetry and spreadsheet-style editing. Four focused screens expose native AG Grid concepts directly. Data is synthetic and reproducible; no backend, account, database or licence key is needed.

## Run locally

Use Node.js **22.12 or newer** and npm. Install the lockfile dependencies with one command:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. After dependency installation, the application itself makes no network requests. For production assets, run `npm run build`, then `npm run preview`.

## Explore the lab

| Screen               | Try this                                                                                            | Main concept                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Live Telemetry       | Select 10,000 devices; adjust tick rate; toggle burst; pause; filter a location                     | Client-Side Row Model, stable IDs and async transactions       |
| Historical Logs      | Select 500,000 records; filter a device; sort Value; inspect requests; simulate a failure and retry | Infinite Row Model, block cache and asynchronous queries       |
| Device Configuration | Edit a name or threshold; select rows; save or revert; simulate failed save                         | Editors, parsing, domain validation, draft/baseline separation |
| Analytics            | Inspect summaries by location and sensor type; save and restore a view                              | Application aggregation displayed in a Community grid          |

The sidebar also includes an Interview Guide. Controls have labels, grids support keyboard navigation, and the shell offers light/dark themes. Each screen includes a compact architecture panel. Use Tab to enter a grid, arrows to navigate, Enter/F2 to edit, and Escape to cancel. Configuration supports row selection and native edit undo/redo; sorting, filtering and row replacement clear that edit history.

Live data uses seed **42**. Historical timestamps begin at a fixed UTC epoch. Battery readings represent **percentage used**, so increasing warning/critical thresholds have the same direction as other sensors. Live timestamps reflect the local demonstration clock.

## Verify

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

`npm test` runs all Vitest tests. E2E starts a local Vite server automatically; a compatible existing server can be reused locally. The browser installation is only needed before the first Playwright run. Unit tests cover domain/query/state logic; integration and E2E tests exercise critical user flows. See [performance notes](docs/PERFORMANCE.md) for diagnostic scope and limitations.

## Architecture and decisions

```text
src/app/                         shell, navigation, theme
src/features/live-telemetry/     stream loop and columns
src/features/historical-logs/    query index, datasource, screen
src/features/device-configuration/ editors, validation, drafts and saves
src/features/analytics/          summary calculation and presentation
src/shared/data/                seeded, addressable generator
src/shared/grid/                modules, theme, state and column controls
src/shared/ui/                  shared information/error surfaces
src/shared/utils/               number and UTC formatting
```

AG Grid Community and React wrappers use **36.1.0**. `AllCommunityModule` is registered explicitly; development validation is enabled only in development. Theming uses the current Theming API. No global state manager or universal grid wrapper obscures the feature code.

Live telemetry replaces only changed row objects through `applyTransactionAsync`; it does not replace `rowData` on every tick. Historical queries materialize requested rows lazily. Filtering/sorting builds a compact index, yields during processing and shares the result across concurrent blocks. Configuration keeps drafts separate from the saved baseline, rejects invalid edits and uses a pessimistic asynchronous save. Drafts survive failed saves and navigation between tabs. Analytics uses a deterministic 10,000-measurement sample and keeps different units in separate groups.

View state stores column order, sizes, visibility, pinning, sort and column filters under versioned, per-grid localStorage keys. Runtime shape checks reject malformed state; denied storage leaves the app usable. Row data is never persisted. Reset State resets the view; Live Reset data regenerates the seeded fleet.

## Community / Enterprise

The running application is entirely **Community**. Native row grouping, aggregation, pivot, range selection, multi-cell clipboard, Columns Tool Panel, sparklines, Integrated Charts and Server-Side Row Model are Enterprise extensions, deliberately not installed. Analytics displays application-computed summaries and a separate HTML/CSS chart. Basic browser text copying and editor paste are available; they are not Excel-style range clipboard operations. See the sourced [feature matrix](docs/FEATURE_MATRIX.md).

## Boundaries of the demo

- Historical processing is a local mock, not a Timestream emulator. Filter/sort indexing still costs browser CPU and memory; cooperative yielding improves responsiveness without moving work off-thread.
- Configuration saves are in memory. A reload resets devices, including previously “saved” changes. Only view state and theme survive reload.
- Live, historical, configuration and analytics data are separate demonstrations. Editing configuration does not reconfigure the live generator or rewrite history.
- Analytics describes a fixed sample, not all 500,000 historical records. It does not implement interactive native grouping or pivot.
- Event rates and request timings are local diagnostics, not portable FPS benchmarks. No claims are made about production network, persistence or concurrency guarantees.

## Interview materials

- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Russian interview notes](docs/INTERVIEW_NOTES_RU.md)
- [Spoken English phrases](docs/INTERVIEW_PHRASES_EN.md)
- [Ten live-coding exercises](docs/LIVE_CODING_TASKS.md)
- [Community/Enterprise feature matrix](docs/FEATURE_MATRIX.md)
- [Performance review](docs/PERFORMANCE.md)

Start with exercises **1 (column)**, **2 (formatter)** and **6 (validation)**. Then explain why historical filtering belongs before block slicing and why stable row IDs matter for streaming updates.

## Screenshots

After running locally, capture the Live, Historical, Configuration and Analytics screens in both themes if useful. Save images under `docs/screenshots/` and add relative Markdown image links here. No placeholder screenshot is presented as a verified capture.

Existing Rig process files are retained. This task is a local application implementation; it does not publish a site or require a remote repository.
