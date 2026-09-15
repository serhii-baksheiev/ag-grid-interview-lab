// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as generatorModule from '../../shared/data/generator';
import { generateDevices } from '../../shared/data/generator';
import type { Device } from '../../shared/types';
import { createConfigurationStore } from './store';

function fleet(count = 2, seed = 42): Device[] {
  return generateDevices(count, seed);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createConfigurationStore: initial state', () => {
  it('generates the default 100-device fleet exactly once', () => {
    const spy = vi.spyOn(generatorModule, 'generateDevices');
    createConfigurationStore();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(100);
  });

  it('gives drafts and saved independent deep copies of the same generated fleet', () => {
    const store = createConfigurationStore();
    const snapshot = store.getSnapshot();
    expect(snapshot.drafts).toEqual(snapshot.saved);
    expect(snapshot.drafts).not.toBe(snapshot.saved);
    expect(snapshot.drafts[0]).not.toBe(snapshot.saved[0]);
    expect(snapshot.drafts[0]).toEqual(snapshot.saved[0]);
  });

  it('uses provided devices instead of generating a fleet', () => {
    const seed = fleet(2);
    const spy = vi.spyOn(generatorModule, 'generateDevices');
    const store = createConfigurationStore({ devices: seed });
    expect(spy).not.toHaveBeenCalled();
    expect(store.getSnapshot().drafts).toEqual(seed);
    expect(store.getSnapshot().drafts[0]).not.toBe(seed[0]);
  });

  it('starts with no errors, no message, not saving, failSave off', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const snapshot = store.getSnapshot();
    expect(snapshot.errors).toEqual({});
    expect(snapshot.message).toBe('');
    expect(snapshot.saving).toBe(false);
    expect(snapshot.saveError).toBe(false);
    expect(snapshot.failSave).toBe(false);
    expect(snapshot.dirtyCount).toBe(0);
    expect(snapshot.dirtyRows).toEqual([]);
    expect(snapshot.deletedRows).toEqual([]);
  });
});

describe('createConfigurationStore: snapshot and subscription', () => {
  it('returns the same snapshot object until something changes', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b);
  });

  it('returns a new snapshot object after a change', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const a = store.getSnapshot();
    const id = a.drafts[0]!.id;
    store.edit(id, 'location', 'Somewhere else');
    const b = store.getSnapshot();
    expect(b).not.toBe(a);
  });

  it('notifies subscribers on a change and stops after unsubscribing', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Somewhere else');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.edit(id, 'location', 'Somewhere else again');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the drafts array identity across a plain accepted edit, mutating the row in place', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const before = store.getSnapshot();
    const row = before.drafts[0]!;
    const changed = store.edit(row.id, 'location', 'Somewhere else');
    const after = store.getSnapshot();
    expect(changed).toBe(true);
    // Structural identity: an edit alone must never replace rowData, or the
    // grid's native Undo/Redo history would be cleared by AG Grid itself.
    expect(after.drafts).toBe(before.drafts);
    expect(after.drafts[0]).toBe(row);
    expect(after.drafts[0]!.location).toBe('Somewhere else');
  });

  it('replaces the drafts array identity for structural operations: add, stageDeletion and revert', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const afterAdd0 = store.getSnapshot().drafts;
    store.add();
    const afterAdd1 = store.getSnapshot().drafts;
    expect(afterAdd1).not.toBe(afterAdd0);

    const id = afterAdd1[1]!.id;
    store.stageDeletion([id]);
    const afterDelete = store.getSnapshot().drafts;
    expect(afterDelete).not.toBe(afterAdd1);

    store.revert();
    const afterRevert = store.getSnapshot().drafts;
    expect(afterRevert).not.toBe(afterDelete);
  });

  it('does not change the drafts array identity when a save resolves', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 10,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed');
    const beforeSave = store.getSnapshot().drafts;
    store.save();
    vi.advanceTimersByTime(10);
    expect(store.getSnapshot().drafts).toBe(beforeSave);
  });
});

