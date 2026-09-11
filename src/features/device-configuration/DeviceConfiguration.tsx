import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridApi,
  RowClassParams,
  RowSelectionOptions,
  ValueSetterParams,
} from 'ag-grid-community';
import type { Device } from '../../shared/types';
import { generateDevices } from '../../shared/data/generator';
import { defaultColDef, getRowId, gridTheme } from '../../shared/grid/base';
import { ConfigurationToolbar } from './ConfigurationToolbar';
import { useGridState } from '../../shared/grid/useGridState';
import { InfoPanel } from '../../shared/ui/InfoPanel';
import { configurationColumns } from './columns';
import { isDirty, revertDevices, validateDevice } from './model';

const rowSelection: RowSelectionOptions<Device> = { mode: 'multiRow' };
const copy = (rows: Device[]) => rows.map((row) => ({ ...row }));

export default function DeviceConfiguration() {
  const [rows, setRows] = useState(() => generateDevices(100));
  const [saved, setSaved] = useState(() => generateDevices(100));
  const savedRef = useRef(saved);
  const [api, setApi] = useState<GridApi<Device>>();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [failSave, setFailSave] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const errorsRef = useRef(errors);
  const [, refresh] = useState(0);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const nextId = useRef(101);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gridState = useGridState('configuration');
  useEffect(() => () => clearTimeout(timer.current), []);

  const setValue = useCallback((params: ValueSetterParams<Device, unknown>) => {
    if (savingRef.current || !params.colDef.field) return false;
    const candidate = {
      ...params.data,
      [params.colDef.field]: params.newValue,
    };
    const problems = validateDevice(candidate);
    const nextErrors = { ...errorsRef.current, [candidate.id]: problems };
    errorsRef.current = nextErrors;
    setErrors(nextErrors);
    params.api.refreshCells({ rowNodes: [params.node!], force: true });
    if (Object.keys(problems).length) return false;
    if (params.oldValue === params.newValue) return false;
    Object.assign(params.data, candidate);
    setMessage('');
    setSaveError(false);
    return true;
  }, []);
  const columnDefs = useMemo(() => configurationColumns(), []);
  const defaults = useMemo<ColDef<Device>>(
    () => ({
      ...defaultColDef,
      valueSetter: setValue,
      editable: () => !savingRef.current,
      suppressKeyboardEvent: ({ event }) =>
        savingRef.current &&
        (event.ctrlKey || event.metaKey) &&
        ['z', 'y'].includes(event.key.toLowerCase()),
      cellClassRules: {
        'cell-error': (params) =>
          !!params.data &&
          !!errorsRef.current[params.data.id]?.[params.colDef.field ?? ''],
      },
      tooltipValueGetter: (params) =>
        params.data
          ? (errorsRef.current[params.data.id]?.[
              params.colDef && 'field' in params.colDef
                ? (params.colDef.field ?? '')
                : ''
            ] ?? 'Double-click or press Enter to edit')
          : '',
    }),
    [setValue],
  );
  const rowClassRules = useMemo(
    () => ({
      'row-dirty': (params: RowClassParams<Device>) =>
        !!params.data &&
        isDirty(
          params.data,
          savedRef.current.find((row) => row.id === params.data!.id),
        ),
    }),
    [],
  );
  const baseline = new Map(saved.map((row) => [row.id, row]));
  const dirtyRows = rows.filter((row) => isDirty(row, baseline.get(row.id)));
  const deletedRows = saved.filter(
    (row) => !rows.some((current) => current.id === row.id),
  );
  const dirtyCount = dirtyRows.length + deletedRows.length;
  useEffect(() => {
    if (!dirtyCount) return;
    const warnBeforeExit = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeExit);
    return () => window.removeEventListener('beforeunload', warnBeforeExit);
  }, [dirtyCount]);
  const clearErrors = () => {
    errorsRef.current = {};
    setErrors({});
  };
  const commitBaseline = (next: Device[]) => {
    savedRef.current = next;
    setSaved(next);
    api?.redrawRows();
  };

  function save(ids?: string[]) {
    if (savingRef.current) return;
    api?.stopEditing();
    const selectedIds = ids ? new Set(ids) : undefined;
    const targets = rows.filter(
      (row) => !selectedIds || selectedIds.has(row.id),
    );
    if (targets.some((row) => Object.keys(validateDevice(row)).length)) {
      setSaveError(true);
      setMessage('Correct invalid values before saving.');
      return;
    }
    const snapshot = copy(rows);
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    setMessage('Saving changes…');
    api?.refreshCells({ force: true });
    timer.current = setTimeout(() => {
      if (failSave) {
        setSaveError(true);
        setMessage('Save failed. Your changes are still here.');
      } else {
        const next = selectedIds
          ? [
              ...saved.flatMap((row) => {
                if (!selectedIds.has(row.id)) return [row];
                const updated = snapshot.find(
                  (current) => current.id === row.id,
                );
                return updated ? [updated] : [];
              }),
              ...snapshot.filter(
                (row) =>
                  selectedIds.has(row.id) &&
                  !saved.some((previous) => previous.id === row.id),
              ),
            ]
          : snapshot;
        commitBaseline(copy(next));
        clearErrors();
        setMessage('Saved successfully');
      }
      savingRef.current = false;
      setSaving(false);
      api?.refreshCells({ force: true });
    }, 450);
  }
  function revert(ids?: string[]) {
    api?.stopEditing(true);
    setRows(revertDevices(rows, saved, ids));
    clearErrors();
    setMessage('Changes reverted');
    setSaveError(false);
  }
  function add() {
    api?.stopEditing();
    const id = nextId.current++;
    const row = {
      ...generateDevices(1)[0],
      id: `device-${String(id).padStart(5, '0')}`,
      name: `New sensor ${id}`,
    } as Device;
    setRows((current) => [row, ...current]);
    setMessage('');
    setSaveError(false);
  }
  function confirmDelete() {
    if (savingRef.current) return;
    api?.stopEditing(true);
    setRows((current) => current.filter((row) => !deleteIds.includes(row.id)));
    setDeleteIds([]);
    setSelected([]);
    setMessage(
      'Deletion staged. Save all to confirm or Revert all to restore.',
    );
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
        size={rows.length}
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
        setFailSave={setFailSave}
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
              clearErrors();
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
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaults}
          getRowId={getRowId}
          rowSelection={rowSelection}
          rowClassRules={rowClassRules}
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
          onCellValueChanged={() => {
            refresh((n) => n + 1);
          }}
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
                {row.name}: {baseline.has(row.id) ? 'modified' : 'new device'}
              </li>
            ))}
            {deletedRows.map((row) => (
              <li key={row.id}>{row.name}: pending deletion</li>
            ))}
          </ul>
        )}
      </section>
      <p className="footnote">
        Undo/redo covers cell edits. Sorting, filtering, row replacement and
        column layout or visibility changes clear its history. Undo/Redo is
        locked during Save. Browser text copy and paste inside editors are
        available. Grid range selection and bulk clipboard operations require
        Enterprise.
      </p>
    </section>
  );
}
