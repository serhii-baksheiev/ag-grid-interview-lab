import type { ColDef } from 'ag-grid-community';

/**
 * Persisted filter types this application restores: one per provided Community
 * filter, plus `boolean` for the text filter AG Grid gives a boolean column,
 * whose models are text-typed `true`/`false`.
 */
export type FilterType = 'text' | 'number' | 'date' | 'boolean';
export type FilterSchema = Readonly<Record<string, FilterType>>;

// Prototype-free so a filter named like an Object method maps to nothing.
const providedFilters: Record<string, FilterType> = Object.assign(
  Object.create(null),
  {
    agTextColumnFilter: 'text',
    agNumberColumnFilter: 'number',
    agDateColumnFilter: 'date',
  },
);

// `filter: true` resolves by cell data type, as AG Grid's default filter does.
const defaultFilterByDataType: Record<string, FilterType> = Object.assign(
  Object.create(null),
  {
    number: 'number',
    boolean: 'boolean',
    date: 'date',
    dateString: 'date',
    dateTime: 'date',
    dateTimeString: 'date',
  },
);

/**
 * Derive a column id → filter type map from the column definitions a grid renders,
 * so persisted filter models are validated against the columns that exist rather
 * than a second hand-maintained list. `filter: true` follows the column's declared
 * `cellDataType` (number → number, boolean → boolean, date types → date,
 * otherwise text); a column
 * that relies on inferred data types must name its filter explicitly.
 */
export function filterSchemaFor<T>(
  columns: readonly ColDef<T>[],
  defaults: Pick<ColDef<T>, 'filter'> = {},
): FilterSchema {
  const schema: Record<string, FilterType> = {};
  for (const column of columns) {
    const id = column.colId ?? column.field;
    const filter = column.filter ?? defaults.filter;
    if (!id || !filter) continue;
    const type =
      filter === true
        ? (defaultFilterByDataType[String(column.cellDataType)] ?? 'text')
        : providedFilters[String(filter)];
    if (type) schema[id] = type;
  }
  return schema;
}
