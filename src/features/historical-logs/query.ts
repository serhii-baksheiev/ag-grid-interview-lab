import { telemetryAt } from '../../shared/data/generator';

export interface HistoryQuery {
  total: number;
  startRow: number;
  endRow: number;
  filterModel: Record<string, unknown>;
  sortModel: { colId: string; sort: string }[];
  signal?: AbortSignal;
}
type Row = ReturnType<typeof telemetryAt>;
export interface HistoryIndex {
  indices: Uint32Array | null;
  total: number;
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function check(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
  if (model.filterType === 'number') {
    const n = Number(value),
      filter = Number(model.filter);
    switch (model.type) {
      case 'equals':
        return n === filter;
      case 'notEqual':
        return n !== filter;
      case 'greaterThan':
        return n > filter;
      case 'greaterThanOrEqual':
        return n >= filter;
      case 'lessThan':
        return n < filter;
      case 'lessThanOrEqual':
        return n <= filter;
      case 'inRange':
        return n >= filter && n <= Number(model.filterTo);
      default:
        return true;
    }
  }
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
function field(row: Row, key: string): unknown {
  return row[key as keyof Row];
}

/** Build a compact index once per query, yielding during scans and merge sorting. */
export async function prepareHistory(
  query: HistoryQuery,
): Promise<HistoryIndex> {
  check(query.signal);
  const total = Math.max(0, Math.floor(query.total));
  const filters = Object.entries(query.filterModel);
  if (!filters.length && !query.sortModel.length)
    return { indices: null, total };
  let indices = new Uint32Array(total);
  const keys: (string | number)[][] = query.sortModel.map(() => []);
  let count = 0;
  for (let index = 0; index < total; index++) {
    const row = telemetryAt(index);
    if (filters.every(([key, model]) => matches(field(row, key), model))) {
      indices[count++] = index;
      query.sortModel.forEach((sort, s) => {
        const value = field(row, sort.colId);
        keys[s]![index] =
          typeof value === 'number' ? value : String(value ?? '');
      });
    }
    if (index % 4096 === 4095) {
      await pause();
      check(query.signal);
    }
  }
  indices = indices.slice(0, count);
  if (query.sortModel.length) {
    let scratch = new Uint32Array(count);
    const compare = (a: number, b: number) => {
      for (let s = 0; s < query.sortModel.length; s++) {
        const x = keys[s]![a]!,
          y = keys[s]![b]!;
        const difference = x < y ? -1 : x > y ? 1 : 0;
        if (difference)
          return query.sortModel[s]!.sort === 'desc' ? -difference : difference;
      }
      return a - b;
    };
    for (let width = 1; width < count; width *= 2) {
      for (let left = 0; left < count; left += width * 2) {
        const middle = Math.min(left + width, count),
          end = Math.min(left + width * 2, count);
        let a = left,
          b = middle;
        for (let target = left; target < end; target++) {
          scratch[target] =
            a < middle && (b >= end || compare(indices[a]!, indices[b]!) <= 0)
              ? indices[a++]!
              : indices[b++]!;
          if (target % 16384 === 16383) {
            await pause();
            check(query.signal);
          }
        }
      }
      [indices, scratch] = [scratch, indices];
      await pause();
      check(query.signal);
    }
  }
  return { indices, total: count };
}
export function historyPage(
  index: HistoryIndex,
  startRow: number,
  endRow: number,
) {
  const start = Math.max(0, Math.floor(startRow)),
    end = Math.min(index.total, Math.max(start, Math.floor(endRow)));
  return {
    total: index.total,
    rows: Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
      telemetryAt(
        index.indices ? index.indices[start + offset]! : start + offset,
      ),
    ),
  };
}
export async function queryHistory(query: HistoryQuery) {
  return historyPage(await prepareHistory(query), query.startRow, query.endRow);
}
