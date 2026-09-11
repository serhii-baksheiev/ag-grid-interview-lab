import { describe, expect, it } from 'vitest';
import { telemetryAt } from '../../shared/data/generator';
import { summarize } from './model';

describe('analytics summary', () => {
  it('calculates min, max, average, count and alert count per group', () => {
    const row = telemetryAt(0);
    const result = summarize([
      { ...row, value: 10, status: 'normal' },
      { ...row, id: 'second', value: 20, status: 'warning' },
      { ...row, id: 'third', value: 60, status: 'critical' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      location: row.location,
      type: row.type,
      unit: row.unit,
      min: 10,
      max: 60,
      avg: 30,
      count: 3,
      alerts: 2,
    });
    expect(result[0]!.id).toEqual(expect.any(String));
  });
  it('never aggregates different sensor types, locations or units together', () => {
    const row = telemetryAt(0);
    const rows = [
      row,
      { ...row, id: 'unit', unit: 'different-unit' },
      { ...row, id: 'location', location: 'Different location' },
      { ...row, id: 'type', type: 'battery' as const },
    ];
    const result = summarize(rows);
    expect(result).toHaveLength(4);
    expect(new Set(result.map((group) => group.id)).size).toBe(4);
    expect(result.every((group) => group.count === 1)).toBe(true);
  });
  it('returns empty results for empty input and deterministic summaries otherwise', () => {
    expect(summarize([])).toEqual([]);
    const rows = Array.from({ length: 100 }, (_, i) => telemetryAt(i));
    expect(summarize(rows)).toEqual(summarize(rows));
    expect(summarize(rows).reduce((sum, group) => sum + group.count, 0)).toBe(
      100,
    );
  });
});
