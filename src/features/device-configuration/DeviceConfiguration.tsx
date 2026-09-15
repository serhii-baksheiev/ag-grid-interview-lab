import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridApi,
  RowClassRules,
  RowSelectionOptions,
} from 'ag-grid-community';
import type { Device } from '../../shared/types';
import { defaultColDef, getRowId, gridTheme } from '../../shared/grid/base';
import { ConfigurationToolbar } from './ConfigurationToolbar';
import { filterSchemaFor } from '../../shared/grid/filterSchema';
import { useGridState } from '../../shared/grid/useGridState';
import { InfoPanel } from '../../shared/ui/InfoPanel';
import { configurationColumns } from './columns';
import type { ConfigurationStore } from './store';

const rowSelection: RowSelectionOptions<Device> = { mode: 'multiRow' };
const columnDefs = configurationColumns();
const filterSchema = filterSchemaFor(columnDefs, defaultColDef);

/** Column defaults that write through the store and read its save lock and errors. */
function storeColumnDefaults(store: ConfigurationStore): ColDef<Device> {
  const saving = () => store.getSnapshot().saving;
  return {
    ...defaultColDef,
    valueSetter: (params) => {
      const field = params.colDef.field as keyof Device | undefined;
      if (!field) return false;
      const changed = store.edit(params.data.id, field, params.newValue);
      // Error styling for this row may have changed even when the write was refused.
      params.api.refreshCells({ rowNodes: [params.node!], force: true });
      return changed;
    },
    editable: () => !saving(),
    suppressKeyboardEvent: ({ event }) =>
      saving() &&
      (event.ctrlKey || event.metaKey) &&
      ['z', 'y'].includes(event.key.toLowerCase()),
    cellClassRules: {
      'cell-error': (params) =>
        !!params.data &&
        !!store.errorFor(params.data.id, params.colDef.field ?? ''),
    },
    tooltipValueGetter: (params) =>
      params.data
        ? (store.errorFor(
            params.data.id,
            params.colDef && 'field' in params.colDef
              ? (params.colDef.field ?? '')
              : '',
          ) ?? 'Double-click or press Enter to edit')
        : '',
  };
}