describe('createConfigurationStore: dirtyRows', () => {
  const dirtyIds = (store: ReturnType<typeof createConfigurationStore>) =>
    store.getSnapshot().dirtyRows.map((row) => row.id);

  it('omits an unmodified row and includes it once it differs from the baseline', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const [first, second] = store.getSnapshot().drafts;
    expect(dirtyIds(store)).toEqual([]);
    store.edit(first!.id, 'location', 'Somewhere else');
    expect(dirtyIds(store)).toEqual([first!.id]);
    expect(dirtyIds(store)).not.toContain(second!.id);
  });

  it('includes a newly added row', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    store.add();
    expect(dirtyIds(store)).toContain('device-00101');
  });
});

describe('createConfigurationStore: errorFor', () => {
  it('is undefined before any edit', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    expect(store.errorFor(id, 'name')).toBeUndefined();
  });

  it('reports the domain error recorded by an invalid edit', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'name', '   ');
    expect(store.errorFor(id, 'name')).toBe(
      'Name must contain 1–80 characters.',
    );
  });

  it('clears a previously recorded error once a later edit on the same field is valid', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'name', '   ');
    expect(store.errorFor(id, 'name')).toBeDefined();
    store.edit(id, 'name', 'Valid name');
    expect(store.errorFor(id, 'name')).toBeUndefined();
  });
});

describe('createConfigurationStore: edit', () => {
  it('clears message and saveError on an accepted edit', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    store.refuseSave();
    expect(store.getSnapshot().message).not.toBe('');
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Somewhere else');
    const snapshot = store.getSnapshot();
    expect(snapshot.message).toBe('');
    expect(snapshot.saveError).toBe(false);
  });

  it('rejects an invalid candidate, records the error, and leaves the draft unchanged', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    const original = store.getSnapshot().drafts[0]!.name;
    const changed = store.edit(id, 'name', '   ');
    expect(changed).toBe(false);
    expect(store.getSnapshot().drafts[0]!.name).toBe(original);
    expect(store.getSnapshot().dirtyRows).toEqual([]);
  });

  it('records an empty error entry and returns false for a no-op write of the current value', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const row = store.getSnapshot().drafts[0]!;
    const changed = store.edit(row.id, 'location', row.location);
    expect(changed).toBe(false);
    expect(store.getSnapshot().errors[row.id]).toEqual({});
    expect(store.errorFor(row.id, 'location')).toBeUndefined();
  });

  it('refuses every edit while a save is in flight, without touching drafts or errors', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 1000,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Before save');
    store.save();
    const errorsBefore = store.getSnapshot().errors;
    const changed = store.edit(id, 'location', 'During save');
    expect(changed).toBe(false);
    expect(store.getSnapshot().drafts[0]!.location).toBe('Before save');
    expect(store.getSnapshot().errors).toEqual(errorsBefore);
  });
});

describe('createConfigurationStore: add', () => {
  it('inserts a new sensor at the top with sequential ids starting at device-00101', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    store.add();
    store.add();
    const drafts = store.getSnapshot().drafts;
    expect(drafts[0]).toMatchObject({
      id: 'device-00102',
      name: 'New sensor 102',
    });
    expect(drafts[1]).toMatchObject({
      id: 'device-00101',
      name: 'New sensor 101',
    });
  });

  it('clears any existing message and saveError', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    store.refuseSave();
    store.add();
    const snapshot = store.getSnapshot();
    expect(snapshot.message).toBe('');
    expect(snapshot.saveError).toBe(false);
  });
});

describe('createConfigurationStore: stageDeletion', () => {
  it('removes the drafts and reports the staged-deletion message', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const [first, second] = store.getSnapshot().drafts;
    store.stageDeletion([first!.id]);
    const snapshot = store.getSnapshot();
    expect(snapshot.drafts.map((row) => row.id)).toEqual([second!.id]);
    expect(snapshot.message).toBe(
      'Deletion staged. Save all to confirm or Revert all to restore.',
    );
    expect(snapshot.deletedRows.map((row) => row.id)).toEqual([first!.id]);
  });

  it('is a no-op while a save is in flight', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(2),
      saveDelayMs: 1000,
    });
    const [first] = store.getSnapshot().drafts;
    store.save();
    store.stageDeletion([first!.id]);
    expect(store.getSnapshot().drafts.map((row) => row.id)).toContain(
      first!.id,
    );
    expect(store.getSnapshot().message).toBe('Saving changes…');
  });
});

