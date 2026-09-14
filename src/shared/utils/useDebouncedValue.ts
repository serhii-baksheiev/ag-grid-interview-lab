import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Follow `value` only once it has stayed unchanged for `delayMs`. `flush(next)`
 * applies a value at once and cancels the pending update, for changes that
 * should not wait (such as clearing a search on reset).
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
): [debounced: T, flush: (next: T) => void] {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer.current);
  }, [value, delayMs]);
  const flush = useCallback((next: T) => {
    clearTimeout(timer.current);
    setDebounced(next);
  }, []);
  return [debounced, flush];
}
