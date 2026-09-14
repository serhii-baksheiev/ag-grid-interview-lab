import {
  DEMO_SEED,
  locationIndexAt,
  locations,
  measurementAt,
  sensorSpecs,
  sensorTypeIndexAt,
  statusFor,
} from '../../shared/data/generator';
import {
  sensorTypes,
  type SensorType,
  type Status,
  type Telemetry,
} from '../../shared/types';
export interface Summary {
  id: string;
  location: string;
  type: SensorType;
  unit: string;
  min: number;
  max: number;
  avg: number;
  count: number;
  alerts: number;
}
export interface LocationSummary {
  location: string;
  count: number;
  alerts: number;
  rate: number;
}
/** Stable group identity: one row per location, sensor type and unit. */
export function summaryId(location: string, type: string, unit: string) {
  return `${location}|${type}|${unit}`;
}

// One accumulator serves both entry points, so the index-native path cannot
// drift from the record-based one: same order of additions, same arithmetic.
type Group = Summary & { sum: number };
function createGroup(location: string, type: SensorType, unit: string): Group {
  return {
    id: summaryId(location, type, unit),
    location,
    type,
    unit,
    min: Infinity,
    max: -Infinity,
    avg: 0,
    count: 0,
    alerts: 0,
    sum: 0,
  };
}
function add(group: Group, value: number, status: Status) {
  group.min = Math.min(group.min, value);
  group.max = Math.max(group.max, value);
  group.sum += value;
  group.count++;
  group.avg = group.sum / group.count;
  if (status === 'warning' || status === 'critical') group.alerts++;
}
function publish(group: Group): Summary {
  const { id, location, type, unit, min, max, avg, count, alerts } = group;
  return { id, location, type, unit, min, max, avg, count, alerts };
}

export function summarize(rows: Telemetry[]): Summary[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const id = summaryId(row.location, row.type, row.unit);
    let group = groups.get(id);
    if (!group) {
      group = createGroup(row.location, row.type, row.unit);
      groups.set(id, group);
    }
    add(group, row.value, row.status);
  }
  return [...groups.values()].map(publish);
}

/**
 * Summarise the first `count` historical records without building them: each
 * record's location, type, reading and status are read from its index. Groups
 * keep first-appearance order, exactly as `summarize` over those records would.
 */
export function summarizeHistory(count: number, seed = DEMO_SEED): Summary[] {
  // The unit follows the type, so location × type identifies a group.
  const slots: (Group | undefined)[] = [];
  const order: Group[] = [];
  for (let index = 0; index < count; index++) {
    const typeIndex = sensorTypeIndexAt(index);
    const locationIndex = locationIndexAt(index);
    const slot = locationIndex * sensorTypes.length + typeIndex;
    const type = sensorTypes[typeIndex];
    const spec = sensorSpecs[type];
    let group = slots[slot];
    if (!group) {
      group = createGroup(locations[locationIndex]!, type, spec.unit);
      slots[slot] = group;
      order.push(group);
    }
    const value = measurementAt(index, type, seed);
    add(group, value, statusFor(value, spec.warning, spec.critical));
  }
  return order.map(publish);
}

/** Alert share per location, in one pass over the summaries. */
export function summarizeLocations(summaries: Summary[]): LocationSummary[] {
  const byLocation = new Map<string, { count: number; alerts: number }>();
  for (const { location, count, alerts } of summaries) {
    const totals = byLocation.get(location);
    if (totals) {
      totals.count += count;
      totals.alerts += alerts;
    } else byLocation.set(location, { count, alerts });
  }
  return [...byLocation].map(([location, { count, alerts }]) => ({
    location,
    count,
    alerts,
    rate: (100 * alerts) / count,
  }));
}
