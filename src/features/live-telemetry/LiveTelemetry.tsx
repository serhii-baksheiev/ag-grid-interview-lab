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
export default function LiveTelemetry() {
  const [count, setCount] = useState(1000);
  const [rows, setRows] = useState(() => generateLiveDevices(1000));
  const [api, setApi] = useState<GridApi<LiveDevice>>();
  const [running, setRunning] = useState(true);
  const [interval, setIntervalMs] = useState(250);
  const [changes, setChanges] = useState(100);
  const [burst, setBurst] = useState(false);
  const [search, setSearch] = useState('');
  const [showLocation, setShowLocation] = useState(true);
  const [metrics, setMetrics] = useState({ received: 0, applied: 0, rate: 0 });
  const counters = useRef({ received: 0, applied: 0, tick: 0 });
  const state = useGridState('live');
  useEffect(() => {
    if (!api || !running) return;
    const timer = window.setInterval(() => {
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
    let previous = 0;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const current = counters.current;
      setMetrics({
        received: current.received,
        applied: current.applied,
        rate: Math.round(
          ((current.received >= previous
            ? current.received - previous
            : current.received) *
            1000) /
            (now - last),
        ),
      });
      previous = current.received;
      last = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  function resetData(next = count) {
    api?.flushAsyncTransactions();
    setCount(next);
    setRows(generateLiveDevices(next));
    counters.current = { received: 0, applied: 0, tick: 0 };
    setMetrics({ received: 0, applied: 0, rate: 0 });
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
          <small>Local observed input rate</small>
        </div>
        <div className="metric">
          <span>APPLIED UPDATES</span>
          <strong>{metrics.applied.toLocaleString('en-US')}</strong>
          <small>
            {metrics.received.toLocaleString('en-US')} received · async batching
          </small>
        </div>
        <div className="metric accent">
          <span>TRANSACTION WINDOW</span>
          <strong>
            50<em>ms</em>
          </strong>
          <small>Coalesced by AG Grid</small>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <label>
            Devices
            <select
              aria-label="Devices"
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
            <button onClick={() => resetData()}>Reset data</button>
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
            asyncTransactionWaitMillis={50}
            initialState={state.initialState}
            onStateUpdated={(e) => {
              state.onStateUpdated(e);
              setShowLocation(e.api.getColumn('location')?.isVisible() ?? true);
            }}
            onGridPreDestroyed={state.onGridPreDestroyed}
            onGridReady={(e) => {
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
