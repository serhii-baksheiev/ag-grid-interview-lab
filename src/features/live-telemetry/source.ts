import {
  DEMO_SEED,
  generateLiveDevices,
  measurementAt,
  randomAt,
  statusFor,
} from '../../shared/data/generator';
import type { LiveDevice } from '../../shared/types';

/** Rows to add, replace and remove so a grid holding the old fleet shows the new one. */
export interface FleetChanges {
  add: LiveDevice[];
  update: LiveDevice[];
  remove: LiveDevice[];
}
export interface TelemetrySource {
  /** Number of devices currently in the fleet. */
  readonly size: number;
  /** A fresh array of the current fleet in device order (row objects are shared, never mutated). */
  rows(): LiveDevice[];
  /** Advance one tick and return the replacement rows for the devices that changed. */
  tick(options: {
    changes: number;
    burst: boolean;
    lastSeen: string;
  }): LiveDevice[];
  /** Restore the seeded fleet of `size` devices (default: current size) and return the minimal diff. */
  reset(size?: number): FleetChanges;
}

/**
 * The owner of the live fleet. It keeps the current row for every device, in
 * device order, and describes every change as rows a grid can apply in a
 * transaction. The grid displays this state; it is never asked for it.
 */
export function createTelemetrySource(
  size: number,
  seed = DEMO_SEED,
): TelemetrySource {
  let baseline = generateLiveDevices(size, seed);
  let fleet = baseline.slice();
  let tick = 0;
  const differs = (current: LiveDevice, seeded: LiveDevice) =>
    (Object.keys(seeded) as (keyof LiveDevice)[]).some(
      (key) => current[key] !== seeded[key],
    );
  return {
    get size() {
      return fleet.length;
    },
    rows: () => fleet.slice(),
    tick({ changes, burst, lastSeen }) {
      const count = fleet.length;
      tick++;
      // A burst multiplies one tick's changes; each device still changes at most once.
      const amount = Math.min(
        count,
        changes * (burst && tick % 8 === 0 ? 10 : 1),
      );
      const offset = Math.floor(randomAt(tick, seed) * count);
      const updates: LiveDevice[] = [];
      for (let i = 0; i < amount; i++) {
        const index = (offset + i) % count;
        const current = fleet[index]!;
        const value = measurementAt(tick * count + index, current.type, seed);
        const next = {
          ...current,
          value,
          status: statusFor(
            value,
            current.warningThreshold,
            current.criticalThreshold,
          ),
          lastSeen,
        };
        fleet[index] = next;
        updates.push(next);
      }
      return updates;
    },
    reset(next = fleet.length) {
      const seeded =
        next === baseline.length ? baseline : generateLiveDevices(next, seed);
      const kept = Math.min(next, fleet.length);
      const update = seeded
        .slice(0, kept)
        .filter((row, index) => differs(fleet[index]!, row));
      const add = seeded.slice(fleet.length);
      const remove = fleet.slice(next);
      baseline = seeded;
      fleet = seeded.slice();
      tick = 0;
      return { add, update, remove };
    },
  };
}
