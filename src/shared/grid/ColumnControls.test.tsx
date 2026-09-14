import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import { ColumnControls } from './ColumnControls';

/**
 * A grid stub that owns visibility and notifies listeners the way AG Grid does.
 * AG Grid 36.1 registers `api.addEventListener` listeners as asynchronous
 * (`ApiEventService`: only gridPreDestroyed/fillStart/pasteStart are sync), so
 * `async` delivers events on a later task, after the click handler has returned.
 */
function fakeGrid(ids: string[], { async = false } = {}) {
  const visible = new Map(ids.map((id) => [id, true]));
  const listeners = new Map<string, Set<() => void>>();
  const deliver = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const emit = (type: string) =>
    async ? setTimeout(() => deliver(type), 0) : deliver(type);
  let destroyed = false;
  const api = {
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
      listeners.clear();
    },
    getColumns: () =>
      ids.map((id) => ({
        getColId: () => id,
        isVisible: () => visible.get(id)!,
        getColDef: () => ({ headerName: id.toUpperCase() }),
      })),
    setColumnsVisible: vi.fn((keys: string[], show: boolean) => {
      for (const key of keys) visible.set(key, show);
      emit('displayedColumnsChanged');
    }),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    }),
  };
  return { api: api as unknown as GridApi, raw: api, listeners };
}

describe('column controls', () => {
  it('reflects a grid-driven visibility change and toggles from the live state', () => {
    const { api, raw } = fakeGrid(['avg', 'count']);
    render(<ColumnControls api={api} />);
    const average = screen.getByLabelText('AVG') as HTMLInputElement;
    expect(average.checked).toBe(true);

    // Reset State / Restore view / direct API calls change visibility outside React.
    act(() => api.setColumnsVisible(['avg'], false));
    expect(average.checked).toBe(false);

    fireEvent.click(average);
    expect(raw.setColumnsVisible).toHaveBeenLastCalledWith(['avg'], true);
    expect(average.checked).toBe(true);
    expect((screen.getByLabelText('COUNT') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('shows the grid visibility right after a click, before the asynchronous grid event arrives', () => {
    vi.useFakeTimers();
    try {
      const { api, raw } = fakeGrid(['avg'], { async: true });
      render(<ColumnControls api={api} />);
      const average = screen.getByLabelText('AVG') as HTMLInputElement;

      fireEvent.click(average);
      expect(raw.setColumnsVisible).toHaveBeenLastCalledWith(['avg'], false);
      // The grid already hid the column; the checkbox must not show the stale value.
      expect(average.checked).toBe(false);
      act(() => vi.runAllTimers());
      expect(average.checked).toBe(false);

      fireEvent.click(average);
      expect(average.checked).toBe(true);
      act(() => vi.runAllTimers());
      expect(average.checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('subscribes once per grid and removes its listener on unmount', () => {
    const { api, raw, listeners } = fakeGrid(['avg']);
    const { unmount, rerender } = render(<ColumnControls api={api} />);
    rerender(<ColumnControls api={api} />);
    expect(raw.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.get('displayedColumnsChanged')?.size).toBe(1);
    unmount();
    expect(raw.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.get('displayedColumnsChanged')?.size).toBe(0);
  });

  it('does not touch a grid that was destroyed before the control unmounted', () => {
    const { api, raw } = fakeGrid(['avg']);
    const { unmount } = render(<ColumnControls api={api} />);
    raw.destroy();
    unmount();
    expect(raw.removeEventListener).not.toHaveBeenCalled();
  });

  it('renders nothing to toggle before the grid is ready', () => {
    render(<ColumnControls api={undefined} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
