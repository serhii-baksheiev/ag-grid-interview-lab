import { describe, expect, it } from 'vitest';
import { statusRenderer } from '../../shared/grid/base';
import { liveColumns } from './columns';

describe('live telemetry columns', () => {
  it('keeps the sensor name as a direct row-data field', () => {
    const sensor = liveColumns.find((column) => column.field === 'name');

    expect(sensor).toMatchObject({ field: 'name', headerName: 'Sensor' });
    expect(sensor).not.toHaveProperty('valueGetter');
    expect(sensor).not.toHaveProperty('valueFormatter');
    expect(sensor).not.toHaveProperty('cellRenderer');
  });

  it('derives the delta to the warning threshold without a renderer', () => {
    const delta = liveColumns.find((column) => column.colId === 'warningDelta');
    const valueGetter = delta?.valueGetter;
    const valueFormatter = delta?.valueFormatter;

    expect(delta).toMatchObject({
      headerName: 'Δ to warning',
      filter: 'agNumberColumnFilter',
    });
    expect(typeof valueGetter).toBe('function');
    expect(typeof valueFormatter).toBe('function');
    if (typeof valueGetter === 'function') {
      expect(
        valueGetter({ data: { value: 23.5, warningThreshold: 20 } } as never),
      ).toBe(3.5);
      expect(
        valueGetter({ data: { value: 17.5, warningThreshold: 20 } } as never),
      ).toBe(-2.5);
      expect(
        valueGetter({ data: { value: 20, warningThreshold: 20 } } as never),
      ).toBe(0);
      expect(valueGetter({ data: undefined } as never)).toBeUndefined();
    }
    if (typeof valueFormatter === 'function') {
      expect(valueFormatter({ value: -2.5 } as never)).toBe('-2.5');
      expect(valueFormatter({ value: 0 } as never)).toBe('0');
    }
    expect(delta).not.toHaveProperty('field');
    expect(delta).not.toHaveProperty('cellRenderer');
  });

  it('formats the raw reading as text while leaving its numeric value available', () => {
    const reading = liveColumns.find((column) => column.field === 'value');
    const valueFormatter = reading?.valueFormatter;

    expect(typeof valueFormatter).toBe('function');
    if (typeof valueFormatter === 'function')
      expect(valueFormatter({ value: 1234.567 } as never)).toBe('1,234.57');
    expect(reading).toMatchObject({ filter: 'agNumberColumnFilter' });
    expect(reading).not.toHaveProperty('valueGetter');
    expect(reading).not.toHaveProperty('cellRenderer');
  });

  it('uses the status renderer for the badge UI', () => {
    const status = liveColumns.find((column) => column.field === 'status');

    expect(status?.cellRenderer).toBe(statusRenderer);
  });
});
