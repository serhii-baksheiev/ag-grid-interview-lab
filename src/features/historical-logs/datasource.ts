import type { IDatasource, IGetRowsParams } from 'ag-grid-community';
import { historyPage, prepareHistory, type HistoryIndex } from './query';
import { telemetryAt } from '../../shared/data/generator';

export interface RequestEntry {
  id: number;
  range: string;
  query: string;
  status: 'loading' | 'success' | 'error' | 'cancelled';
  duration?: number;
}
export interface DatasourceStatus {
  pending: number;
  error: boolean;
  total?: number;
  requests: RequestEntry[];
}
export function createHistoryDatasource(options: {
  total: number;
  latency: number;
  fail: () => boolean;
  onStatus: (status: DatasourceStatus) => void;
}): IDatasource {
  let destroyed = false,
    signature = '',
    generation = 0,
    sequence = 0,
    pending = 0;
  let controller = new AbortController();
  let index: Promise<HistoryIndex> | undefined;
  let entries: RequestEntry[] = [];
  let failed = false,
    matchedTotal: number | undefined;
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const emit = () => {
    if (!destroyed)
      options.onStatus({
        pending,
        error: failed,
        total: matchedTotal,
        requests: [...entries],
      });
  };
  const delay = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, options.latency);
      timers.set(timer, resolve);
    });
  return {
    getRows(params: IGetRowsParams<ReturnType<typeof telemetryAt>>) {
      const query = JSON.stringify([params.filterModel, params.sortModel]);
      if (signature !== query) {
        signature = query;
        generation++;
        controller.abort();
        controller = new AbortController();
        index = undefined;
        failed = false;
        matchedTotal = undefined;
      }
      const current = generation,
        id = ++sequence,
        started = performance.now();
      const entry: RequestEntry = {
        id,
        range: `${params.startRow}–${params.endRow}`,
        query,
        status: 'loading',
      };
      entries = [entry, ...entries].slice(0, 8);
      pending++;
      emit();
      const execute = async () => {
        try {
          await delay();
          if (destroyed || current !== generation) {
            entry.status = 'cancelled';
            return;
          }
          if (options.fail()) throw new Error('Simulated request failure');
          index ??= prepareHistory({
            total: options.total,
            startRow: 0,
            endRow: 0,
            filterModel: params.filterModel as Record<string, unknown>,
            sortModel: params.sortModel,
            signal: controller.signal,
          });
          const prepared = await index;
          if (destroyed || current !== generation) {
            entry.status = 'cancelled';
            return;
          }
          const page = historyPage(prepared, params.startRow, params.endRow);
          matchedTotal = page.total;
          failed = false;
          entry.status = 'success';
          params.successCallback(page.rows, page.total);
        } catch {
          if (destroyed || current !== generation) {
            entry.status = 'cancelled';
            return;
          }
          failed = true;
          entry.status = 'error';
          index = undefined;
          params.failCallback();
        } finally {
          pending--;
          entry.duration = Math.round(performance.now() - started);
          emit();
        }
      };
      void execute();
    },
    destroy() {
      destroyed = true;
      controller.abort();
      for (const [timer, resolve] of timers) {
        clearTimeout(timer);
        resolve();
      }
      timers.clear();
    },
  };
}
