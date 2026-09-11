import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi } from 'ag-grid-community';
import { telemetryAt } from '../../shared/data/generator';
import { defaultColDef, getRowId, gridTheme } from '../../shared/grid/base';
import { ColumnControls } from '../../shared/grid/ColumnControls';
import { useGridState } from '../../shared/grid/useGridState';
import { InfoPanel } from '../../shared/ui/InfoPanel';
import { formatNumber } from '../../shared/utils/format';
import { summarize, type Summary } from './model';
const columns: ColDef<Summary>[] = [
  { field: 'location', pinned: 'left', width: 180 },
  { field: 'type', headerName: 'Sensor type', width: 150 },
  { field: 'unit', width: 115 },
  ...(['min', 'max', 'avg', 'count', 'alerts'] as const).map((field) => ({
    field,
    headerName:
      field === 'avg' ? 'Average' : field[0].toUpperCase() + field.slice(1),
    filter: 'agNumberColumnFilter',
    width: 125,
    valueFormatter: ({ value }: { value: number }) => formatNumber(value),
  })),
  {
    colId: 'alertRate',
    headerName: 'Alert rate',
    valueGetter: (p) => (p.data ? (100 * p.data.alerts) / p.data.count : 0),
    valueFormatter: (p) => `${formatNumber(p.value)}%`,
    filter: 'agNumberColumnFilter',
    width: 135,
  },
];
export default function Analytics() {
  const [api, setApi] = useState<GridApi<Summary>>();
  const [message, setMessage] = useState('');
  const rows = useMemo(
    () => summarize(Array.from({ length: 10000 }, (_, i) => telemetryAt(i))),
    [],
  );
  const state = useGridState('analytics');
  const locations = useMemo(
    () =>
      [...new Set(rows.map((row) => row.location))].map((location) => {
        const groups = rows.filter((row) => row.location === location);
        const count = groups.reduce((sum, row) => sum + row.count, 0);
        const alerts = groups.reduce((sum, row) => sum + row.alerts, 0);
        return { location, count, alerts, rate: (100 * alerts) / count };
      }),
    [rows],
  );
  return (
    <section>
      <div className="feature-heading">
        <div>
          <p className="eyebrow">04 / FLEET INSIGHTS</p>
          <h1>Analytics</h1>
          <p>A reproducible snapshot. Compare like with like.</p>
        </div>
        <span className="badge">10,000 MEASUREMENT SAMPLE</span>
      </div>
      <div className="analytics-overview">
        <div className="panel chart-panel">
          <p className="eyebrow">WARNING + CRITICAL READINGS</p>
          <h2>Alert share by location</h2>
          <div
            role="img"
            aria-label={locations
              .map(
                (row) =>
                  `${row.location}: ${formatNumber(row.rate)} percent alerts`,
              )
              .join('. ')}
          >
            {locations.map((row) => (
              <div className="bar-row" key={row.location}>
                <span>{row.location}</span>
                <div className="bar-track">
                  <div style={{ width: `${row.rate}%` }} />
                </div>
                <b>{formatNumber(row.rate)}%</b>
              </div>
            ))}
          </div>
          <p className="footnote">
            Alert proportions are comparable; raw readings in different units
            are not.
          </p>
        </div>
        <div className="panel analytics-note">
          <span className="step-number">{rows.length}</span>
          <h2>Comparable sensor groups</h2>
          <p>
            Location × sensor type × unit. Each group includes min, max,
            average, count and alert count.
          </p>
          <p>
            Summary rows are calculated by the application. Native grid
            grouping, pivot, sparklines and tool panels are Enterprise
            extensions.
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="grid-toolbar">
          <strong>Measurement summary</strong>
          <div className="toolbar-end">
            <ColumnControls api={api} />
            <button
              disabled={!api}
              onClick={() =>
                api &&
                setMessage(
                  state.saveView(api)
                    ? 'View saved'
                    : 'Storage unavailable. View could not be saved.',
                )
              }
            >
              Save view
            </button>
            <button
              disabled={!api}
              onClick={() =>
                api &&
                setMessage(
                  state.restoreView(api)
                    ? 'View restored'
                    : 'No saved view yet.',
                )
              }
            >
              Restore view
            </button>
            <button onClick={() => api && state.resetState(api)}>
              Reset State
            </button>
          </div>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <div className="grid-frame">
          <AgGridReact<Summary>
            rowData={rows}
            theme={gridTheme}
            columnDefs={columns}
            defaultColDef={defaultColDef}
            getRowId={getRowId}
            initialState={state.initialState}
            onStateUpdated={state.onStateUpdated}
            onGridPreDestroyed={state.onGridPreDestroyed}
            onGridReady={(event) => {
              event.api.setGridAriaProperty('label', 'Analytics summary grid');
              setApi(event.api);
            }}
          />
        </div>
      </div>
      <InfoPanel
        model="Client-Side summary"
        size="10,000 → 24 groups"
        strategy="Seeded snapshot"
        processing="Application aggregation"
        tradeoff="Community-only summary, not native row grouping or pivot. A production backend would aggregate a bounded time window before sending these rows."
      />
    </section>
  );
}
