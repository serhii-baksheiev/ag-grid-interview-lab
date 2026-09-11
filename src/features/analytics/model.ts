import type { SensorType, Telemetry } from '../../shared/types';
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
export function summarize(rows: Telemetry[]): Summary[] {
  const groups = new Map<string, Summary & { sum: number }>();
  for (const row of rows) {
    const id = JSON.stringify([row.location, row.type, row.unit]);
    const group = groups.get(id) ?? {
      id,
      location: row.location,
      type: row.type,
      unit: row.unit,
      min: Infinity,
      max: -Infinity,
      avg: 0,
      count: 0,
      alerts: 0,
      sum: 0,
    };
    group.min = Math.min(group.min, row.value);
    group.max = Math.max(group.max, row.value);
    group.sum += row.value;
    group.count++;
    group.avg = group.sum / group.count;
    if (row.status === 'warning' || row.status === 'critical') group.alerts++;
    groups.set(id, group);
  }
  return [...groups.values()].map(
    ({ id, location, type, unit, min, max, avg, count, alerts }) => ({
      id,
      location,
      type,
      unit,
      min,
      max,
      avg,
      count,
      alerts,
    }),
  );
}
