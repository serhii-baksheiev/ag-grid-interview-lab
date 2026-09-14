import type { ColDef, IErrorValidationParams } from 'ag-grid-community';
import type { Device } from '../../shared/types';
import { locations } from '../../shared/data/generator';
import { formatNumber, formatTimestamp } from '../../shared/utils/format';
import { statusRenderer } from '../../shared/grid/base';
import { fieldError, parseNumber } from './model';
import { NameEditor } from './NameEditor';

/**
 * The provided editors' `getValidationErrors` hook, answered by the domain rule
 * for one field. With `invalidEditValueMode="block"` an error keeps the editor
 * open, and the grid marks its input `aria-invalid` and announces the message.
 * The editor's own errors (for example an unknown select value) come first.
 */
function domainValidation(
  field: keyof Device,
  parse: (value: unknown) => unknown = (value) => value,
) {
  return ({
    value,
    cellEditorParams,
    internalErrors,
  }: IErrorValidationParams<Device, unknown>) => {
    const error = fieldError(cellEditorParams.data, field, parse(value));
    const errors = [...(internalErrors ?? []), ...(error ? [error] : [])];
    return errors.length ? errors : null;
  };
}

export function configurationColumns(): ColDef<Device>[] {
  const numeric = (
    field: 'samplingInterval' | 'warningThreshold' | 'criticalThreshold',
    headerName: string,
  ): ColDef<Device> => ({
    field,
    headerName,
    width: 165,
    cellEditor: 'agNumberCellEditor',
    // An empty input reaches the hook as NaN, which the domain rule rejects.
    cellEditorParams: {
      getValidationErrors: domainValidation(field, parseNumber),
    },
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
      cellEditorParams: {
        values: locations,
        getValidationErrors: domainValidation('location'),
      },
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
      // Declared, not inferred: the persisted-filter schema must know this is a date column.
      cellDataType: 'dateTimeString',
      valueFormatter: (params) => formatTimestamp(params.value),
    },
  ];
}
