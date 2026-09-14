import { useEffect } from 'react';
import type { GridApi } from 'ag-grid-community';
import type { LiveDevice } from '../shared/types';

export interface Transaction {
  update?: LiveDevice[];
  add?: LiveDevice[];
  remove?: LiveDevice[];
}
interface Result {
  update: { data: LiveDevice }[];
  add: { data: LiveDevice }[];
  remove: { data: LiveDevice }[];
}
type Callback = (result: Result) => void;
interface GridProps {
  rowData?: LiveDevice[];
  getRowId?: (params: { data: LiveDevice }) => string;
  asyncTransactionWaitMillis?: number;
  onGridReady?: (event: { api: GridApi<LiveDevice> }) => void;
  onAsyncTransactionsFlushed?: (event: { results: Result[] }) => void;
}

/**
 * A Client-Side Row Model stand-in that reproduces the AG Grid 36.1 async
 * transaction timeline the Live screen relies on (`executeBatchUpdateRowData`):
 *
 * - `applyTransactionAsync` queues; the first call arms one timer for
 *   `asyncTransactionWaitMillis`;
 * - a flush (timer or `flushAsyncTransactions`) applies every queued
 *   transaction synchronously, schedules the transaction callbacks with
 *   `setTimeout(…, 0)`, then dispatches `asyncTransactionsFlushed` synchronously;
 * - after destroy, API calls are refused and counted, like the real grid's
 *   "grid has been destroyed" warning.
 *
 * `rows` is what the grid would display, kept so tests can check the result of
 * the submitted transactions. The screen owns its fleet (`source.ts`), so the
 * fake refuses to hand row data back: `getRowNode` throws.
 */
export function createFakeLiveGrid() {
  const rows = new Map<string, LiveDevice>();
  const transactions: Transaction[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let props: GridProps = {};
  let queue: { transaction: Transaction; callback?: Callback }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let destroyedCalls = 0;
  let flushes = 0;
  const node = (data: LiveDevice) => ({ data });
  const flush = () => {
    const batch = queue;
    queue = [];
    timer = undefined;
    const results: Result[] = [];
    const callbacks: (() => void)[] = [];
    for (const { transaction, callback } of batch) {
      const result: Result = { update: [], add: [], remove: [] };
      for (const row of transaction.remove ?? [])
        if (rows.delete(row.id)) result.remove.push(node(row));
      for (const row of transaction.update ?? [])
        if (rows.has(row.id)) {
          rows.set(row.id, row);
          result.update.push(node(row));
        }
      for (const row of transaction.add ?? []) {
        rows.set(row.id, row);
        result.add.push(node(row));
      }
      results.push(result);
      if (callback) callbacks.push(() => callback(result));
    }
    flushes++;
    if (callbacks.length)
      setTimeout(() => {
        for (const callback of callbacks) callback();
      }, 0);
    if (results.length) props.onAsyncTransactionsFlushed?.({ results });
  };
  const guard = () => {
    if (destroyed) destroyedCalls++;
    return destroyed;
  };
  const api = {
    applyTransactionAsync(transaction: Transaction, callback?: Callback) {
      if (guard()) return;
      transactions.push(transaction);
      if (!timer)
        timer = setTimeout(flush, props.asyncTransactionWaitMillis ?? 50);
      queue.push({ transaction, callback });
    },
    flushAsyncTransactions() {
      if (guard()) return;
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    },
    getRowNode() {
      throw new Error(
        'Live Telemetry must not read its rows back from the grid',
      );
    },
    isDestroyed: () => destroyed,
    setGridAriaProperty() {},
    getColumn: () => ({ isVisible: () => true }),
    getColumns: () => [],
    setColumnsVisible() {},
    // Minimal stand-ins for useGridState's Reset State path: this fake owns
    // rows/transactions, not column or filter state.
    resetColumnState() {},
    setFilterModel() {},
    getState: () => ({}),
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as GridApi<LiveDevice>;
  /** Render in place of `AgGridReact`: seeds rows, fires gridReady, destroys on unmount. */
  function Grid(next: GridProps) {
    props = next;
    useEffect(() => {
      for (const row of props.rowData ?? []) rows.set(row.id, row);
      props.onGridReady?.({ api });
      return () => {
        destroyed = true;
      };
      // The real grid reads rowData once and fires gridReady once per mount.
    }, []);
    return <div role="grid" aria-label="Live telemetry grid" />;
  }
  return {
    api,
    rows,
    transactions,
    Grid,
    props: () => props,
    pending: () => queue.length,
    flushes: () => flushes,
    destroyedCalls: () => destroyedCalls,
  };
}
