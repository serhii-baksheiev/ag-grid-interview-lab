import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import type { Telemetry } from '../../shared/types';
import {
  defaultColDef,
  getRowId,
  statusRenderer,
  gridTheme,
} from '../../shared/grid/base';
import { useGridState } from '../../shared/grid/useGridState';
import { InfoPanel } from '../../shared/ui/InfoPanel';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';
import { createHistoryDatasource, type DatasourceStatus } from './datasource';

const initialStatus: DatasourceStatus = {
  pending: 0,
  error: false,
  requests: [],
};
export default function HistoricalLogs() {
  const [total, setTotal] = useState(100000);
  const [latency, setLatency] = useState(250);
  const [fail, setFail] = useState(false);
  const [device, setDevice] = useState('');
  const [position, setPosition] = useState(50);
  const [status, setStatus] = useState(initialStatus);
  const onStatus = useCallback((next: DatasourceStatus) => {
    setStatus(next);
  }, []);
  const api = useRef<GridApi<Telemetry> | null>(null);
  const [readyApi, setReadyApi] = useState<GridApi<Telemetry>>();
  const failRef = useRef(false);
  const latencyRef = useRef(latency);
  const pendingDeviceInput = useRef(false);
  const filterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const state = useGridState('history');
  const columns = useMemo<ColDef<Telemetry>[]>(
    () => [
      {
        field: 'timestamp',
        headerName: 'Timestamp · UTC',
        width: 205,
        pinned: 'left',
        valueFormatter: (p) => formatTimestamp(p.value as string | undefined),
        filter: 'agTextColumnFilter',
      },
      { field: 'deviceId', headerName: 'Device', width: 160 },
      { field: 'location', width: 165 },
      { field: 'type', headerName: 'Sensor type', width: 150 },
      {
        field: 'value',
        width: 115,
        filter: 'agNumberColumnFilter',
        valueFormatter: (p) => formatNumber(p.value as number | undefined),
        cellClass: 'numeric-cell',
      },
      { field: 'unit', width: 110, filter: false, sortable: false },
      { field: 'status', width: 130, cellRenderer: statusRenderer },
      {
        field: 'quality',
        headerName: 'Quality %',
        width: 120,
        filter: 'agNumberColumnFilter',
      },
      { field: 'message', headerName: 'Diagnostic', width: 225 },
    ],
    [],
  );
  const defaults = useMemo<ColDef<Telemetry>>(
    () => ({
      ...defaultColDef,
      floatingFilter: true,
      filterParams: {
        debounceMs: 350,
        maxNumConditions: 2,
        inRangeInclusive: true,
      },
    }),
    [],
  );
  const onGridReady = useCallback((event: GridReadyEvent<Telemetry>) => {
    event.api.setGridAriaProperty('label', 'Historical measurements grid');
    api.current = event.api;
    setReadyApi(event.api);
  }, []);
  useEffect(() => {
    if (!readyApi || readyApi.isDestroyed()) return;
    const datasource = createHistoryDatasource({
      total,
      latency: () => latencyRef.current,
      fail: () => failRef.current,
      onStatus,
    });
    readyApi.setGridOption('datasource', datasource);
    return () => datasource.destroy?.();
  }, [readyApi, total, onStatus]);
  useEffect(
    () => () => {
      clearTimeout(filterTimer.current);
      api.current = null;
    },
    [],
  );
  const filterDevice = (value: string) => {
    pendingDeviceInput.current = true;
    setDevice(value);
    clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => {
      const grid = api.current;
      if (!grid || grid.isDestroyed()) return;
      pendingDeviceInput.current = false;
      grid.setFilterModel({
        ...grid.getFilterModel(),
        deviceId: value
          ? { filterType: 'text', type: 'contains', filter: value }
          : null,
      });
    }, 350);
  };
  const reset = () => {
    clearTimeout(filterTimer.current);
    pendingDeviceInput.current = false;
    setDevice('');
    if (api.current) state.resetState(api.current);
  };
  return (
    <section className="feature">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">02 / QUERY EXPLORER</p>
          <h1>Historical Logs</h1>
          <p>
            Explore measurements through a block-based, asynchronous datasource.
          </p>
        </div>
        <span className="badge">INFINITE ROW MODEL</span>
      </div>
      <InfoPanel
        model="Infinite"
        size={total}
        strategy="200-row blocks · 8 cached blocks"
        processing="Local mock server"
        tradeoff="Query indexing costs CPU; a real backend would own filtering and sorting."
      />
      <div className="panel toolbar">
        <label>
          Dataset size
          <select
            aria-label="Dataset size"
            value={total}
            onChange={(event) => {
              setStatus(initialStatus);
              setTotal(Number(event.target.value));
            }}
          >
            {[10000, 100000, 500000].map((count) => (
              <option key={count} value={count}>
                {count.toLocaleString('en-US')} records
              </option>
            ))}
          </select>
        </label>
        <label>
          Network latency
          <select
            aria-label="Network latency"
            value={latency}
            onChange={(event) => {
              latencyRef.current = Number(event.target.value);
              setLatency(latencyRef.current);
            }}
          >
            {[0, 250, 750, 1500].map((ms) => (
              <option key={ms} value={ms}>
                {ms} ms
              </option>
            ))}
          </select>
        </label>
        <label>
          Device filter
          <input
            value={device}
            onChange={(event) => filterDevice(event.target.value)}
            placeholder="device-00001"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fail}
            onChange={(event) => {
              const checked = event.target.checked;
              failRef.current = checked;
              setFail(checked);
              if (checked) api.current?.purgeInfiniteCache();
            }}
          />
          Simulate request error
        </label>
        <button onClick={() => api.current?.purgeInfiniteCache()}>
          Refresh cache
        </button>
        <button onClick={reset}>Reset State</button>
      </div>
      <p className="sr-only" role="status" aria-atomic="true">
        {status.error
          ? 'Historical request failed.'
          : status.pending
            ? 'Loading historical records.'
            : status.total === undefined
              ? ''
              : `Historical records loaded. ${status.total} matching records.`}
      </p>
      <div className="metrics">
        <div className="metric">
          <span>Matching records</span>
          <strong>
            {status.total === undefined ? '—' : formatNumber(status.total)}
          </strong>
        </div>
        <div className="metric">
          <span>Pending requests</span>
          <strong>{status.pending}</strong>
        </div>
        <div className="metric">
          <span>Resident grid cache</span>
          <strong>≤ 1,600 rows</strong>
        </div>
      </div>
      {status.error && (
        <div className="notice error" role="alert">
          Historical request failed. Disable error simulation and retry.{' '}
          <button
            onClick={() => {
              api.current?.purgeInfiniteCache();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {status.total === 0 && !status.pending && (
        <p className="notice" role="status">
          <strong>No rows to show</strong>. Clear a column filter or reset the
          view.
        </p>
      )}
      <div className="grid-frame" aria-label="Historical measurements">
        <AgGridReact<Telemetry>
          theme={gridTheme}
          columnDefs={columns}
          defaultColDef={defaults}
          getRowId={getRowId}
          rowModelType="infinite"
          cacheBlockSize={200}
          maxBlocksInCache={8}
          maxConcurrentDatasourceRequests={2}
          loading={
            status.pending > 0 && status.total === undefined && !status.error
          }
          onGridReady={onGridReady}
          initialState={state.initialState}
          onStateUpdated={(event) => {
            state.onStateUpdated(event);
            if (
              pendingDeviceInput.current ||
              !event.sources.some(
                (source) =>
                  source === 'filter' || source === 'gridInitializing',
              )
            )
              return;
            const model = event.api.getFilterModel().deviceId as
              { filter?: unknown } | undefined;
            setDevice(typeof model?.filter === 'string' ? model.filter : '');
          }}
          onGridPreDestroyed={state.onGridPreDestroyed}
          animateRows={false}
          rowBuffer={10}
        />
      </div>
      <div className="toolbar">
        <label>
          Approximate result position
          <input
            type="range"
            min="0"
            max="100"
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
          />
        </label>
        <span>{position}%</span>
        <button
          disabled={!status.total}
          onClick={() =>
            api.current?.ensureIndexVisible(
              Math.floor((((status.total ?? 1) - 1) * position) / 100),
              'top',
            )
          }
        >
          Jump to position
        </button>
      </div>
      <details className="panel">
        <summary>Request inspector · last 8 requests</summary>
        <p className="muted">
          Local diagnostic durations include simulated latency and query
          processing. Column filters and sorting are processed before slicing
          each block.
        </p>
        <ul>
          {status.requests.map((request) => (
            <li key={request.id}>
              <code>
                #{request.id} [{request.range})
              </code>{' '}
              · {request.status}
              {request.duration !== undefined && ` · ${request.duration} ms`}
              <details>
                <summary>Query model</summary>
                <pre>{request.query}</pre>
              </details>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
