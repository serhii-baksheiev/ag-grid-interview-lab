import type { GridApi } from 'ag-grid-community';
import type { Device } from '../../shared/types';
import { ColumnControls } from '../../shared/grid/ColumnControls';
interface Props {
  api: GridApi<Device> | undefined;
  saving: boolean;
  selected: string[];
  dirtyCount: number;
  failSave: boolean;
  setFailSave: (value: boolean) => void;
  add: () => void;
  save: (ids?: string[]) => void;
  revert: (ids?: string[]) => void;
  setDeleteIds: (ids: string[]) => void;
  resetState: (api: GridApi<Device>) => void;
}
export function ConfigurationToolbar({
  api,
  saving,
  selected,
  dirtyCount,
  failSave,
  setFailSave,
  add,
  save,
  revert,
  setDeleteIds,
  resetState,
}: Props) {
  return (
    <div className="toolbar">
      <button id="add-device" onClick={add} disabled={saving}>
        Add device
      </button>
      <button
        onClick={() => save(selected)}
        disabled={saving || !selected.length}
      >
        Save selected
      </button>
      <button
        className="primary"
        onClick={() => save()}
        disabled={saving || !dirtyCount}
      >
        Save all
      </button>
      <button
        onClick={() => revert(selected)}
        disabled={saving || !selected.length}
      >
        Revert selected
      </button>
      <button onClick={() => revert()} disabled={saving || !dirtyCount}>
        Revert all
      </button>
      <button
        id="delete-selected"
        onClick={() => setDeleteIds([...selected])}
        disabled={saving || !selected.length}
      >
        Delete selected
      </button>
      <button
        onClick={() => api?.undoCellEditing()}
        disabled={saving}
        title="Ctrl/Cmd+Z inside grid"
      >
        Undo
      </button>
      <button
        onClick={() => api?.redoCellEditing()}
        disabled={saving}
        title="Ctrl+Y / Cmd+Shift+Z inside grid"
      >
        Redo
      </button>
      <ColumnControls api={api} />
      <button onClick={() => api && resetState(api)}>Reset State</button>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={failSave}
          disabled={saving}
          onChange={(event) => setFailSave(event.target.checked)}
        />
        Simulate save error
      </label>
    </div>
  );
}
