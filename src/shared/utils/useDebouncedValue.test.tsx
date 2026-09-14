import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the initial value', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300));
    expect(result.current[0]).toBe('a');
  });

  it('follows a changed value only after the delay elapses with no further change', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    expect(result.current[0]).toBe('a');
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current[0]).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe('b');
  });

  it('resets the timer on rapid changes, landing on only the last value', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'abc' });
    act(() => {
      // Only 200ms have elapsed since the last change; still pending.
      vi.advanceTimersByTime(200);
    });
    expect(result.current[0]).toBe('a');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current[0]).toBe('abc');
  });

  it('flush sets the value immediately and cancels a pending update', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    act(() => {
      result.current[1]('flushed');
    });
    expect(result.current[0]).toBe('flushed');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // The pending update to 'b' was cancelled by the flush, not merely overtaken.
    expect(result.current[0]).toBe('flushed');
  });

  it('clears its pending timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    const callsBeforeUnmount = clearSpy.mock.calls.length;
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });
});
