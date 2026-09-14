import { useCallback, useMemo } from 'react';
import type {
  GridApi,
  GridPreDestroyedEvent,
  StateUpdatedEvent,
} from 'ag-grid-community';
import type { FilterSchema } from './filterSchema';
import { readState, writeState } from './storage';
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
  const onStateUpdated = useCallback(
    (event: StateUpdatedEvent) => {
      writeState(key, event.state);
    },
    [key],
  );
  const onGridPreDestroyed = useCallback(
    (event: GridPreDestroyedEvent) => {
      writeState(key, event.state);
    },
    [key],
  );
  const resetState = useCallback(
    (api: GridApi) => {
      api.resetColumnState();
      api.setFilterModel(null);
      writeState(key, api.getState());
    },
    [key],
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
