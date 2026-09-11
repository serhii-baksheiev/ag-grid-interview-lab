import type { GridState } from 'ag-grid-community';
const sections = [
  'version',
  'columnOrder',
  'columnSizing',
  'columnVisibility',
  'columnPinning',
  'sort',
  'filter',
  'partialColumnState',
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every((v) => typeof v === 'string' && v.length <= 100);
function validFilter(value: unknown, depth = 0): boolean {
  if (
    !object(value) ||
    depth > 2 ||
    !['text', 'number', 'date'].includes(String(value.filterType))
  )
    return false;
  if ('operator' in value)
    return (
      ['AND', 'OR'].includes(String(value.operator)) &&
      Array.isArray(value.conditions) &&
      value.conditions.length <= 4 &&
      value.conditions.every((v) => validFilter(v, depth + 1))
    );
  if (
    ![
      'equals',
      'notEqual',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'lessThan',
      'lessThanOrEqual',
      'greaterThan',
      'greaterThanOrEqual',
      'inRange',
      'blank',
      'notBlank',
    ].includes(String(value.type))
  )
    return false;
  return ['filter', 'filterTo', 'dateFrom', 'dateTo'].every(
    (k) =>
      value[k] === undefined ||
      value[k] === null ||
      (typeof value[k] === 'string' && value[k].length < 500) ||
      (typeof value[k] === 'number' && Number.isFinite(value[k])),
  );
}
export function serializeState(state: GridState): string {
  return JSON.stringify(
    Object.fromEntries(
      sections
        .filter((key) => state[key] !== undefined)
        .map((key) => [key, state[key]]),
    ),
  );
}
export function deserializeState(text: string | null): GridState | undefined {
  try {
    if (!text || text.length > 50000) return undefined;
    const v: unknown = JSON.parse(text);
    if (!object(v) || typeof v.version !== 'string' || v.version.length > 30)
      return undefined;
    if (
      v.partialColumnState !== undefined &&
      typeof v.partialColumnState !== 'boolean'
    )
      return undefined;
    for (const [section, key] of [
      ['columnOrder', 'orderedColIds'],
      ['columnVisibility', 'hiddenColIds'],
    ] as const) {
      if (
        v[section] !== undefined &&
        (!object(v[section]) || !strings(v[section][key]))
      )
        return undefined;
    }
    if (
      v.columnPinning !== undefined &&
      (!object(v.columnPinning) ||
        !strings(v.columnPinning.leftColIds) ||
        !strings(v.columnPinning.rightColIds))
    )
      return undefined;
    if (
      v.columnSizing !== undefined &&
      (!object(v.columnSizing) ||
        !Array.isArray(v.columnSizing.columnSizingModel) ||
        v.columnSizing.columnSizingModel.length > 100 ||
        !v.columnSizing.columnSizingModel.every(
          (c) =>
            object(c) &&
            typeof c.colId === 'string' &&
            ['width', 'flex'].every(
              (key) =>
                c[key] === undefined ||
                (typeof c[key] === 'number' &&
                  Number.isFinite(c[key]) &&
                  c[key] >= 0 &&
                  c[key] <= 10000),
            ),
        ))
    )
      return undefined;
    if (
      v.sort !== undefined &&
      (!object(v.sort) ||
        !Array.isArray(v.sort.sortModel) ||
        v.sort.sortModel.length > 100 ||
        !v.sort.sortModel.every(
          (s) =>
            object(s) &&
            typeof s.colId === 'string' &&
            ['asc', 'desc'].includes(String(s.sort)),
        ))
    )
      return undefined;
    if (
      v.filter !== undefined &&
      (!object(v.filter) ||
        !object(v.filter.filterModel) ||
        Object.keys(v.filter.filterModel).length > 100 ||
        !Object.values(v.filter.filterModel).every((f) => validFilter(f)))
    )
      return undefined;
    // Cast follows explicit validation; unknown sections are discarded, never handed to Grid API.
    return Object.fromEntries(
      sections
        .filter((key) => v[key] !== undefined)
        .map((key) => [key, v[key]]),
    ) as GridState;
  } catch {
    return undefined;
  }
}
export function readState(
  key: string,
  storage?: Storage,
): GridState | undefined {
  try {
    return deserializeState((storage ?? localStorage).getItem(key));
  } catch {
    return undefined;
  }
}
export function writeState(key: string, state: GridState): boolean {
  try {
    localStorage.setItem(key, serializeState(state));
    return true;
  } catch {
    return false;
  }
}
