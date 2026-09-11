import type { ColDef } from 'ag-grid-community';
import type { Device } from '../../shared/types';
import { locations } from '../../shared/data/generator';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';
import { statusRenderer } from '../../shared/grid/base';
import { parseNumber } from './model';
import { NameEditor } from './NameEditor';

export function configurationColumns(): ColDef<Device>[] {
  const numeric = (
    field: 'samplingInterval' | 'warningThreshold' | 'criticalThreshold',
    headerName: string,
  ): ColDef<Device> => ({
    field,
    headerName,
    width: 165,
    cellEditor: 'agNumberCellEditor',
    valueParser: (params) => parseNumber(params.newValue),
    valueFormatter: (params) => formatNumber(params.value),
    filter: 'agNumberColumnFilter',
  });
  return [
    {
      field: 'name',
      headerName: 'Device name',
      pinned: 'left',
      width: 225,
      cellEditor: NameEditor,
      valueParser: (params) => String(params.newValue ?? '').trim(),
    },
    {
      field: 'location',
      width: 175,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: locations },
    },
    {
      field: 'enabled',
      width: 115,
      cellDataType: 'boolean',
      cellRenderer: 'agCheckboxCellRenderer',
      cellEditor: 'agCheckboxCellEditor',
    },
    numeric('samplingInterval', 'Sampling (s)'),
    numeric('warningThreshold', 'Warning threshold'),
    numeric('criticalThreshold', 'Critical threshold'),
    { field: 'type', headerName: 'Sensor type', editable: false },
    { field: 'unit', editable: false, width: 115 },
    { field: 'status', editable: false, cellRenderer: statusRenderer },
    { field: 'id', headerName: 'Device ID', editable: false, width: 170 },
    {
      field: 'lastSeen',
      headerName: 'Last seen',
      editable: false,
      width: 205,
      valueFormatter: (params) => formatTimestamp(params.value),
    },
  ];
}