describe('createConfigurationStore: revert', () => {
  it('reverts every draft to the saved baseline, clears errors and reports the message', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const [first] = store.getSnapshot().drafts;
    store.edit(first!.id, 'name', '');
    store.add();
    store.revert();
    const snapshot = store.getSnapshot();
    expect(snapshot.drafts).toEqual(snapshot.saved);
    expect(snapshot.errors).toEqual({});
    expect(snapshot.message).toBe('Changes reverted');
    expect(snapshot.saveError).toBe(false);
  });

  it('reverts only the selected ids, preserving other drafts', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const [first, second] = store.getSnapshot().drafts;
    store.edit(first!.id, 'location', 'Changed first');
    store.edit(second!.id, 'location', 'Changed second');
    store.revert([first!.id]);
    const snapshot = store.getSnapshot();
    expect(snapshot.drafts.find((row) => row.id === first!.id)!.location).toBe(
      snapshot.saved.find((row) => row.id === first!.id)!.location,
    );
    expect(snapshot.drafts.find((row) => row.id === second!.id)!.location).toBe(
      'Changed second',
    );
  });
});

describe('createConfigurationStore: save', () => {
  it('refuses all rows when any is invalid and no selection is given, without starting a save', () => {
    const invalid = fleet(1).map((row) => ({ ...row, name: '' }));
    const store = createConfigurationStore({ devices: invalid });
    store.save();
    const snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(false);
    expect(snapshot.saveError).toBe(true);
    expect(snapshot.message).toBe('Correct invalid values before saving.');
  });

  it('refuses a selected target that is invalid, even when other drafts are valid', () => {
    const [valid, invalid] = fleet(2);
    invalid!.name = '';
    const store = createConfigurationStore({ devices: [valid!, invalid!] });
    store.save([invalid!.id]);
    const snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(false);
    expect(snapshot.saveError).toBe(true);
    expect(snapshot.message).toBe('Correct invalid values before saving.');
  });

  it('lets a valid selection save even when a different, unselected draft is invalid', () => {
    vi.useFakeTimers();
    const [valid, invalid] = fleet(2);
    invalid!.name = '';
    const store = createConfigurationStore({
      devices: [valid!, invalid!],
      saveDelayMs: 10,
    });
    store.edit(valid!.id, 'location', 'Changed');
    store.save([valid!.id]);
    expect(store.getSnapshot().saving).toBe(true);
    vi.advanceTimersByTime(10);
    expect(store.getSnapshot().message).toBe('Saved successfully');
  });

  it('marks saving in flight immediately, then commits the baseline and clears errors after the delay', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 450,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed location');
    store.save();
    let snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(true);
    expect(snapshot.message).toBe('Saving changes…');
    vi.advanceTimersByTime(450);
    snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(false);
    expect(snapshot.message).toBe('Saved successfully');
    expect(snapshot.saved[0]!.location).toBe('Changed location');
    expect(snapshot.errors).toEqual({});
    expect(snapshot.dirtyCount).toBe(0);
  });

  it('resolves the save after the default 450ms delay when none is configured', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed location');
    store.save();
    vi.advanceTimersByTime(449);
    expect(store.getSnapshot().saving).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().saving).toBe(false);
    expect(store.getSnapshot().message).toBe('Saved successfully');
  });

  it('reports a failed save and keeps the drafts dirty', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 10,
    });
    store.setFailSave(true);
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed location');
    store.save();
    vi.advanceTimersByTime(10);
    const snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(false);
    expect(snapshot.saveError).toBe(true);
    expect(snapshot.message).toBe('Save failed. Your changes are still here.');
    expect(snapshot.dirtyCount).toBe(1);
  });

  it('captures failSave at the moment the save starts, not when it resolves', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 10,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed location');
    store.save();
    store.setFailSave(true);
    vi.advanceTimersByTime(10);
    expect(store.getSnapshot().message).toBe('Saved successfully');
  });

  it('keeps baseline order, replaces selected drafts in place, appends new selected rows, and leaves unselected drafts dirty', () => {
    vi.useFakeTimers();
    const seed = fleet(2);
    const [first, second] = seed;
    const store = createConfigurationStore({ devices: seed, saveDelayMs: 10 });
    store.edit(first!.id, 'location', 'Renamed first');
    store.edit(second!.id, 'location', 'Renamed second');
    store.add();
    const newId = 'device-00101';
    store.save([second!.id, newId]);
    vi.advanceTimersByTime(10);
    const snapshot = store.getSnapshot();
    expect(snapshot.saved.map((row) => row.id)).toEqual([
      first!.id,
      second!.id,
      newId,
    ]);
    expect(snapshot.saved.find((row) => row.id === second!.id)!.location).toBe(
      'Renamed second',
    );
    expect(snapshot.dirtyRows.map((row) => row.id)).toEqual([first!.id]);
  });
});

