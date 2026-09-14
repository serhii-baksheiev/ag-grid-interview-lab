import type { ColDef } from 'ag-grid-community';

/** Persisted filter types this application restores; one per provided Community filter. */
export type FilterType = 'text' | 'number' | 'date';
export type FilterSchema = Readonly<Record<string, FilterType>>;

const providedFilters: Record<string, FilterType> = {
  agTextColumnFilter: 'text',
  agNumberColumnFilter: 'number',
  agDateColumnFilter: 'date',
};

/**
 * Derive a column id → filter type map from the column definitions a grid renders,
 * so persisted filter models are validated against the columns that exist rather
 * than a second hand-maintained list. `filter: true` means the default text filter.
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
      filter === true ? 'text' : (providedFilters[String(filter)] ?? undefined);
    if (type) schema[id] = type;
  }
  return schema;
}
