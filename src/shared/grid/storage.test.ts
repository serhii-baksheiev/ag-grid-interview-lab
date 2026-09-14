import { describe, expect, it } from 'vitest';
import type { GridState } from 'ag-grid-community';
import { deserializeState, readState, serializeState } from './storage';

describe('persisted grid state', () => {
  const state: GridState = {
    version: '35.0.0',
    columnOrder: { orderedColIds: ['name', 'value'] },
    columnVisibility: { hiddenColIds: ['id'] },
    sort: { sortModel: [{ colId: 'value', sort: 'desc' }] },
  };
  it('round trips necessary grid view state', () => {
    expect(deserializeState(serializeState(state))).toEqual(state);
  });
  it('discards malformed or unexpected stored data', () => {
    for (const input of [
      null,
      '',
      '{broken',
      'null',
      '[]',
      '42',
      '{"columnOrder":{"orderedColIds":42}}',
      '{"version":"35","sort":{"sortModel":[{"colId":"x","sort":"sideways"}]}}',
    ]) {
      expect(deserializeState(input)).toBeUndefined();
    }
  });

  it.each([
    ['no conditions', []],
    [
      'more conditions than AG Grid supports',
      [
        { filterType: 'text', type: 'contains', filter: 'a' },
        { filterType: 'text', type: 'contains', filter: 'b' },
        { filterType: 'text', type: 'contains', filter: 'c' },
        { filterType: 'text', type: 'contains', filter: 'd' },
        { filterType: 'text', type: 'contains', filter: 'e' },
      ],
    ],
  ])(
    'drops a combined filter with %s without discarding valid view sections',
    (_, conditions) => {
      const persisted = {
        version: '36.1.0',
        columnOrder: { orderedColIds: ['name', 'value'] },
        columnSizing: {
          columnSizingModel: [{ colId: 'name', width: 400 }],
        },
        sort: { sortModel: [{ colId: 'value', sort: 'desc' }] },
        filter: {
          filterModel: {
            name: { filterType: 'text', operator: 'OR', conditions },
          },
        },
      };

      expect(deserializeState(JSON.stringify(persisted))).toEqual({
        version: '36.1.0',
        columnOrder: persisted.columnOrder,
        columnSizing: persisted.columnSizing,
        sort: persisted.sort,
      });
    },
  );

  it.each(['true', 'false'])(
    'preserves a boolean %s filter with the rest of the saved configuration view',
    (type) => {
      const persisted = {
        version: '36.1.0',
        columnOrder: { orderedColIds: ['name', 'enabled', 'samplingInterval'] },
        columnSizing: {
          columnSizingModel: [{ colId: 'name', width: 400 }],
        },
        sort: { sortModel: [{ colId: 'samplingInterval', sort: 'desc' }] },
        filter: {
          filterModel: {
            enabled: { filterType: 'text', type },
          },
        },
      };

      expect(deserializeState(JSON.stringify(persisted))).toEqual(persisted);
    },
  );

  it('ignores unknown safe state data while restoring validated sections', () => {
    const persisted = {
      version: '36.1.0',
      columnOrder: { orderedColIds: ['name', 'value'] },
      futureGridSection: { safeFutureOption: true },
    };

    expect(deserializeState(JSON.stringify(persisted))).toEqual({
      version: persisted.version,
      columnOrder: persisted.columnOrder,
    });
  });

  it.each([
    [
      'an object where a number filter value belongs',
      { filterType: 'number', type: 'equals', filter: { value: 42 } },
    ],
    [
      'a number where a text filter value belongs',
      { filterType: 'text', type: 'contains', filter: 42 },
    ],
    [
      'a nested combined filter',
      {
        filterType: 'text',
        operator: 'AND',
        conditions: [
          {
            filterType: 'text',
            operator: 'OR',
            conditions: [
              { filterType: 'text', type: 'contains', filter: 'nested' },
            ],
          },
        ],
      },
    ],
    [
      'more than the configured two combined conditions',
      {
        filterType: 'text',
        operator: 'OR',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'one' },
          { filterType: 'text', type: 'contains', filter: 'two' },
          { filterType: 'text', type: 'contains', filter: 'three' },
        ],
      },
    ],
  ])('drops %s while retaining a valid sibling filter', (_, badFilter) => {
    const persisted = {
      version: '36.1.0',
      filter: {
        filterModel: {
          name: { filterType: 'text', type: 'contains', filter: 'sensor' },
          unsafe: badFilter,
        },
      },
    };

    expect(deserializeState(JSON.stringify(persisted))).toEqual({
      version: persisted.version,
      filter: {
        filterModel: {
          name: persisted.filter.filterModel.name,
        },
      },
    });
  });

  it('keeps valid sizing, order and sorting when another section is malformed', () => {
    const persisted = {
      version: '36.1.0',
      columnOrder: { orderedColIds: ['name', 'value'] },
      columnSizing: { columnSizingModel: [{ colId: 'name', width: 320 }] },
      sort: { sortModel: [{ colId: 'value', sort: 'desc' }] },
      columnVisibility: { hiddenColIds: 'not an array' },
    };

    expect(deserializeState(JSON.stringify(persisted))).toEqual({
      version: persisted.version,
      columnOrder: persisted.columnOrder,
      columnSizing: persisted.columnSizing,
      sort: persisted.sort,
    });
  });

  it('removes unknown nested properties before giving state to AG Grid', () => {
    const persisted = {
      version: '36.1.0',
      columnSizing: {
        columnSizingModel: [{ colId: 'name', width: 320, inherited: 'nope' }],
        futureOption: true,
      },
      filter: {
        filterModel: {
          name: {
            filterType: 'text',
            type: 'contains',
            filter: 'sensor',
            injected: { nested: true },
          },
        },
      },
    };

    expect(deserializeState(JSON.stringify(persisted))).toEqual({
      version: persisted.version,
      columnSizing: {
        columnSizingModel: [{ colId: 'name', width: 320 }],
      },
      filter: {
        filterModel: {
          name: { filterType: 'text', type: 'contains', filter: 'sensor' },
        },
      },
    });
  });

  it('survives corrupted localStorage and storage access errors', () => {
    localStorage.setItem('test-grid', '{broken');
    expect(readState('test-grid')).toBeUndefined();
    const unavailable = {
      getItem: () => {
        throw new Error('Storage disabled');
      },
    } as unknown as Storage;
    expect(readState('test-grid', unavailable)).toBeUndefined();
  });
});

