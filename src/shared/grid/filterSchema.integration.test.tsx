import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi } from 'ag-grid-community';
import './register';
import { defaultColDef } from './base';
import { filterSchemaFor, type FilterType } from './filterSchema';
import { liveColumns } from '../../features/live-telemetry/columns';
import { configurationColumns } from '../../features/device-configuration/columns';
import { analyticsColumns } from '../../features/analytics/Analytics';
import { summarize } from '../../features/analytics/model';
import {
  generateDevices,
  generateLiveDevices,
  telemetryAt,
} from '../data/generator';

// AG Grid's own default-filter choice per resolved cell data type (Community).
// A column the grid refuses to infer (custom parser/getter) reports `false` and
// gets the text filter, the same fallback the schema applies.
const defaultFilterFor: Record<string, FilterType | undefined> = {
  false: 'text',
  undefined: 'text',
  text: 'text',
  // AG Grid's own default filter for a boolean-typed column still emits a
  // text-typed 'true'/'false' filterModel; the schema tracks the intent as
  // 'boolean' so restoration can restrict the accepted text filter types.
  boolean: 'boolean',
  object: 'text',
  number: 'number',
  date: 'date',
  dateString: 'date',
  dateTime: 'date',
  dateTimeString: 'date',
};
const provided: Record<string, FilterType | undefined> = {
  agTextColumnFilter: 'text',
  agNumberColumnFilter: 'number',
  agDateColumnFilter: 'date',
};

function resolvedSchema(api: GridApi) {
  const schema: Record<string, FilterType> = {};
  for (const column of api.getColumns() ?? []) {
    const def = column.getColDef();
    const filter = def.filter ?? defaultColDef.filter;
    if (!filter) continue;
    // After inference the grid writes the data type it resolved back onto the definition.
    const type =
      filter === true
        ? defaultFilterFor[String(def.cellDataType)]
        : provided[String(filter)];
    if (type) schema[column.getColId()] = type;
  }
  return schema;
}

async function mount<T>(columns: ColDef<T>[], rows: T[]) {
  let api: GridApi | undefined;
  render(
    <div style={{ height: 400 }}>
      <AgGridReact<T>
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        onGridReady={(event) => {
          api = event.api;
        }}
      />
    </div>,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!api) throw new Error('grid did not become ready');
  return api;
}

/**
 * The persisted-filter schema must agree with what AG Grid actually resolves
 * for each client-side screen, including the cell data types it INFERS from row
 * values (an ISO string column becomes a date filter without any declaration).
 * A column whose declared and inferred types disagree would persist a filter the
 * schema then drops on restore.
 */
describe('filter schema against AG Grid column resolution', () => {
  it.each([
    ['live telemetry', liveColumns, generateLiveDevices(3)],
    ['device configuration', configurationColumns(), generateDevices(3)],
    [
      'analytics',
      analyticsColumns,
      summarize(Array.from({ length: 60 }, (_, i) => telemetryAt(i))),
    ],
  ] as const)('matches the %s grid', async (_, columns, rows) => {
    const api = await mount(columns as ColDef<unknown>[], rows as unknown[]);
    const expected = resolvedSchema(api);
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(
      filterSchemaFor(columns as ColDef<unknown>[], defaultColDef),
    ).toEqual(expected);
    api.destroy();
  });
});
