import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GridApi,
  GridPreDestroyedEvent,
  GridState,
  StateUpdatedEvent,
} from 'ag-grid-community';
import { useGridState } from './useGridState';
import { serializeState } from './storage';

function fakeApi(state: GridState): GridApi {
  return {
    getState: () => state,
    resetColumnState: vi.fn(),
    setFilterModel: vi.fn(),
  } as unknown as GridApi;
}
const stateUpdated = (state: GridState) =>
  ({ state }) as unknown as StateUpdatedEvent;
const preDestroyed = (state: GridState) =>
  ({ state }) as unknown as GridPreDestroyedEvent;

const sortAsc: GridState = {
  sort: { sortModel: [{ colId: 'value', sort: 'asc' }] },
};
const sortDesc: GridState = {
  sort: { sortModel: [{ colId: 'value', sort: 'desc' }] },
};

describe('useGridState skips a write when the persisted payload is unchanged', () => {
  let setItem: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => {
    setItem.mockRestore();
  });

  it('writes once for onStateUpdated, and skips an identical second event', () => {
    const { result } = renderHook(() => useGridState('history'));
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('skips a write when only non-persisted sections change (scroll, focusedCell, rowSelection)', () => {
    const { result } = renderHook(() => useGridState('history'));
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() =>
      result.current.onStateUpdated(
        stateUpdated({
          ...sortDesc,
          scroll: { top: 120, left: 0 },
          focusedCell: { colId: 'value', rowIndex: 3, rowPinned: null },
          rowSelection: ['device-00001'],
        }),
      ),
    );
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('writes again when a persisted section actually changes (sort)', () => {
    const { result } = renderHook(() => useGridState('history'));
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.onStateUpdated(stateUpdated(sortAsc)));
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('does not write on mount when localStorage already holds the identical serialized payload', () => {
    localStorage.setItem('iot-lab:v1:history', serializeState(sortDesc));
    const { result } = renderHook(() => useGridState('history'));
    setItem.mockClear();
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('does not throw when setItem fails, and the next identical event tries to write again', () => {
    const { result } = renderHook(() => useGridState('history'));
    setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() =>
      act(() => result.current.onStateUpdated(stateUpdated(sortDesc))),
    ).not.toThrow();
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    // A failed write is not remembered as written: the second identical event
    // retries rather than being skipped as a no-op.
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('applies the same skip rule to onGridPreDestroyed', () => {
    const { result } = renderHook(() => useGridState('history'));
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.onGridPreDestroyed(preDestroyed(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.onGridPreDestroyed(preDestroyed(sortAsc)));
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('applies the same skip rule to resetState', () => {
    const { result } = renderHook(() => useGridState('history'));
    const api = fakeApi(sortDesc);
    act(() => result.current.resetState(api));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.resetState(api));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('writes on the first event when storage holds a different payload', () => {
    localStorage.setItem('iot-lab:v1:history', serializeState(sortAsc));
    const { result } = renderHook(() => useGridState('history'));
    setItem.mockClear();
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('compares with the stored payload of the new key after the key changes', () => {
    const { result, rerender } = renderHook(({ name }) => useGridState(name), {
      initialProps: { name: 'history' },
    });
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    localStorage.setItem('iot-lab:v1:live', serializeState(sortDesc));
    setItem.mockClear();
    rerender({ name: 'live' });
    act(() => result.current.onStateUpdated(stateUpdated(sortDesc)));
    expect(setItem).not.toHaveBeenCalled();
    act(() => result.current.onStateUpdated(stateUpdated(sortAsc)));
    expect(setItem).toHaveBeenLastCalledWith(
      'iot-lab:v1:live',
      serializeState(sortAsc),
    );
  });

  it('saveView always writes its own :saved key, even when identical to the last write', () => {
    const { result } = renderHook(() => useGridState('history'));
    const api = fakeApi(sortDesc);
    act(() => result.current.saveView(api));
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => result.current.saveView(api));
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenLastCalledWith(
      'iot-lab:v1:history:saved',
      expect.any(String),
    );
  });
});
