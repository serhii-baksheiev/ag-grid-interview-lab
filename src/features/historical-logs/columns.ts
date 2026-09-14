import type { ColDef } from 'ag-grid-community';
import type { Telemetry } from '../../shared/types';
import { statusRenderer } from '../../shared/grid/base';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';

// A column-level filterParams replaces the default object, so share the base.
export const historyFilterParams = {
  debounceMs: 350,
  maxNumConditions: 2,
  inRangeInclusive: true,
};
export const historyColumns: ColDef<Telemetry>[] = [
  {
    field: 'timestamp',
    headerName: 'Timestamp · UTC',
    width: 205,
    pinned: 'left',
    valueFormatter: (p) => formatTimestamp(p.value as string | undefined),
    // Filter what is displayed: a date-time picker, read as UTC by the mock query.
    // The floating filter syncs its date into the main filter by the column's
    // data type, not by filterParams, so both must say "with time".
    cellDataType: 'dateTimeString',
    filter: 'agDateColumnFilter',
    filterParams: { ...historyFilterParams, includeTime: true },
  },
  { field: 'deviceId', headerName: 'Device', width: 160 },
  { field: 'location', width: 165 },
  { field: 'type', headerName: 'Sensor type', width: 150 },
  {
    field: 'value',
    width: 115,
    filter: 'agNumberColumnFilter',
    valueFormatter: (p) => formatNumber(p.value as number | undefined),
    cellClass: 'numeric-cell',
  },
  { field: 'unit', width: 110, filter: false, sortable: false },
  { field: 'status', width: 130, cellRenderer: statusRenderer },
  {
    field: 'quality',
    headerName: 'Quality %',
    width: 120,
    filter: 'agNumberColumnFilter',
  },
  { field: 'message', headerName: 'Diagnostic', width: 225 },
];