describe('createConfigurationStore: refuseSave', () => {
  it('reports that an invalid editor is still open', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    store.refuseSave();
    const snapshot = store.getSnapshot();
    expect(snapshot.message).toBe('Correct invalid values before saving.');
    expect(snapshot.saveError).toBe(true);
  });
});

describe('createConfigurationStore: setFailSave', () => {
  it('reflects the flag in the snapshot', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    expect(store.getSnapshot().failSave).toBe(false);
    store.setFailSave(true);
    expect(store.getSnapshot().failSave).toBe(true);
  });
});

describe('createConfigurationStore: dismissValidation', () => {
  it('clears recorded validation errors', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'name', '   ');
    expect(store.errorFor(id, 'name')).toBeDefined();
    store.dismissValidation();
    expect(store.getSnapshot().errors).toEqual({});
    expect(store.errorFor(id, 'name')).toBeUndefined();
  });
});

describe('createConfigurationStore: dispose', () => {
  it('cancels a pending save timer so it never resolves', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 10,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed');
    store.save();
    store.dispose();
    vi.advanceTimersByTime(1000);
    const snapshot = store.getSnapshot();
    expect(snapshot.saving).toBe(true);
    expect(snapshot.message).toBe('Saving changes…');
  });
});

describe('createConfigurationStore: dirty derivations', () => {
  it('computes dirtyRows, deletedRows and dirtyCount from drafts vs saved', () => {
    const store = createConfigurationStore({ devices: fleet(2) });
    const [first, second] = store.getSnapshot().drafts;
    store.edit(first!.id, 'location', 'Changed');
    store.stageDeletion([second!.id]);
    store.add();
    const snapshot = store.getSnapshot();
    expect(snapshot.dirtyRows.map((row) => row.id).sort()).toEqual(
      [first!.id, 'device-00101'].sort(),
    );
    expect(snapshot.deletedRows.map((row) => row.id)).toEqual([second!.id]);
    expect(snapshot.dirtyCount).toBe(3);
  });
});

describe('createConfigurationStore: structural changes while saving', () => {
  it('ignores add and revert while a save is in flight', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 1000,
    });
    const id = store.getSnapshot().drafts[0]!.id;
    store.edit(id, 'location', 'Changed');
    store.save();
    const drafts = store.getSnapshot().drafts;
    store.add();
    store.revert();
    expect(store.getSnapshot().drafts).toBe(drafts);
    expect(store.getSnapshot().drafts[0]!.location).toBe('Changed');
    expect(store.getSnapshot().message).toBe('Saving changes…');
  });
});

describe('createConfigurationStore: isNew', () => {
  it('is true only for a draft the saved baseline does not contain', () => {
    const store = createConfigurationStore({ devices: fleet(1) });
    const id = store.getSnapshot().drafts[0]!.id;
    store.add();
    expect(store.isNew('device-00101')).toBe(true);
    expect(store.isNew(id)).toBe(false);
  });

  it('turns false once the new draft is saved', () => {
    vi.useFakeTimers();
    const store = createConfigurationStore({
      devices: fleet(1),
      saveDelayMs: 10,
    });
    store.add();
    store.save();
    vi.advanceTimersByTime(10);
    expect(store.isNew('device-00101')).toBe(false);
  });
});
