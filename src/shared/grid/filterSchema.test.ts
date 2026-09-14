import { describe, expect, it } from 'vitest';
import type { ColDef } from 'ag-grid-community';
import { filterSchemaFor } from './filterSchema';

describe('filter schema derived from column definitions', () => {
  const columns: ColDef[] = [
    { field: 'name' },
    { field: 'value', filter: 'agNumberColumnFilter' },
    { field: 'timestamp', filter: 'agDateColumnFilter' },
    { field: 'status', filter: 'agTextColumnFilter' },
    { field: 'unit', filter: false },
    { colId: 'delta', valueGetter: () => 1, filter: 'agNumberColumnFilter' },
    { field: 'enabled', cellDataType: 'boolean' },
  ];

  it('maps each filterable column id to its provided filter type', () => {
    expect(filterSchemaFor(columns, { filter: true })).toEqual({
      name: 'text',
      value: 'number',
      timestamp: 'date',
      status: 'text',
      delta: 'number',
      enabled: 'text',
    });
  });

  it('omits columns without a filter when the default has none', () => {
    expect(filterSchemaFor(columns, {})).toEqual({
      value: 'number',
      timestamp: 'date',
      status: 'text',
      delta: 'number',
    });
  });

  it('ignores filters it cannot map to a persisted filter type', () => {
    expect(
      filterSchemaFor([{ field: 'custom', filter: () => null }], {}),
    ).toEqual({});
  });
});
