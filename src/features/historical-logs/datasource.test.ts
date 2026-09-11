import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridApi, IGetRowsParams } from 'ag-grid-community';
import { createHistoryDatasource } from './datasource';
import { telemetryAt } from '../../shared/data/generator';

function request(
  startRow = 0,
  filterModel: Record<string, unknown> = {},
): IGetRowsParams {
  // The datasource contract does not read Grid API; supply only its request callbacks.
  return {
    api: {} as GridApi,
    startRow,
    endRow: startRow + 10,
    filterModel,
    sortModel: [],
    context: undefined,
    successCallback: vi.fn(),
    failCallback: vi.fn(),
  };
}

afterEach(() => vi.useRealTimers());

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
    expect(old.failCallback).not.toHaveBeenCalled();
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
    expect(pending.failCallback).not.toHaveBeenCalled();
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
});
