import type { ColDef } from 'ag-grid-community';
import type { LiveDevice } from '../../shared/types';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';
import { statusRenderer } from '../../shared/grid/base';
export const liveColumns: ColDef<LiveDevice>[] = [
  { field: 'name', headerName: 'Sensor', pinned: 'left', width: 205 },
  { field: 'status', width: 125, cellRenderer: statusRenderer },
  {
    field: 'value',
    headerName: 'Reading',
    width: 130,
    filter: 'agNumberColumnFilter',
    enableCellChangeFlash: true,
    valueFormatter: (p) => formatNumber(p.value),
    cellClass: 'numeric-cell',
  },
  { field: 'unit', width: 110 },
  { field: 'type', headerName: 'Sensor type', width: 140 },
  { field: 'location', headerName: 'Location', width: 155 },
  {
    field: 'quality',
    headerName: 'Quality %',
    filter: 'agNumberColumnFilter',
    width: 120,
  },
  {
    field: 'lastSeen',
    headerName: 'Last seen',
    width: 200,
    valueFormatter: (p) => formatTimestamp(p.value),
  },
  { field: 'id', headerName: 'Device ID', hide: true, width: 180 },
];
