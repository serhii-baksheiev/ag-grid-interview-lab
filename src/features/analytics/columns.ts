import type { ColDef } from 'ag-grid-community';
import { formatNumber } from '../../shared/utils/format';
import type { Summary } from './model';

export const analyticsColumns: ColDef<Summary>[] = [
  { field: 'location', pinned: 'left', width: 180 },
  { field: 'type', headerName: 'Sensor type', width: 150 },
  { field: 'unit', width: 115 },
  ...(['min', 'max', 'avg', 'count', 'alerts'] as const).map((field) => ({
    field,
    headerName:
      field === 'avg' ? 'Average' : field[0].toUpperCase() + field.slice(1),
    filter: 'agNumberColumnFilter',
    width: 125,
    valueFormatter: ({ value }: { value: number }) => formatNumber(value),
  })),
  {
    colId: 'alertRate',
    headerName: 'Alert rate',
    valueGetter: (p) => (p.data ? (100 * p.data.alerts) / p.data.count : 0),
    valueFormatter: (p) => `${formatNumber(p.value)}%`,
    filter: 'agNumberColumnFilter',
    width: 135,
  },
];
