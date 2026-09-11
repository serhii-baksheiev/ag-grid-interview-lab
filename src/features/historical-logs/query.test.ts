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
