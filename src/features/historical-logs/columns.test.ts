import { describe, expect, it } from 'vitest';
import { defaultColDef } from '../../shared/grid/base';
import { filterSchemaFor } from '../../shared/grid/filterSchema';
import { historyColumns, historyFilterParams } from './columns';

describe('Historical Logs columns', () => {
  it('shares one filterParams object across every column-level filter', () => {
    expect(historyFilterParams).toEqual({
      debounceMs: 350,
      maxNumConditions: 2,
      inRangeInclusive: true,
    });
  });

  it('reads the timestamp as a UTC date-time, with time included in its own filter', () => {
    const timestamp = historyColumns.find(
      (column) => column.field === 'timestamp',
    );
    expect(timestamp).toMatchObject({
      cellDataType: 'dateTimeString',
      filter: 'agDateColumnFilter',
    });
    expect(timestamp?.filterParams).toMatchObject({
      ...historyFilterParams,
      includeTime: true,
    });
  });

  it('filters value and quality as numbers', () => {
    const value = historyColumns.find((column) => column.field === 'value');
    const quality = historyColumns.find((column) => column.field === 'quality');
    expect(value).toMatchObject({ filter: 'agNumberColumnFilter' });
    expect(quality).toMatchObject({ filter: 'agNumberColumnFilter' });
  });

  it('leaves unit unfiltered and unsortable', () => {
    const unit = historyColumns.find((column) => column.field === 'unit');
    expect(unit).toMatchObject({ filter: false, sortable: false });
  });

  it('derives the same filter schema the query grammar correspondence test expects', () => {
    expect(filterSchemaFor(historyColumns, defaultColDef)).toEqual({
      timestamp: 'date',
      deviceId: 'text',
      location: 'text',
      type: 'text',
      status: 'text',
      message: 'text',
      value: 'number',
      quality: 'number',
    });
  });
});