describe('persisted filter models against a column filter schema', () => {
  const schema = {
    deviceId: 'text',
    value: 'number',
    timestamp: 'date',
  } as const;
  const stored = (filterModel: Record<string, unknown>) =>
    JSON.stringify({ version: '36.1.0', filter: { filterModel } });

  it('drops a filter for a column the grid does not have', () => {
    expect(
      deserializeState(
        stored({
          deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
          ghost: { filterType: 'text', type: 'contains', filter: 'x' },
        }),
        schema,
      ),
    ).toEqual({
      version: '36.1.0',
      filter: {
        filterModel: {
          deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
        },
      },
    });
  });

  it('drops a well-formed filter whose type does not match the column', () => {
    expect(
      deserializeState(
        stored({
          timestamp: { filterType: 'text', type: 'contains', filter: '2026' },
          value: { filterType: 'text', type: 'contains', filter: '4' },
          deviceId: { filterType: 'number', type: 'equals', filter: 4 },
        }),
        schema,
      ),
    ).toBeUndefined();
  });

  it('keeps valid siblings when a mismatched filter is dropped', () => {
    const value = { filterType: 'number', type: 'greaterThan', filter: 40 };
    const timestamp = {
      filterType: 'date',
      type: 'inRange',
      dateFrom: '2026-09-01 12:00:00',
      dateTo: '2026-09-01 12:10:00',
    };
    expect(
      deserializeState(
        stored({
          value,
          timestamp,
          deviceId: {
            filterType: 'date',
            type: 'equals',
            dateFrom: '2026-09-01',
          },
        }),
        schema,
      ),
    ).toEqual({
      version: '36.1.0',
      filter: { filterModel: { value, timestamp } },
    });
  });

  it('applies the schema to every condition of a combined filter', () => {
    expect(
      deserializeState(
        stored({
          value: {
            filterType: 'number',
            operator: 'AND',
            conditions: [
              { filterType: 'number', type: 'greaterThan', filter: 1 },
              { filterType: 'number', type: 'lessThan', filter: 9 },
            ],
          },
          deviceId: {
            filterType: 'number',
            operator: 'AND',
            conditions: [
              { filterType: 'number', type: 'greaterThan', filter: 1 },
              { filterType: 'number', type: 'lessThan', filter: 9 },
            ],
          },
        }),
        schema,
      ),
    ).toEqual({
      version: '36.1.0',
      filter: {
        filterModel: {
          value: {
            filterType: 'number',
            operator: 'AND',
            conditions: [
              { filterType: 'number', type: 'greaterThan', filter: 1 },
              { filterType: 'number', type: 'lessThan', filter: 9 },
            ],
          },
        },
      },
    });
  });

  it('reads a stored view through the schema', () => {
    localStorage.setItem(
      'schema-grid',
      stored({
        value: { filterType: 'text', type: 'contains', filter: 'x' },
        deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
      }),
    );
    expect(readState('schema-grid', undefined, schema)).toEqual({
      version: '36.1.0',
      filter: {
        filterModel: {
          deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
        },
      },
    });
  });

  it('still shape-validates without a schema', () => {
    expect(
      deserializeState(
        stored({
          anything: { filterType: 'number', type: 'equals', filter: 1 },
        }),
      ),
    ).toEqual({
      version: '36.1.0',
      filter: {
        filterModel: {
          anything: { filterType: 'number', type: 'equals', filter: 1 },
        },
      },
    });
  });

  describe("a 'boolean'-schema column", () => {
    const boolSchema = { ...schema, enabled: 'boolean' } as const;

    it('keeps a true/false filter on the boolean column, alongside a valid sibling', () => {
      expect(
        deserializeState(
          stored({
            enabled: { filterType: 'text', type: 'true' },
            deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
          }),
          boolSchema,
        ),
      ).toEqual({
        version: '36.1.0',
        filter: {
          filterModel: {
            enabled: { filterType: 'text', type: 'true' },
            deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
          },
        },
      });
    });

    it.each(['blank', 'notBlank'])('keeps a %s filter', (type) => {
      expect(
        deserializeState(
          stored({ enabled: { filterType: 'text', type } }),
          boolSchema,
        ),
      ).toEqual({
        version: '36.1.0',
        filter: { filterModel: { enabled: { filterType: 'text', type } } },
      });
    });

    it('drops a non-boolean text filter type (contains) on the boolean column', () => {
      expect(
        deserializeState(
          stored({
            enabled: { filterType: 'text', type: 'contains', filter: 'x' },
            deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
          }),
          boolSchema,
        ),
      ).toEqual({
        version: '36.1.0',
        filter: {
          filterModel: {
            deviceId: { filterType: 'text', type: 'contains', filter: 'dev' },
          },
        },
      });
    });
  });

  it("drops a true/false filter on a 'text'-schema column, keeping a valid sibling", () => {
    expect(
      deserializeState(
        stored({
          deviceId: { filterType: 'text', type: 'true' },
          value: { filterType: 'number', type: 'equals', filter: 4 },
        }),
        schema,
      ),
    ).toEqual({
      version: '36.1.0',
      filter: {
        filterModel: {
          value: { filterType: 'number', type: 'equals', filter: 4 },
        },
      },
    });
  });
});
