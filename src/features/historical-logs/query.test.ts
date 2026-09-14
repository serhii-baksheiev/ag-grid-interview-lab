import { describe, expect, it } from 'vitest';
import { telemetryAt } from '../../shared/data/generator';
import { queryHistory } from './query';

describe('historical range queries', () => {
  const base = {
    total: 120,
    startRow: 0,
    endRow: 20,
    filterModel: {},
    sortModel: [],
  };
  it('returns only the requested block and reports the total', async () => {
    const result = await queryHistory({ ...base, startRow: 115, endRow: 200 });
    expect(result.total).toBe(120);
    expect(result.rows).toEqual(
      Array.from({ length: 5 }, (_, index) => telemetryAt(index + 115)),
    );
  });
  it('returns no rows when the range begins after the dataset', async () => {
    expect(
      (await queryHistory({ ...base, startRow: 150, endRow: 170 })).rows,
    ).toEqual([]);
    expect((await queryHistory({ ...base, total: 0 })).total).toBe(0);
  });
  it('filters case-insensitive device text before calculating total', async () => {
    const deviceId = telemetryAt(0).deviceId;
    const result = await queryHistory({
      ...base,
      endRow: 120,
      filterModel: {
        deviceId: {
          filterType: 'text',
          type: 'equals',
          filter: deviceId.toUpperCase(),
        },
      },
    });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(
      result.rows.every(
        (row) => row.deviceId.toLowerCase() === deviceId.toLowerCase(),
      ),
    ).toBe(true);
    expect(result.total).toBe(result.rows.length);
  });
  it('filters case-insensitive contains matches before paginating', async () => {
    const needle = 'DEVICE-0001';
    const expected = Array.from({ length: base.total }, (_, index) =>
      telemetryAt(index),
    ).filter((row) =>
      row.deviceId.toLowerCase().includes(needle.toLowerCase()),
    );
    const result = await queryHistory({
      ...base,
      startRow: 2,
      endRow: 5,
      filterModel: {
        deviceId: { filterType: 'text', type: 'contains', filter: needle },
      },
    });

    expect(expected.length).toBeGreaterThan(5);
    expect(result.total).toBe(expected.length);
    expect(result.rows).toEqual(expected.slice(2, 5));
  });
  it('supports numeric ranges and combined AND conditions', async () => {
    const result = await queryHistory({
      ...base,
      endRow: 120,
      filterModel: {
        value: {
          filterType: 'number',
          operator: 'AND',
          conditions: [
            { filterType: 'number', type: 'greaterThan', filter: 20 },
            { filterType: 'number', type: 'lessThan', filter: 80 },
          ],
        },
      },
    });
    const expected = Array.from({ length: 120 }, (_, i) =>
      telemetryAt(i),
    ).filter((row) => row.value > 20 && row.value < 80);
    expect(result.rows).toEqual(expected);
    expect(result.total).toBe(expected.length);
  });
  it('supports combined OR status filters', async () => {
    const result = await queryHistory({
      ...base,
      endRow: 120,
      filterModel: {
        status: {
          filterType: 'text',
          operator: 'OR',
          conditions: [
            { filterType: 'text', type: 'equals', filter: 'warning' },
            { filterType: 'text', type: 'equals', filter: 'critical' },
          ],
        },
      },
    });
    const expected = Array.from({ length: 120 }, (_, i) =>
      telemetryAt(i),
    ).filter((row) => row.status === 'warning' || row.status === 'critical');
    expect(result.rows).toEqual(expected);
  });
  it('sorts the matching dataset before slicing a page', async () => {
    const result = await queryHistory({
      ...base,
      startRow: 10,
      endRow: 20,
      sortModel: [{ colId: 'value', sort: 'desc' }],
    });
    const expected = Array.from({ length: 120 }, (_, i) => telemetryAt(i))
      .sort((a, b) => b.value - a.value)
      .slice(10, 20);
    expect(result.rows).toEqual(expected);
  });
  it('sorts timestamps in ascending order', async () => {
    const result = await queryHistory({
      ...base,
      sortModel: [{ colId: 'timestamp', sort: 'asc' }],
    });
    expect(result.rows.map((row) => row.timestamp)).toEqual(
      result.rows.map((row) => row.timestamp).sort(),
    );
  });
  it('keeps parallel requests independent', async () => {
    const [first, second] = await Promise.all([
      queryHistory(base),
      queryHistory({ ...base, startRow: 20, endRow: 40 }),
    ]);
    expect(first.rows[0]).toEqual(telemetryAt(0));
    expect(second.rows[0]).toEqual(telemetryAt(20));
  });
  it('honors secondary sort keys for equal primary values', async () => {
    const result = await queryHistory({
      ...base,
      endRow: 120,
      sortModel: [
        { colId: 'type', sort: 'asc' },
        { colId: 'value', sort: 'desc' },
      ],
    });
    const expected = Array.from({ length: 120 }, (_, i) => telemetryAt(i)).sort(
      (a, b) =>
        a.type < b.type ? -1 : a.type > b.type ? 1 : b.value - a.value,
    );
    expect(result.rows).toEqual(expected);
  });
  it('rejects an already aborted query', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      queryHistory({ ...base, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('allows cancelling a large filtered scan while it yields', async () => {
    const controller = new AbortController();
    const pending = queryHistory({
      ...base,
      total: 500_000,
      filterModel: {
        type: { filterType: 'text', type: 'equals', filter: 'temperature' },
      },
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('historical date filters', () => {
  const base = {
    total: 120,
    startRow: 0,
    endRow: 120,
    filterModel: {},
    sortModel: [],
  };
  const all = Array.from({ length: 120 }, (_, i) => telemetryAt(i));
  const at = (offset: number) => telemetryAt(offset).timestamp;
  const naive = (iso: string) => iso.slice(0, 19).replace('T', ' ');

  it('treats the naive filter value as UTC, the zone the column displays', async () => {
    const result = await queryHistory({
      ...base,
      filterModel: {
        timestamp: {
          filterType: 'date',
          type: 'equals',
          dateFrom: '2026-09-01 12:00:05',
        },
      },
    });
    expect(result.rows).toEqual([telemetryAt(5)]);
    expect(result.total).toBe(1);
  });

  it('applies greaterThan, lessThanOrEqual and notEqual at second precision', async () => {
    const after = await queryHistory({
      ...base,
      filterModel: {
        timestamp: {
          filterType: 'date',
          type: 'greaterThan',
          dateFrom: naive(at(100)),
        },
      },
    });
    expect(after.rows).toEqual(all.slice(101));
    const upTo = await queryHistory({
      ...base,
      filterModel: {
        timestamp: {
          filterType: 'date',
          type: 'lessThanOrEqual',
          dateFrom: naive(at(3)),
        },
      },
    });
    expect(upTo.rows).toEqual(all.slice(0, 4));
    const except = await queryHistory({
      ...base,
      filterModel: {
        timestamp: {
          filterType: 'date',
          type: 'notEqual',
          dateFrom: naive(at(0)),
        },
      },
    });
    expect(except.total).toBe(119);
  });

  it('filters an inclusive range before slicing a page', async () => {
    const result = await queryHistory({
      ...base,
      startRow: 2,
      endRow: 4,
      filterModel: {
        timestamp: {
          filterType: 'date',
          type: 'inRange',
          dateFrom: naive(at(10)),
          dateTo: naive(at(19)),
        },
      },
    });
    expect(result.total).toBe(10);
    expect(result.rows).toEqual(all.slice(12, 14));
  });

  it('supports blank checks and combined date conditions', async () => {
    const blank = await queryHistory({
      ...base,
      filterModel: { timestamp: { filterType: 'date', type: 'blank' } },
    });
    expect(blank.total).toBe(0);
    const combined = await queryHistory({
      ...base,
      filterModel: {
        timestamp: {
          filterType: 'date',
          operator: 'OR',
          conditions: [
            { filterType: 'date', type: 'equals', dateFrom: naive(at(1)) },
            { filterType: 'date', type: 'equals', dateFrom: naive(at(7)) },
          ],
        },
      },
    });
    expect(combined.rows).toEqual([telemetryAt(1), telemetryAt(7)]);
  });

  it('matches nothing for an unparseable date value', async () => {
    const result = await queryHistory({
      ...base,
      filterModel: {
        timestamp: { filterType: 'date', type: 'equals', dateFrom: 'soon' },
      },
    });
    expect(result.total).toBe(0);
  });
});
