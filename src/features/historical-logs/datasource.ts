import type { IDatasource, IGetRowsParams } from 'ag-grid-community';
import {
  historyPage,
  prepareHistory,
  UnsupportedQueryError,
  type HistoryIndex,
} from './query';
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
  /** Why the last request failed: a failed request, or a query outside the grammar. */
  failure?: 'request' | 'unsupported';
  total?: number;
  requests: RequestEntry[];
}
export function createHistoryDatasource(options: {
  total: number;
  latency: number | (() => number);
  fail: () => boolean;
  onStatus: (status: DatasourceStatus) => void;
}): IDatasource {
  let destroyed = false,
    signature = '',
    generation = 0,
    sequence = 0;
  let controller = new AbortController();
  let index: Promise<HistoryIndex> | undefined;
  let entries: RequestEntry[] = [];
  let failed = false,
    matchedTotal: number | undefined;
  let failure: DatasourceStatus['failure'];
  const active = new Set<() => void>();
  const emit = () => {
    if (!destroyed)
      options.onStatus({
        pending: active.size,
        error: failed,
        ...(failed ? { failure } : {}),
        total: matchedTotal,
        requests: entries.map((entry) => ({ ...entry })),
      });
  };
  const cancelAll = () => {
    controller.abort();
    for (const cancel of [...active]) cancel();
  };
  return {
    getRows(params: IGetRowsParams<ReturnType<typeof telemetryAt>>) {
      // Even requests queued by the grid before destroy must release its loader slot.
      if (destroyed) {
        params.failCallback();
        return;
      }
      let query: string;
      try {
        query = JSON.stringify([params.filterModel, params.sortModel]);
      } catch {
        // A model JSON cannot encode (cyclic, BigInt) is outside the query grammar.
        // It still replaces the query before it: a response to that query must
        // not land rows or clear this failure.
        signature = '';
        generation++;
        failed = true;
        failure = 'unsupported';
        matchedTotal = undefined;
        cancelAll();
        controller = new AbortController();
        index = undefined;
        try {
          params.failCallback();
        } finally {
          emit();
        }
        return;
      }
      if (signature !== query) {
        signature = query;
        generation++;
        cancelAll();
        controller = new AbortController();
        index = undefined;
        failed = false;
        failure = undefined;
        matchedTotal = undefined;
      }
      const current = generation,
        started = performance.now();
      const entry: RequestEntry = {
        id: ++sequence,
        range: `[${params.startRow}-${params.endRow})`,
        query,
        status: 'loading',
      };
      entries = [entry, ...entries].slice(0, 8);
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let releaseDelay: (() => void) | undefined;
      const finish = (
        status: RequestEntry['status'],
        page?: ReturnType<typeof historyPage>,
        reason: DatasourceStatus['failure'] = 'request',
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        releaseDelay?.();
        active.delete(cancel);
        entry.status = status;
        entry.duration = Math.round(performance.now() - started);
        if (status === 'success' && page) {
          matchedTotal = page.total;
          failed = false;
          failure = undefined;
        } else if (status === 'error') {
          failed = true;
          failure = reason;
        }
        try {
          if (status === 'success' && page)
            params.successCallback(page.rows, page.total);
          else params.failCallback();
        } finally {
          emit();
        }
      };
      const cancel = () => finish('cancelled');
      active.add(cancel);
      emit();
      const execute = async () => {
        try {
          await new Promise<void>((resolve) => {
            releaseDelay = resolve;
            timer = setTimeout(
              resolve,
              typeof options.latency === 'function'
                ? options.latency()
                : options.latency,
            );
          });
          if (settled) return;
          if (destroyed || current !== generation) {
            cancel();
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
          if (settled) return;
          if (destroyed || current !== generation) {
            cancel();
            return;
          }
          finish(
            'success',
            historyPage(prepared, params.startRow, params.endRow),
          );
        } catch (error) {
          if (settled) return;
          if (destroyed || current !== generation) {
            cancel();
            return;
          }
          index = undefined;
          finish(
            'error',
            undefined,
            error instanceof UnsupportedQueryError ? 'unsupported' : 'request',
          );
        }
      };
      void execute();
    },
    destroy() {
      destroyed = true;
      cancelAll();
      index = undefined;
    },
  };
}
