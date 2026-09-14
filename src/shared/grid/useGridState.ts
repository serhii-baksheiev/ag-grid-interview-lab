import { useCallback, useMemo, useRef } from 'react';
import type {
  GridApi,
  GridPreDestroyedEvent,
  StateUpdatedEvent,
} from 'ag-grid-community';
import type { FilterSchema } from './filterSchema';
import type { GridState } from 'ag-grid-community';
import {
  readState,
  readStoredText,
  serializeState,
  writeState,
  writeStoredText,
} from './storage';
/**
 * Persist and restore a grid's view state under a per-grid key. `schema` names
 * the columns that can carry a filter and their filter type, so a stored filter
 * for another column or type never reaches the grid (see `filterSchemaFor`).
 */
export function useGridState(name: string, schema?: FilterSchema) {
  const key = `iot-lab:v1:${name}`;
  const initialState = useMemo(() => {
    const state = readState(key, undefined, schema);
    return state ? { ...state, partialColumnState: true } : undefined;
  }, [key, schema]);
  // The payload last known to be stored. Grid state events also fire for
  // sections this app does not persist (scroll, focus, selection), so an
  // unchanged serialized payload skips the synchronous localStorage write.
  const stored = useRef<{ key: string; text: string | null } | undefined>(
    undefined,
  );
  const persist = useCallback(
    (state: GridState) => {
      const text = serializeState(state);
      if (stored.current?.key !== key)
        stored.current = { key, text: readStoredText(key) };
      if (text === stored.current.text) return;
      // A failed write is not remembered, so the next event tries again.
      if (writeStoredText(key, text)) stored.current = { key, text };
    },
    [key],
  );
  const onStateUpdated = useCallback(
    (event: StateUpdatedEvent) => persist(event.state),
    [persist],
  );
  const onGridPreDestroyed = useCallback(
    (event: GridPreDestroyedEvent) => persist(event.state),
    [persist],
  );
  const resetState = useCallback(
    (api: GridApi) => {
      api.resetColumnState();
      api.setFilterModel(null);
      persist(api.getState());
    },
    [persist],
  );
  const saveView = useCallback(
    (api: GridApi) => writeState(`${key}:saved`, api.getState()),
    [key],
  );
  const restoreView = useCallback(
    (api: GridApi) => {
      const state = readState(`${key}:saved`, undefined, schema);
      if (state) api.setState(state);
      return !!state;
    },
    [key, schema],
  );
  return {
    initialState,
    onStateUpdated,
    onGridPreDestroyed,
    resetState,
    saveView,
    restoreView,
  };
}
