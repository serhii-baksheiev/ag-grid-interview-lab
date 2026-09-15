import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridApi, IGetRowsParams } from 'ag-grid-community';
import { createHistoryDatasource } from './datasource';
import * as queryEngine from './query';
import { telemetryAt } from '../../shared/data/generator';

function request(
  startRow = 0,
  filterModel: Record<string, unknown> = {},
  sortModel: IGetRowsParams['sortModel'] = [],
): IGetRowsParams {
  // The datasource contract does not read Grid API; supply only its request callbacks.
  return {
    api: {} as GridApi,
    startRow,
    endRow: startRow + 10,
    filterModel,
    sortModel,
    context: undefined,
    successCallback: vi.fn(),
    failCallback: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('asynchronous historical datasource', () => {
  it('delivers parallel blocks independently', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 100,
      fail: () => false,
      onStatus,
    });
    const first = request(),
      second = request(10);
    source.getRows(first);
    source.getRows(second);
    await vi.runAllTimersAsync();
    expect(first.successCallback).toHaveBeenCalledWith(
      Array.from({ length: 10 }, (_, i) => telemetryAt(i)),
      100,
    );
    expect(second.successCallback).toHaveBeenCalledWith(
      Array.from({ length: 10 }, (_, i) => telemetryAt(i + 10)),
      100,
    );
    expect(onStatus.mock.lastCall?.[0].pending).toBe(0);
    source.destroy?.();
  });
  it('does not apply a superseded filter response', async () => {
    vi.useFakeTimers();
    const source = createHistoryDatasource({
      total: 100,
      latency: 100,
      fail: () => false,
      onStatus: vi.fn(),
    });
    const old = request();
    const current = request(0, {
      deviceId: {
        filterType: 'text',
        type: 'equals',
        filter: 'missing-device',
      },
    });
    source.getRows(old);
    source.getRows(current);
    await vi.runAllTimersAsync();
    expect(old.successCallback).not.toHaveBeenCalled();
    expect(old.failCallback).toHaveBeenCalledOnce();
    expect(current.successCallback).toHaveBeenCalledWith([], 0);
    source.destroy?.();
  });
  it('cleans pending latency and emits nothing after destruction', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 500,
      fail: () => false,
      onStatus,
    });
    const pending = request();
    source.getRows(pending);
    source.destroy?.();
    onStatus.mockClear();
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
    expect(onStatus).not.toHaveBeenCalled();
    expect(pending.successCallback).not.toHaveBeenCalled();
    expect(pending.failCallback).toHaveBeenCalledOnce();
  });
  it('retries a failed block without losing the query', async () => {
    vi.useFakeTimers();
    let fail = true;
    const source = createHistoryDatasource({
      total: 100,
      latency: 50,
      fail: () => fail,
      onStatus: vi.fn(),
    });
    const first = request();
    source.getRows(first);
    await vi.runAllTimersAsync();
    expect(first.failCallback).toHaveBeenCalledOnce();
    fail = false;
    const retry = request();
    source.getRows(retry);
    await vi.runAllTimersAsync();
    expect(retry.successCallback).toHaveBeenCalledOnce();
    source.destroy?.();
  });
  it('settles every request once when a filter, sort, and datasource size replace pending work', async () => {
    vi.useFakeTimers();
    const retired = createHistoryDatasource({
      total: 100,
      latency: 500,
      fail: () => false,
      onStatus: vi.fn(),
    });
    const unfiltered = request();
    const filtered = request(0, {
      deviceId: { filterType: 'text', type: 'contains', filter: 'device-0' },
    });
    const sorted = request(0, {}, [{ colId: 'value', sort: 'desc' }]);
    retired.getRows(unfiltered);
    retired.getRows(filtered);
    retired.getRows(sorted);
    retired.destroy?.();

    const replacement = createHistoryDatasource({
      total: 10,
      latency: 0,
      fail: () => false,
      onStatus: vi.fn(),
    });
    const firstBlockForNewSize = request();
    replacement.getRows(firstBlockForNewSize);
    await vi.runAllTimersAsync();

    for (const params of [unfiltered, filtered, sorted, firstBlockForNewSize]) {
      expect(
        vi.mocked(params.successCallback).mock.calls.length +
          vi.mocked(params.failCallback).mock.calls.length,
      ).toBe(1);
    }
    expect(unfiltered.successCallback).not.toHaveBeenCalled();
    expect(filtered.successCallback).not.toHaveBeenCalled();
    expect(sorted.successCallback).not.toHaveBeenCalled();
    expect(firstBlockForNewSize.successCallback).toHaveBeenCalledWith(
      Array.from({ length: 10 }, (_, i) => telemetryAt(i)),
      10,
    );
    replacement.destroy?.();
  });
  it('reports an unsupported filter model as a failed request, never as rows', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => false,
      onStatus,
    });
    const unsupported = request(0, {
      deviceId: { filterType: 'text', type: 'regex', filter: 'device' },
    });
    source.getRows(unsupported);
    await vi.runAllTimersAsync();
    expect(unsupported.successCallback).not.toHaveBeenCalled();
    expect(unsupported.failCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 0,
      error: true,
      failure: 'unsupported',
    });
    source.destroy?.();
  });
  it('reports a simulated request failure distinctly from an unsupported model', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => true,
      onStatus,
    });
    const failing = request();
    source.getRows(failing);
    await vi.runAllTimersAsync();
    expect(failing.successCallback).not.toHaveBeenCalled();
    expect(failing.failCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 0,
      error: true,
      failure: 'request',
    });
    source.destroy?.();
  });
  it('clears error and failure once a later request succeeds', async () => {
    vi.useFakeTimers();
    let fail = true;
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => fail,
      onStatus,
    });
    const failing = request();
    source.getRows(failing);
    await vi.runAllTimersAsync();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      error: true,
      failure: 'request',
    });
    fail = false;
    const retry = request();
    source.getRows(retry);
    await vi.runAllTimersAsync();
    expect(retry.successCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({ error: false });
    expect(onStatus.mock.lastCall?.[0].failure).toBeUndefined();
    source.destroy?.();
  });
  it('fails a request whose filter model cannot be serialised, without throwing from getRows', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => false,
      onStatus,
    });
    const cyclic: Record<string, unknown> = {
      filterType: 'text',
      type: 'contains',
      filter: 'device',
    };
    cyclic.self = cyclic;
    const params = request(0, { deviceId: cyclic });
    expect(() => source.getRows(params)).not.toThrow();
    await vi.runAllTimersAsync();
    expect(params.successCallback).not.toHaveBeenCalled();
    expect(params.failCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 0,
      error: true,
      failure: 'unsupported',
    });
    source.destroy?.();
  });
  it('supersedes a pending query when the next filter model cannot be serialised', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 100,
      fail: () => false,
      onStatus,
    });
    const pending = request();
    source.getRows(pending);
    const cyclic: Record<string, unknown> = {
      filterType: 'text',
      type: 'contains',
      filter: 'device',
    };
    cyclic.self = cyclic;
    const unsupported = request(0, { deviceId: cyclic });
    source.getRows(unsupported);
    await vi.runAllTimersAsync();
    // The older query must not land rows or clear the unsupported failure.
    expect(pending.successCallback).not.toHaveBeenCalled();
    expect(pending.failCallback).toHaveBeenCalledOnce();
    expect(unsupported.failCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 0,
      error: true,
      failure: 'unsupported',
    });
    source.destroy?.();
  });
  it('reports every status after an unserialisable model as that failure, then clears it for the next valid query', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 100,
      fail: () => false,
      onStatus,
    });
    source.getRows(request());
    await vi.runAllTimersAsync();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      total: 100,
      error: false,
    });
    source.getRows(request(10));
    const cyclic: Record<string, unknown> = {
      filterType: 'text',
      type: 'contains',
      filter: 'device',
    };
    cyclic.self = cyclic;
    const before = onStatus.mock.calls.length;
    source.getRows(request(0, { deviceId: cyclic }));
    const emitted = onStatus.mock.calls.slice(before).map(([status]) => status);
    // Cancelling the pending block emits as well; no status may still show the
    // previous query's total or success.
    expect(emitted.length).toBeGreaterThan(1);
    for (const status of emitted)
      expect(status).toMatchObject({
        error: true,
        failure: 'unsupported',
        total: undefined,
      });
    source.getRows(request());
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 1,
      error: false,
    });
    await vi.runAllTimersAsync();
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      pending: 0,
      error: false,
      total: 100,
    });
    source.destroy?.();
  });
  it('settles calls queued after destruction exactly once', () => {
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => false,
      onStatus: vi.fn(),
    });
    source.destroy?.();
    const late = request();
    source.getRows(late);
    source.destroy?.();
    expect(late.failCallback).toHaveBeenCalledOnce();
    expect(late.successCallback).not.toHaveBeenCalled();
  });
  it('cancels an index in flight without applying its eventual rows', async () => {
    vi.useFakeTimers();
    let resolveIndex!: (value: queryEngine.HistoryIndex) => void;
    vi.spyOn(queryEngine, 'prepareHistory').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIndex = resolve;
        }),
    );
    const onStatus = vi.fn();
    const source = createHistoryDatasource({
      total: 100,
      latency: 0,
      fail: () => false,
      onStatus,
    });
    const old = request(0, {}, [{ colId: 'value', sort: 'asc' }]);
    source.getRows(old);
    await vi.advanceTimersByTimeAsync(0);
    const current = request();
    source.getRows(current);
    expect(old.failCallback).toHaveBeenCalledOnce();
    resolveIndex({
      indices: null,
      total: 100,
      stats: { filtered: 0, keyed: 0, mergePasses: 0, yields: 0 },
    });
    await vi.runAllTimersAsync();
    expect(old.successCallback).not.toHaveBeenCalled();
    expect(old.failCallback).toHaveBeenCalledOnce();
    expect(current.successCallback).toHaveBeenCalledOnce();
    expect(onStatus.mock.lastCall?.[0].pending).toBe(0);
    source.destroy?.();
  });
  it('reads latency for each block while retaining the prepared query index', async () => {
    vi.useFakeTimers();
    let latency = 20;
    const prepare = vi.spyOn(queryEngine, 'prepareHistory');
    const source = createHistoryDatasource({
      total: 100,
      latency: () => latency,
      fail: () => false,
      onStatus: vi.fn(),
    });
    const first = request();
    source.getRows(first);
    latency = 200;
    await vi.advanceTimersByTimeAsync(20);
    expect(first.successCallback).toHaveBeenCalledOnce();
    const second = request(10);
    source.getRows(second);
    await vi.advanceTimersByTimeAsync(199);
    expect(second.successCallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.successCallback).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    source.destroy?.();
  });
});
