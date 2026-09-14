// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTelemetrySource } from './source';
import {
  DEMO_SEED,
  generateLiveDevices,
  measurementAt,
  randomAt,
  statusFor,
} from '../../shared/data/generator';
import type { LiveDevice } from '../../shared/types';

const LAST_SEEN = '2026-02-01T00:00:00.000Z';

function offsetFor(tick: number, size: number, seed = DEMO_SEED) {
  return Math.floor(randomAt(tick, seed) * size);
}

function indicesFor(
  tick: number,
  size: number,
  amount: number,
  seed = DEMO_SEED,
) {
  const offset = offsetFor(tick, size, seed);
  return Array.from({ length: amount }, (_, i) => (offset + i) % size);
}

function amountFor(
  size: number,
  changes: number,
  tick: number,
  burst: boolean,
) {
  return Math.min(size, changes * (burst && tick % 8 === 0 ? 10 : 1));
}

function withoutLastSeen(rows: LiveDevice[]) {
  return rows.map((row) => {
    const rest: Partial<LiveDevice> = { ...row };
    delete rest.lastSeen;
    return rest;
  });
}

describe('createTelemetrySource', () => {
  it('starts with the seeded fleet, in device order', () => {
    const source = createTelemetrySource(50);
    expect(source.size).toBe(50);
    expect(source.rows()).toEqual(generateLiveDevices(50, DEMO_SEED));
  });

  it('returns a fresh array from rows() each call, sharing row objects until they change', () => {
    const source = createTelemetrySource(10);
    const a = source.rows();
    const b = source.rows();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a[0]).toBe(b[0]);
  });

  it('produces the expected replacement rows for a normal tick', () => {
    const size = 20;
    const changes = 5;
    const source = createTelemetrySource(size);
    const before = source.rows();

    const updated = source.tick({ changes, burst: false, lastSeen: LAST_SEEN });

    const tickNumber = 1;
    const amount = amountFor(size, changes, tickNumber, false);
    const indices = indicesFor(tickNumber, size, amount);
    expect(amount).toBe(changes);
    expect(updated).toHaveLength(amount);
    expect(new Set(updated.map((row) => row.id)).size).toBe(amount);

    updated.forEach((row, i) => {
      const index = indices[i]!;
      const original = before[index]!;
      const value = measurementAt(tickNumber * size + index, original.type);
      expect(row.id).toBe(original.id);
      expect(row.value).toBe(value);
      expect(row.status).toBe(
        statusFor(value, original.warningThreshold, original.criticalThreshold),
      );
      expect(row.lastSeen).toBe(LAST_SEEN);
      // Every other field is untouched.
      expect(row.name).toBe(original.name);
      expect(row.type).toBe(original.type);
      expect(row.location).toBe(original.location);
      expect(row.quality).toBe(original.quality);
      expect(row.unit).toBe(original.unit);
      expect(row.enabled).toBe(original.enabled);
      expect(row.samplingInterval).toBe(original.samplingInterval);
      expect(row.warningThreshold).toBe(original.warningThreshold);
      expect(row.criticalThreshold).toBe(original.criticalThreshold);
      // The row object handed out before the tick is not mutated in place.
      expect(row).not.toBe(original);
      expect(original.lastSeen).not.toBe(LAST_SEEN);
    });

    // rows() reflects the tick.
    const after = source.rows();
    updated.forEach((row, i) => {
      const index = indices[i]!;
      expect(after[index]).toEqual(row);
    });
  });

  it('replaces contiguous, wrapped-around positions starting at the tick offset', () => {
    const size = 12;
    const changes = 8; // larger than size - offset, so the run wraps
    const source = createTelemetrySource(size);
    const updated = source.tick({ changes, burst: false, lastSeen: LAST_SEEN });
    const indices = indicesFor(1, size, amountFor(size, changes, 1, false));
    expect(updated.map((row) => row.id)).toEqual(
      indices.map((index) => `device-${String(index + 1).padStart(5, '0')}`),
    );
  });

  it('applies a burst (10x) only on every 8th tick when burst is enabled', () => {
    const size = 1000;
    const changes = 50;
    const source = createTelemetrySource(size);
    for (let tick = 1; tick <= 7; tick++) {
      const updated = source.tick({
        changes,
        burst: true,
        lastSeen: LAST_SEEN,
      });
      expect(updated).toHaveLength(changes);
    }
    const eighth = source.tick({ changes, burst: true, lastSeen: LAST_SEEN });
    expect(eighth).toHaveLength(changes * 10);
  });

  it('never ticks without burst enabled produce more than `changes` rows, even on the 8th tick', () => {
    const size = 1000;
    const changes = 50;
    const source = createTelemetrySource(size);
    for (let tick = 1; tick <= 8; tick++) {
      const updated = source.tick({
        changes,
        burst: false,
        lastSeen: LAST_SEEN,
      });
      expect(updated).toHaveLength(changes);
    }
  });

  it('caps a burst tick at one update per row, with no duplicate ids, when changes*10 exceeds the fleet size', () => {
    const size = 50;
    const changes = 20; // changes * 10 = 200 > size
    const source = createTelemetrySource(size);
    for (let tick = 1; tick < 8; tick++) {
      source.tick({ changes, burst: true, lastSeen: LAST_SEEN });
    }
    const eighth = source.tick({ changes, burst: true, lastSeen: LAST_SEEN });
    expect(eighth).toHaveLength(size);
    expect(new Set(eighth.map((row) => row.id)).size).toBe(size);
  });

  it('produces an identical sequence of ticks for two sources sharing a seed', () => {
    const size = 100;
    const changes = 15;
    const seed = 7;
    const a = createTelemetrySource(size, seed);
    const b = createTelemetrySource(size, seed);
    for (let tick = 1; tick <= 20; tick++) {
      const burst = tick % 3 === 0;
      const fromA = a.tick({ changes, burst, lastSeen: LAST_SEEN });
      const fromB = b.tick({ changes, burst, lastSeen: LAST_SEEN });
      expect(fromB).toEqual(fromA);
    }
  });

  it('produces a different sequence for a different seed', () => {
    const size = 100;
    const changes = 15;
    const a = createTelemetrySource(size, 7);
    const b = createTelemetrySource(size, 9);
    let sawDifference = false;
    for (let tick = 1; tick <= 5; tick++) {
      const fromA = a.tick({ changes, burst: false, lastSeen: LAST_SEEN });
      const fromB = b.tick({ changes, burst: false, lastSeen: LAST_SEEN });
      if (JSON.stringify(fromA) !== JSON.stringify(fromB)) sawDifference = true;
    }
    expect(sawDifference).toBe(true);
  });

  it('reset() after ticks restores exactly the changed rows and nothing else', () => {
    const size = 50;
    const changes = 10;
    const source = createTelemetrySource(size);
    const changedIds = new Set<string>();
    for (let tick = 1; tick <= 3; tick++) {
      const updated = source.tick({
        changes,
        burst: false,
        lastSeen: LAST_SEEN,
      });
      for (const row of updated) changedIds.add(row.id);
    }

    const diff = source.reset();

    expect(diff.add).toHaveLength(0);
    expect(diff.remove).toHaveLength(0);
    expect(new Set(diff.update.map((row) => row.id))).toEqual(changedIds);
    const seeded = generateLiveDevices(size);
    expect(diff.update).toEqual(
      expect.arrayContaining(seeded.filter((row) => changedIds.has(row.id))),
    );
    expect(source.rows()).toEqual(seeded);
    expect(source.size).toBe(size);
  });

  it('reset() with nothing changed returns three empty arrays', () => {
    const source = createTelemetrySource(30);
    const result = source.reset();
    expect(result).toEqual({ add: [], update: [], remove: [] });
    expect(source.rows()).toEqual(generateLiveDevices(30));
  });

  it('restarts the tick counter after a reset', () => {
    const size = 40;
    const changes = 6;
    const source = createTelemetrySource(size);
    for (let tick = 1; tick <= 4; tick++) {
      source.tick({ changes, burst: false, lastSeen: LAST_SEEN });
    }
    source.reset();

    const nextTick = source.tick({
      changes,
      burst: false,
      lastSeen: LAST_SEEN,
    });
    const fresh = createTelemetrySource(size);
    const freshFirstTick = fresh.tick({
      changes,
      burst: false,
      lastSeen: 'irrelevant-for-comparison',
    });

    expect(withoutLastSeen(nextTick)).toEqual(withoutLastSeen(freshFirstTick));
  });

  it('resizing up (100 -> 250) adds the new positions and updates only changed rows among the first 100', () => {
    const size = 100;
    const source = createTelemetrySource(size);
    // changes === size: the first tick touches every row, so "changed" is unambiguous.
    source.tick({ changes: size, burst: false, lastSeen: LAST_SEEN });

    const result = source.reset(250);

    const seeded250 = generateLiveDevices(250);
    expect(result.remove).toHaveLength(0);
    expect(result.add).toEqual(seeded250.slice(100, 250));
    expect(result.update).toEqual(seeded250.slice(0, 100));
    expect(source.rows()).toEqual(seeded250);
    expect(source.size).toBe(250);
  });

  it('resizing down (1000 -> 100) removes the trailing devices and adds nothing', () => {
    const source = createTelemetrySource(1000);
    const result = source.reset(100);

    const seeded1000 = generateLiveDevices(1000);
    expect(result.add).toHaveLength(0);
    expect(result.update).toHaveLength(0);
    expect(result.remove).toEqual(seeded1000.slice(100, 1000));
    expect(result.remove.map((row) => row.id)).toEqual(
      Array.from(
        { length: 900 },
        (_, i) => `device-${String(i + 101).padStart(5, '0')}`,
      ),
    );
    expect(source.rows()).toEqual(generateLiveDevices(100));
    expect(source.size).toBe(100);
  });

  it('keeps stable, position-based device IDs across ticks, resets and resizes', () => {
    const source = createTelemetrySource(10);
    source.tick({ changes: 5, burst: false, lastSeen: LAST_SEEN });
    source.reset(20);
    source.tick({ changes: 5, burst: false, lastSeen: LAST_SEEN });
    source.reset(5);

    source.rows().forEach((row, i) => {
      expect(row.id).toBe(`device-${String(i + 1).padStart(5, '0')}`);
    });
  });

  it('ticks a fleet of size 0 without producing rows or NaN', () => {
    const source = createTelemetrySource(0);
    expect(source.size).toBe(0);
    expect(source.rows()).toEqual([]);
    const updated = source.tick({
      changes: 10,
      burst: true,
      lastSeen: LAST_SEEN,
    });
    expect(updated).toEqual([]);
    const result = source.reset();
    expect(result).toEqual({ add: [], update: [], remove: [] });
  });
});
