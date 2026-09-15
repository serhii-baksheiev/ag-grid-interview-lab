import { describe, expect, it, vi } from 'vitest';
import * as generatorModule from '../../shared/data/generator';
import { DEMO_SEED, telemetryAt } from '../../shared/data/generator';
import {
  summarize,
  summarizeHistory,
  summarizeLocations,
  summaryId,
  type LocationSummary,
  type Summary,
} from './model';

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

describe('summaryId', () => {
  it('joins location, type and unit with a pipe', () => {
    expect(summaryId('North plant', 'temperature', '°C')).toBe(
      'North plant|temperature|°C',
    );
  });

  it('is what summarize uses as each group id', () => {
    const row = telemetryAt(0);
    const result = summarize([row]);
    expect(result[0]!.id).toBe(summaryId(row.location, row.type, row.unit));
  });

  it('stays unique across location, type and unit variants', () => {
    const row = telemetryAt(0);
    const rows = [
      row,
      { ...row, id: 'unit', unit: 'different-unit' },
      { ...row, id: 'location', location: 'Different location' },
      { ...row, id: 'type', type: 'battery' as const },
    ];
    const result = summarize(rows);
    expect(
      result.map((group) => summaryId(group.location, group.type, group.unit)),
    ).toEqual(result.map((group) => group.id));
    expect(new Set(result.map((group) => group.id)).size).toBe(4);
  });
});

describe('summarizeHistory parity with summarize over materialised rows', () => {
  it.each([0, 1, 7, 999, 1000, 1001, 10000])(
    'matches summarize(telemetryAt(0..count)) exactly for count=%i (default seed)',
    (count) => {
      const rows = Array.from({ length: count }, (_, i) => telemetryAt(i));
      expect(summarizeHistory(count)).toEqual(summarize(rows));
    },
  );

  it('matches summarize(telemetryAt(0..10000, seed)) exactly for a non-default seed', () => {
    const seed = 7;
    const rows = Array.from({ length: 10000 }, (_, i) => telemetryAt(i, seed));
    expect(summarizeHistory(10000, seed)).toEqual(summarize(rows));
  });

  it('defaults its seed to DEMO_SEED', () => {
    expect(summarizeHistory(500)).toEqual(summarizeHistory(500, DEMO_SEED));
  });

  it('never materialises a Telemetry record while preparing the 10,000-sample summary', () => {
    const spy = vi.spyOn(generatorModule, 'telemetryAt');
    const result = summarizeHistory(10000);
    expect(spy).toHaveBeenCalledTimes(0);
    expect(result).toHaveLength(24);
    expect(result.reduce((sum, group) => sum + group.count, 0)).toBe(10000);
    spy.mockRestore();
  });
});

describe('summarizeLocations', () => {
  function naiveLocationSummaries(summaries: Summary[]): LocationSummary[] {
    const distinctLocations = [...new Set(summaries.map((s) => s.location))];
    return distinctLocations.map((location) => {
      const groups = summaries.filter((s) => s.location === location);
      const count = groups.reduce((sum, g) => sum + g.count, 0);
      const alerts = groups.reduce((sum, g) => sum + g.alerts, 0);
      return { location, count, alerts, rate: (100 * alerts) / count };
    });
  }

  it('matches the naive per-location reduction over the 10,000-sample summary', () => {
    const summaries = summarizeHistory(10000);
    expect(summarizeLocations(summaries)).toEqual(
      naiveLocationSummaries(summaries),
    );
  });

  it('matches the naive per-location reduction for interleaved locations, in first-appearance order', () => {
    const summaries: Summary[] = [
      {
        id: 'a1',
        location: 'A',
        type: 'temperature',
        unit: '°C',
        min: 1,
        max: 2,
        avg: 1.5,
        count: 4,
        alerts: 1,
      },
      {
        id: 'b1',
        location: 'B',
        type: 'humidity',
        unit: '% RH',
        min: 1,
        max: 2,
        avg: 1.5,
        count: 2,
        alerts: 2,
      },
      {
        id: 'a2',
        location: 'A',
        type: 'pressure',
        unit: 'kPa',
        min: 1,
        max: 2,
        avg: 1.5,
        count: 6,
        alerts: 0,
      },
      {
        id: 'c1',
        location: 'C',
        type: 'vibration',
        unit: 'mm/s',
        min: 1,
        max: 2,
        avg: 1.5,
        count: 3,
        alerts: 3,
      },
      {
        id: 'b2',
        location: 'B',
        type: 'battery',
        unit: '% used',
        min: 1,
        max: 2,
        avg: 1.5,
        count: 5,
        alerts: 1,
      },
    ];
    const result = summarizeLocations(summaries);
    expect(result).toEqual(naiveLocationSummaries(summaries));
    expect(result.map((r) => r.location)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty list for an empty summary list', () => {
    expect(summarizeLocations([])).toEqual([]);
  });
});
