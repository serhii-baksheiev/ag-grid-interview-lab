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
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 100 &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 100 &&
  v.every(id) &&
  new Set(v).size === v.length;
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

// Reconstruct supported fields. The UI uses the default maxNumConditions=2.
function filter(
  v: unknown,
  child = false,
): Record<string, unknown> | undefined {
  if (!object(v) || !['text', 'number', 'date'].includes(String(v.filterType)))
    return;
  const filterType = v.filterType;
  if ('operator' in v || 'conditions' in v) {
    if (
      child ||
      !['AND', 'OR'].includes(String(v.operator)) ||
      !Array.isArray(v.conditions) ||
      v.conditions.length < 1 ||
      v.conditions.length > 2
    )
      return;
    const conditions = v.conditions.map((c) => filter(c, true));
    if (conditions.some((c) => !c || c.filterType !== filterType)) return;
    return { filterType, operator: v.operator, conditions };
  }
  const type = v.type;
  const noValue = [
    'blank',
    'notBlank',
    ...(filterType === 'text' ? ['true', 'false'] : []),
  ];
  if (noValue.includes(String(type))) return { filterType, type };
  if (filterType === 'text') {
    if (
      ![
        'equals',
        'notEqual',
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
      ].includes(String(type)) ||
      typeof v.filter !== 'string' ||
      v.filter.length > 500
    )
      return;
    return { filterType, type, filter: v.filter };
  }
  if (
    ![
      'equals',
      'notEqual',
      'lessThan',
      'lessThanOrEqual',
      'greaterThan',
      'greaterThanOrEqual',
      'inRange',
    ].includes(String(type))
  )
    return;
  if (filterType === 'number') {
    if (!finite(v.filter) || (type === 'inRange' && !finite(v.filterTo)))
      return;
    return {
      filterType,
      type,
      filter: v.filter,
      ...(type === 'inRange' ? { filterTo: v.filterTo } : {}),
    };
  }
  const date = (s: unknown) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(s) &&
    Number.isFinite(Date.parse(s));
  if (!date(v.dateFrom) || (type === 'inRange' && !date(v.dateTo))) return;
  return {
    filterType,
    type,
    dateFrom: v.dateFrom,
    dateTo: type === 'inRange' ? v.dateTo : null,
  };
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
    if (!text || text.length > 50000) return;
    const v: unknown = JSON.parse(text);
    if (
      !object(v) ||
      typeof v.version !== 'string' ||
      !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(v.version)
    )
      return;
    const safe: Record<string, unknown> = { version: v.version };
    for (const [section, key] of [
      ['columnOrder', 'orderedColIds'],
      ['columnVisibility', 'hiddenColIds'],
    ] as const) {
      if (object(v[section]) && strings(v[section][key]))
        safe[section] = { [key]: v[section][key] };
    }
    if (
      object(v.columnPinning) &&
      strings(v.columnPinning.leftColIds) &&
      strings(v.columnPinning.rightColIds)
    ) {
      safe.columnPinning = {
        leftColIds: v.columnPinning.leftColIds,
        rightColIds: v.columnPinning.rightColIds,
      };
    }
    if (
      object(v.columnSizing) &&
      Array.isArray(v.columnSizing.columnSizingModel) &&
      v.columnSizing.columnSizingModel.length <= 100
    ) {
      const model = v.columnSizing.columnSizingModel;
      if (
        model.every(
          (c) =>
            object(c) &&
            id(c.colId) &&
            ['width', 'flex'].every(
              (k) =>
                c[k] === undefined ||
                (finite(c[k]) && c[k] >= 0 && c[k] <= 10000),
            ),
        )
      ) {
        safe.columnSizing = {
          columnSizingModel: model.map((c) => ({
            colId: c.colId,
            ...(c.width !== undefined ? { width: c.width } : {}),
            ...(c.flex !== undefined ? { flex: c.flex } : {}),
          })),
        };
      }
    }
    if (
      object(v.sort) &&
      Array.isArray(v.sort.sortModel) &&
      v.sort.sortModel.length <= 100 &&
      v.sort.sortModel.every(
        (s) =>
          object(s) && id(s.colId) && ['asc', 'desc'].includes(String(s.sort)),
      )
    ) {
      safe.sort = {
        sortModel: v.sort.sortModel.map((s) => ({
          colId: s.colId,
          sort: s.sort,
        })),
      };
    }
    if (
      object(v.filter) &&
      object(v.filter.filterModel) &&
      Object.keys(v.filter.filterModel).length <= 100
    ) {
      const entries = Object.entries(v.filter.filterModel).flatMap(
        ([key, value]) => {
          const validated = id(key) ? filter(value) : undefined;
          return validated ? [[key, validated]] : [];
        },
      );
      if (entries.length || !Object.keys(v.filter.filterModel).length)
        safe.filter = { filterModel: Object.fromEntries(entries) };
    }
    if (typeof v.partialColumnState === 'boolean')
      safe.partialColumnState = v.partialColumnState;
    return Object.keys(safe).length > 1 ? (safe as GridState) : undefined;
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
