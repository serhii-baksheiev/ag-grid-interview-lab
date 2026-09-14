import { useEffect, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi } from 'ag-grid-community';
import {
  generateLiveDevices,
  randomAt,
  sensorSpecs,
  statusFor,
} from '../../shared/data/generator';
import type { LiveDevice } from '../../shared/types';
import { defaultColDef, getRowId, gridTheme } from '../../shared/grid/base';
import { useGridState } from '../../shared/grid/useGridState';
import { ColumnControls } from '../../shared/grid/ColumnControls';
import { InfoPanel } from '../../shared/ui/InfoPanel';
import { liveColumns } from './columns';
import {
  ASYNC_TRANSACTION_WINDOW_MS,
  createCounters,
  sampleDiagnostics,
} from './diagnostics';
export default function LiveTelemetry() {
  const [count, setCount] = useState(1000);
  const [rows] = useState(() => generateLiveDevices(1000));
  const baseline = useRef(rows);
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);
  const sample = useRef({ previous: createCounters(), last: 0 });
  const [api, setApi] = useState<GridApi<LiveDevice>>();
  const [running, setRunning] = useState(true);
  const [interval, setIntervalMs] = useState(250);
  const [changes, setChanges] = useState(100);
  const [burst, setBurst] = useState(false);
  const [search, setSearch] = useState('');
  const [showLocation, setShowLocation] = useState(true);
  const [metrics, setMetrics] = useState(() =>
    sampleDiagnostics(createCounters(), createCounters(), 0),
  );
  const counters = useRef(createCounters());
  const state = useGridState('live');
  useEffect(() => {
    if (!api || !running) return;
    const timer = window.setInterval(() => {
      if (resettingRef.current) return;
      const tick = ++counters.current.tick;
      const amount = Math.min(
        count,
        changes * (burst && tick % 8 === 0 ? 10 : 1),
      );
      const updates: LiveDevice[] = [];
      const offset = Math.floor(randomAt(tick) * count);
      for (let i = 0; i < amount; i++) {
        const index = (offset + i) % count;
        const previous = api.getRowNode(
          `device-${String(index + 1).padStart(5, '0')}`,
        )?.data;
        if (!previous) continue;
        const spec = sensorSpecs[previous.type];
        const value =
          Math.round(
            (spec.min +
              randomAt(tick * count + index) * (spec.max - spec.min)) *
              100,
          ) / 100;
        updates.push({
          ...previous,
          value,
          status: statusFor(
            value,
            previous.warningThreshold,
            previous.criticalThreshold,
          ),
          lastSeen: new Date().toISOString(),
        });
      }
      counters.current.received += updates.length;
      // Capture this generation: deferred callbacks cannot credit a later reset.
      const accounting = counters.current;
      api.applyTransactionAsync({ update: updates }, (result) => {
        accounting.applied += result.update.length;
      });
    }, interval);
    return () => {
      window.clearInterval(timer);
      if (!api.isDestroyed()) api.flushAsyncTransactions();
    };
  }, [api, running, interval, changes, burst, count]);
  useEffect(() => {
    sample.current.last = performance.now();
    const timer = window.setInterval(() => {
      const { previous, last } = sample.current;
      const now = performance.now();
      const current = counters.current;
      setMetrics(sampleDiagnostics(current, previous, now - last));
      sample.current = { previous: { ...current }, last: now };
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  function resetData(next = count) {
    if (!api || resettingRef.current) return;
    api?.flushAsyncTransactions();
    const seeded =
      next === count ? baseline.current : generateLiveDevices(next);
    const update = seeded.filter((row) => {
      const current = api.getRowNode(row.id)?.data;
      return (
        current &&
        Object.keys(row).some(
          (key) =>
            current[key as keyof LiveDevice] !== row[key as keyof LiveDevice],
        )
      );
    });
    const add = seeded.filter((row) => !api.getRowNode(row.id));
    const remove = baseline.current.slice(next);
    baseline.current = seeded;
    setCount(next);
    counters.current = createCounters();
    sample.current = { previous: createCounters(), last: performance.now() };
    setMetrics(sampleDiagnostics(counters.current, sample.current.previous, 0));
    const length = Math.max(update.length, add.length, remove.length);
    if (!length) return;
    resettingRef.current = true;
    setResetting(true);
    // Wait for each bounded transaction before queuing the next, allowing input and paint.
    const batch = (offset: number) => {
      if (api.isDestroyed()) return;
      api.applyTransactionAsync(
        {
          update: update.slice(offset, offset + 200),
          add: add.slice(offset, offset + 200),
          remove: remove.slice(offset, offset + 200),
        },
        () => {
          if (api.isDestroyed()) return;
          if (offset + 200 < length) batch(offset + 200);
          else {
            resettingRef.current = false;
            setResetting(false);
          }
        },
      );
    };
    batch(0);
  }
  return (
    <section aria-label="Live telemetry view">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">01 / STREAM PROCESSING</p>
          <h1>Live Telemetry</h1>
          <p>Watch your sensor fleet. Update the signal, keep the context.</p>
        </div>
        <span className={`connection ${running ? 'active' : ''}`}>
          <i />
          {running ? 'Stream active' : 'Stream paused'}
        </span>
      </div>
      <div className="metrics">
        <div className="metric">
          <span>CONNECTED SENSORS</span>
          <strong>{count.toLocaleString('en-US')}</strong>
          <small>Six sensor types · four locations</small>
        </div>
        <div className="metric">
          <span>EVENTS / SECOND</span>
          <strong>
            {metrics.rate.toLocaleString('en-US')}
            <em>evt/s</em>
          </strong>
          <small>Submitted telemetry row updates</small>
        </div>
        <div className="metric">
          <span>APPLIED UPDATES</span>
          <strong>{metrics.applied.toLocaleString('en-US')}</strong>
          <small>
            <span aria-label="Applied row updates / second">
              {metrics.appliedRate.toLocaleString('en-US')} rows/s
            </span>
            {' · '}
            {metrics.received.toLocaleString('en-US')} received
          </small>
        </div>
        <div className="metric accent">
          <span>TRANSACTION WINDOW</span>
          <strong>
            {ASYNC_TRANSACTION_WINDOW_MS} <em>ms</em>
          </strong>
          <small aria-label="Async batches / second">
            {metrics.batchRate.toLocaleString('en-US')} batches/s
          </small>
        </div>
      </div>
      <p className="notice">
        Rates sampled every second: input rows → confirmed row updates → grid
        batches. One batch may contain multiple transactions; batch counts
        include reset/resize work. Row counters cover telemetry only. Fleet size
        is the target while resizing.
      </p>
      <div className="panel">
        <div className="toolbar">
          <label>
            Devices
            <select
              aria-label="Devices"
              disabled={resetting}
              value={count}
              onChange={(e) => resetData(Number(e.target.value))}
            >
              {[100, 1000, 10000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tick interval
            <select
              aria-label="Tick interval"
              value={interval}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
            >
              {[100, 250, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n} ms
                </option>
              ))}
            </select>
          </label>
          <label>
            Changes / tick
            <select
              aria-label="Changes / tick"
              value={changes}
              onChange={(e) => setChanges(Number(e.target.value))}
            >
              {[10, 100, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={burst}
              onChange={(e) => setBurst(e.target.checked)}
            />
            Burst every 8 ticks
          </label>
          <div className="toolbar-end">
            <button className="primary" onClick={() => setRunning((v) => !v)}>
              {running ? 'Pause stream' : 'Start stream'}
            </button>
            <button disabled={resetting} onClick={() => resetData()}>
              Reset data
            </button>
          </div>
        </div>
        <div className="grid-toolbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search live"
              placeholder="Search sensors, locations, status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              aria-label="Show Location"
              checked={showLocation}
              onChange={(e) => {
                setShowLocation(e.target.checked);
                api?.setColumnsVisible(['location'], e.target.checked);
              }}
            />
            Location
          </label>
          <ColumnControls api={api} />
          <button
            onClick={() => {
              if (api) {
                state.resetState(api);
                setSearch('');
                setShowLocation(true);
              }
            }}
          >
            Reset State
          </button>
        </div>
        <div className="grid-frame">
          <AgGridReact<LiveDevice>
            theme={gridTheme}
            rowData={rows}
            columnDefs={liveColumns}
            defaultColDef={defaultColDef}
            getRowId={getRowId}
            quickFilterText={search}
            asyncTransactionWaitMillis={ASYNC_TRANSACTION_WINDOW_MS}
            onAsyncTransactionsFlushed={() => {
              counters.current.batches++;
            }}
            initialState={state.initialState}
            onStateUpdated={(e) => {
              state.onStateUpdated(e);
              setShowLocation(e.api.getColumn('location')?.isVisible() ?? true);
            }}
            onGridPreDestroyed={state.onGridPreDestroyed}
            onGridReady={(e) => {
              e.api.setGridAriaProperty('label', 'Live telemetry grid');
              setApi(e.api);
              setShowLocation(e.api.getColumn('location')?.isVisible() ?? true);
            }}
            enableCellTextSelection
            ensureDomOrder
          />
        </div>
        <div className="grid-footer">
          <span>
            <i className="legend-dot" />
            Normal <i className="legend-dot warning" />
            Warning <i className="legend-dot critical" />
            Critical
          </span>
          <span>
            Click a header to sort · Shift + click for multiple columns
          </span>
        </div>
      </div>
      {resetting && <p role="status">Resetting fleet…</p>}
      <InfoPanel
        model="Client-Side"
        size={count}
        strategy="Async transactions"
        processing="Browser"
        tradeoff="Keeps the current fleet in memory. High-frequency updates only replace changed rows; sorting and filters are recalculated in batches."
      />
    </section>
  );
}
