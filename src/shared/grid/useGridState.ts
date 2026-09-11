import { useCallback, useMemo } from 'react';
import type {
  GridApi,
  GridPreDestroyedEvent,
  StateUpdatedEvent,
} from 'ag-grid-community';
import { readState, writeState } from './storage';
export function useGridState(name: string) {
  const key = `iot-lab:v1:${name}`;
  const initialState = useMemo(() => {
    const state = readState(key);
    return state ? { ...state, partialColumnState: true } : undefined;
  }, [key]);
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
      const state = readState(`${key}:saved`);
      if (state) api.setState(state);
      return !!state;
    },
    [key],
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
