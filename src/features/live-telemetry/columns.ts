import type { ColDef } from 'ag-grid-community';
import type { LiveDevice } from '../../shared/types';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';
import { statusRenderer } from '../../shared/grid/base';
export const liveColumns: ColDef<LiveDevice>[] = [
  // Direct row data needs only a field; the status badge needs custom UI.
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
  {
    colId: 'warningDelta',
    headerName: 'Δ to warning',
    headerTooltip:
      'Reading minus warning threshold, in the row’s unit. Negative means below warning; compare within one sensor type.',
    width: 150,
    filter: 'agNumberColumnFilter',
    // Derive a numeric value for sorting/filtering; formatting only changes text.
    valueGetter: ({ data }) =>
      data ? data.value - data.warningThreshold : undefined,
    valueFormatter: ({ value }) => formatNumber(value),
    cellClass: 'numeric-cell',
  },
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
