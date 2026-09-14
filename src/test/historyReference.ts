import { telemetryAt } from '../shared/data/generator';
import type { Telemetry } from '../shared/types';

export interface ReferenceQuery {
  total: number;
  filterModel: Record<string, unknown>;
  sortModel: { colId: string; sort: string }[];
}

// --- everything below is a verbatim copy of today's `query.ts` predicate and
// sort-key logic (see `git show HEAD:src/features/historical-logs/query.ts`),
// applied to a fully materialised row instead of an index-native accessor.
// It exists only so the optimized engine has a slow, obviously-correct
// ground truth to be checked against; it is never meant to be fast.

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function utcMs(value: unknown): number {
  const match =
    typeof value === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(value)
      : null;
  return match
    ? Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      )
    : NaN;
}

function scalar(n: number, type: unknown, from: number, to: number): boolean {
  if (Number.isNaN(from) || (type === 'inRange' && Number.isNaN(to)))
    return false;
  switch (type) {
    case 'equals':
      return n === from;
    case 'notEqual':
      return n !== from;
    case 'greaterThan':
      return n > from;
    case 'greaterThanOrEqual':
      return n >= from;
    case 'lessThan':
      return n < from;
    case 'lessThanOrEqual':
      return n <= from;
    case 'inRange':
      return n >= from && n <= to;
    default:
      return true;
  }
}

function matches(value: unknown, raw: unknown): boolean {
  const model = record(raw);
  if (!model) return true;
  if (Array.isArray(model.conditions)) {
    return model.operator === 'OR'
      ? model.conditions.some((condition) => matches(value, condition))
      : model.conditions.every((condition) => matches(value, condition));
  }
  if (model.type === 'blank') return value == null || value === '';
  if (model.type === 'notBlank') return value != null && value !== '';
  if (model.filterType === 'number')
    return scalar(
      Number(value),
      model.type,
      Number(model.filter),
      Number(model.filterTo),
    );
  if (model.filterType === 'date')
    return scalar(
      Date.parse(String(value)),
      model.type,
      utcMs(model.dateFrom),
      utcMs(model.dateTo),
    );
  const text = String(value ?? '').toLowerCase(),
    filter = String(model.filter ?? '').toLowerCase();
  switch (model.type) {
    case 'equals':
      return text === filter;
    case 'notEqual':
      return text !== filter;
    case 'notContains':
      return !text.includes(filter);
    case 'startsWith':
      return text.startsWith(filter);
    case 'endsWith':
      return text.endsWith(filter);
    default:
      return text.includes(filter);
  }
}

function field(row: Telemetry, key: string): unknown {
  return row[key as keyof Telemetry];
}

/**
 * Naive, unoptimised re-implementation of today's `prepareHistory` semantics:
 * materialises every row with `telemetryAt`, filters and sorts it directly,
 * with no fast paths, no dense keys, no chunking. Used as the ground truth
 * the index-native engine is checked against — its result for any supported
 * query must equal this function's result exactly.
 */
export function referenceIndices(query: ReferenceQuery): number[] {
  const total = Math.max(0, Math.floor(query.total));
  const filters = Object.entries(query.filterModel);
  const indices: number[] = [];
  for (let index = 0; index < total; index++) {
    const row = telemetryAt(index);
    if (filters.every(([key, model]) => matches(field(row, key), model)))
      indices.push(index);
  }
  if (query.sortModel.length) {
    const keyOf = (index: number, colId: string): string | number => {
      const value = field(telemetryAt(index), colId);
      return typeof value === 'number' ? value : String(value ?? '');
    };
    indices.sort((a, b) => {
      for (const sort of query.sortModel) {
        const x = keyOf(a, sort.colId),
          y = keyOf(b, sort.colId);
        const difference = x < y ? -1 : x > y ? 1 : 0;
        if (difference) return sort.sort === 'desc' ? -difference : difference;
      }
      return a - b;
    });
  }
  return indices;
}