export default function DeviceConfiguration({
  store,
}: {
  store: ConfigurationStore;
}) {
  const {
    drafts,
    errors,
    message,
    saveError,
    saving,
    failSave,
    dirtyRows,
    deletedRows,
    dirtyCount,
  } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [api, setApi] = useState<GridApi<Device>>();
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const gridState = useGridState('configuration', filterSchema);
  const defaults = useMemo(() => storeColumnDefaults(store), [store]);
  const dirtyIds = useMemo(
    () => new Set(dirtyRows.map((row) => row.id)),
    [dirtyRows],
  );
  // The grid re-applies row classes when this option changes identity. A save
  // changes no row data, so this is how saved rows lose `row-dirty` without a redraw.
  const rowClassRules = useMemo<RowClassRules<Device>>(
    () => ({ 'row-dirty': ({ data }) => !!data && dirtyIds.has(data.id) }),
    [dirtyIds],
  );
  // Starting and finishing a save changes editability and clears error styling.
  useEffect(() => {
    api?.refreshCells({ force: true });
  }, [api, saving]);

  function save(ids?: string[]) {
    if (saving) return;
    api?.stopEditing();
    // Block mode keeps an invalid editor open; its value has not reached the store.
    if (api?.getEditingCells().length) {
      store.refuseSave();
      return;
    }
    store.save(ids);
  }
  function revert(ids?: string[]) {
    api?.stopEditing(true);
    store.revert(ids);
  }
  function add() {
    api?.stopEditing();
    store.add();
  }
  function confirmDelete() {
    if (saving) return;
    api?.stopEditing(true);
    store.stageDeletion(deleteIds);
    setDeleteIds([]);
    setSelected([]);
    document.getElementById('add-device')?.focus();
  }
  function cancelDelete() {
    setDeleteIds([]);
    document.getElementById('delete-selected')?.focus();
  }
  const validationMessages = Object.entries(errors).flatMap(([id, fields]) =>
    Object.values(fields).map((error) => `${id}: ${error}`),
  );
  return (
    <section aria-label="Device Configuration">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">03 / FLEET MANAGEMENT</p>
          <h1>Device Configuration</h1>
          <p>Edit with confidence. Validate locally, save deliberately.</p>
        </div>
        <span className="badge">EDITABLE CLIENT-SIDE MODEL</span>
      </div>
      <InfoPanel
        model="Client-Side"
        size={drafts.length}
        strategy="Validated cell edits"
        processing="Browser + mock save"
        tradeoff="Pessimistic saves preserve drafts on failure. Saved values last for this session."
      />
      <ConfigurationToolbar
        api={api}
        saving={saving}
        selected={selected}
        dirtyCount={dirtyCount}
        failSave={failSave}
        setFailSave={store.setFailSave}
        add={add}
        save={save}
        revert={revert}
        setDeleteIds={setDeleteIds}
        resetState={gridState.resetState}
      />{' '}
      <div className="notice">
        Enter or double-click to edit · Tab to move · Checkbox to select rows ·
        Warning &lt; critical · Sampling: 1–3,600 seconds
      </div>
      <p aria-live="polite" aria-atomic="true">
        <strong>{dirtyCount} unsaved changes</strong> · {selected.length}{' '}
        selected
      </p>
      {message && (
        <p
          className={saveError ? 'error' : 'notice'}
          role={saveError ? 'alert' : 'status'}
          aria-atomic="true"
        >
          {message}
        </p>
      )}
      {validationMessages.length > 0 && (
        <div className="error" role="alert">
          Edit rejected. {Array.from(new Set(validationMessages)).join(' ')}{' '}
          <button
            onClick={() => {
              store.dismissValidation();
              api?.refreshCells({ force: true });
            }}
          >
            Dismiss validation
          </button>
        </div>
      )}
      {deleteIds.length > 0 && (
        <div
          className="notice"
          role="alertdialog"
          aria-label="Confirm device deletion"
          aria-describedby="delete-description"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancelDelete();
            }
          }}
        >
          <p id="delete-description">
            Stage deletion of {deleteIds.length} selected devices? Revert all
            can restore them until saved.
          </p>
          <button onClick={confirmDelete} disabled={saving}>
            Confirm deletion
          </button>
          <button autoFocus onClick={cancelDelete}>
            Cancel deletion
          </button>
        </div>
      )}
      <div className="grid-frame">
        <AgGridReact<Device>
          theme={gridTheme}
          rowData={drafts}
          columnDefs={columnDefs}
          defaultColDef={defaults}
          getRowId={getRowId}
          rowSelection={rowSelection}
          rowClassRules={rowClassRules}
          // Every validated editor (NameEditor, and the number and select editors
          // through columns.ts) keeps an invalid commit open; the grid marks the
          // input invalid and announces the domain error. The valueSetter still
          // validates writes that bypass an editor, such as a Delete-key clear.
          invalidEditValueMode="block"
          undoRedoCellEditing
          undoRedoCellEditingLimit={30}
          stopEditingWhenCellsLoseFocus
          enableCellTextSelection
          ensureDomOrder
          initialState={gridState.initialState}
          onStateUpdated={gridState.onStateUpdated}
          onGridPreDestroyed={gridState.onGridPreDestroyed}
          onGridReady={(event) => {
            event.api.setGridAriaProperty('label', 'Device configuration grid');
            setApi(event.api);
          }}
          onSelectionChanged={(event) =>
            setSelected(event.api.getSelectedRows().map((row) => row.id))
          }
        />
      </div>
      <section className="panel unsaved-list" aria-label="Unsaved change list">
        <h2>Unsaved change list ({dirtyCount})</h2>
        {dirtyCount === 0 ? (
          <p>No pending changes.</p>
        ) : (
          <ul>
            {dirtyRows.map((row) => (
              <li key={row.id}>
                {row.name}: {store.isNew(row.id) ? 'new device' : 'modified'}
              </li>
            ))}
            {deletedRows.map((row) => (
              <li key={row.id}>{row.name}: pending deletion</li>
            ))}
          </ul>
        )}
      </section>
      <p className="footnote">
        Undo/redo covers cell edits. Sorting, filtering, row replacement, column
        layout or visibility changes and leaving this screen clear its history.
        Undo/Redo is locked during Save. Browser text copy and paste inside
        editors are available. Grid range selection and bulk clipboard
        operations require Enterprise.
      </p>
    </section>
  );
}
