import type { Device } from '../../shared/types';
import { generateDevices } from '../../shared/data/generator';
import { isDirty, revertDevices, validateDevice } from './model';

export type FieldErrors = Record<string, Record<string, string>>;

export interface ConfigurationSnapshot {
  /**
   * The grid's row data. An accepted edit mutates its row in place, so the grid
   * keeps its native undo history; only add, staged deletion and revert
   * replace the array.
   */
  readonly drafts: Device[];
  readonly saved: readonly Device[];
  readonly errors: FieldErrors;
  readonly message: string;
  readonly saveError: boolean;
  readonly saving: boolean;
  readonly failSave: boolean;
  readonly dirtyRows: readonly Device[];
  readonly deletedRows: readonly Device[];
  readonly dirtyCount: number;
}

/**
 * Owns the configuration session outside React: drafts, saved baseline,
 * validation errors and the pending save. It outlives the screen, so leaving
 * Device Configuration and coming back keeps drafts and an in-flight save.
 */
export interface ConfigurationStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ConfigurationSnapshot;
  /** A draft the saved baseline does not contain yet. */
  isNew: (id: string) => boolean;
  errorFor: (id: string, field: string) => string | undefined;
  /** Validates and applies one field value; returns whether the draft changed. */
  edit: (id: string, field: keyof Device, value: unknown) => boolean;
  add: () => void;
  stageDeletion: (ids: string[]) => void;
  revert: (ids?: string[]) => void;
  save: (ids?: string[]) => void;
  /** Reports a save refused because an invalid editor is still open. */
  refuseSave: () => void;
  setFailSave: (value: boolean) => void;
  dismissValidation: () => void;
  dispose: () => void;
}

const INVALID_SAVE_MESSAGE = 'Correct invalid values before saving.';
const DEFAULT_FLEET_SIZE = 100;
const SAVE_DELAY_MS = 450;
const FIRST_NEW_ID = 101;

const copy = (rows: readonly Device[]) => rows.map((row) => ({ ...row }));
const byId = (rows: readonly Device[]) =>
  new Map(rows.map((row) => [row.id, row]));
const isValid = (row: Device) => !Object.keys(validateDevice(row)).length;

export function createConfigurationStore(
  options: { devices?: readonly Device[]; saveDelayMs?: number } = {},
): ConfigurationStore {
  const initial = options.devices ?? generateDevices(DEFAULT_FLEET_SIZE);
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;
  let drafts = copy(initial);
  let saved = copy(initial);
  let draftIndex = byId(drafts);
  let baseline = byId(saved);
  let errors: FieldErrors = {};
  let message = '';
  let saveError = false;
  let saving = false;
  let failSave = false;
  let nextId = FIRST_NEW_ID;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  let dirtyRows: readonly Device[] = [];
  let snapshot = build();

  function build(): ConfigurationSnapshot {
    const dirty = drafts.filter((row) => isDirty(row, baseline.get(row.id)));
    // Kept while the same rows stay dirty, so anything keyed on it (the grid's
    // row class rules) is rebuilt only when the dirty set changes.
    if (
      dirty.length !== dirtyRows.length ||
      dirty.some((row, index) => row !== dirtyRows[index])
    )
      dirtyRows = dirty;
    const deletedRows = saved.filter((row) => !draftIndex.has(row.id));
    return {
      drafts,
      saved,
      errors,
      message,
      saveError,
      saving,
      failSave,
      dirtyRows,
      deletedRows,
      dirtyCount: dirtyRows.length + deletedRows.length,
    };
  }
  function publish() {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }
  function replaceDrafts(next: Device[]) {
    drafts = next;
    draftIndex = byId(next);
  }
  function refuse() {
    saveError = true;
    message = INVALID_SAVE_MESSAGE;
    publish();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isNew: (id) => draftIndex.has(id) && !baseline.has(id),
    errorFor: (id, field) => errors[id]?.[field],
    edit(id, field, value) {
      const row = draftIndex.get(id);
      if (saving || !row) return false;
      const problems = validateDevice({ ...row, [field]: value } as Device);
      errors = { ...errors, [id]: problems };
      const changed = !Object.keys(problems).length && row[field] !== value;
      if (changed) {
        (row as unknown as Record<string, unknown>)[field] = value;
        message = '';
        saveError = false;
      }
      publish();
      return changed;
    },
    add() {
      if (saving) return;
      const id = nextId++;
      replaceDrafts([
        {
          ...generateDevices(1)[0]!,
          id: `device-${String(id).padStart(5, '0')}`,
          name: `New sensor ${id}`,
        },
        ...drafts,
      ]);
      message = '';
      saveError = false;
      publish();
    },
    stageDeletion(ids) {
      if (saving) return;
      const removed = new Set(ids);
      replaceDrafts(drafts.filter((row) => !removed.has(row.id)));
      message =
        'Deletion staged. Save all to confirm or Revert all to restore.';
      publish();
    },
    revert(ids) {
      if (saving) return;
      replaceDrafts(revertDevices(drafts, saved, ids));
      errors = {};
      message = 'Changes reverted';
      saveError = false;
      publish();
    },
    save(ids) {
      if (saving) return;
      const selected = ids ? new Set(ids) : undefined;
      const targets = selected
        ? drafts.filter((row) => selected.has(row.id))
        : drafts;
      if (!targets.every(isValid)) return refuse();
      // Captured now: a later toggle or edit does not change this save.
      const submitted = copy(drafts);
      const fails = failSave;
      saving = true;
      saveError = false;
      message = 'Saving changes…';
      publish();
      timer = setTimeout(() => {
        timer = undefined;
        if (fails) {
          saveError = true;
          message = 'Save failed. Your changes are still here.';
        } else {
          const submittedIndex = byId(submitted);
          const next = selected
            ? [
                ...saved.flatMap((row) => {
                  if (!selected.has(row.id)) return [row];
                  const updated = submittedIndex.get(row.id);
                  return updated ? [updated] : [];
                }),
                ...submitted.filter(
                  (row) => selected.has(row.id) && !baseline.has(row.id),
                ),
              ]
            : submitted;
          saved = copy(next);
          baseline = byId(saved);
          errors = {};
          message = 'Saved successfully';
        }
        saving = false;
        publish();
      }, saveDelayMs);
    },
    refuseSave: refuse,
    setFailSave(value) {
      failSave = value;
      publish();
    },
    dismissValidation() {
      errors = {};
      publish();
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
