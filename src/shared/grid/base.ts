import {
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import type { Status } from '../types';
import { createElement } from 'react';
export const gridTheme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 42,
  headerHeight: 42,
  spacing: 6,
  accentColor: '#5277ea',
  borderRadius: 8,
  wrapperBorderRadius: 10,
});
export const defaultColDef = {
  sortable: true,
  resizable: true,
  filter: true,
  minWidth: 115,
  filterParams: { debounceMs: 350 },
} satisfies ColDef;
export const getRowId = (params: { data: { id: string } }) => params.data.id;
export function statusRenderer(
  params: ICellRendererParams<{ status: Status }, Status>,
) {
  const value = params.value;
  const status =
    value && ['normal', 'warning', 'critical', 'offline'].includes(value)
      ? value
      : 'offline';
  return createElement(
    'span',
    { className: `status-pill status-${status}` },
    status,
  );
}
