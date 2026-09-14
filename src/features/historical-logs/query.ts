import {
  EPOCH,
  deviceIdAt,
  HISTORY_FLEET_SIZE,
  locationIndexAt,
  locations,
  measurementAt,
  qualityAt,
  sensorSpecs,
  sensorTypeIndexAt,
  statusFor,
  telemetryAt,
  timestampMsAt,
} from '../../shared/data/generator';
import { sensorTypes } from '../../shared/types';

export interface HistoryQuery {
  total: number;
  startRow: number;
  endRow: number;
  filterModel: Record<string, unknown>;
  sortModel: { colId: string; sort: string }[];
  signal?: AbortSignal;
}
/** Structural counters of one preparation; deterministic except `yields`. */
export interface QueryStats {
  /** Source rows tested by per-row filter predicates. */
  filtered: number;
  /** Matched rows whose sort keys were read. */
  keyed: number;
  /** Merge-sort passes performed. */
  mergePasses: number;
  /** Cooperative yields taken. */
  yields: number;
}
export interface HistoryIndex {
  /** Ordered source indices; `null` means identity order over `total` rows. */
  indices: Uint32Array | null;
  total: number;
  stats: QueryStats;
}
/** A filter or sort model outside the grammar this engine implements; never a silent match. */
export class UnsupportedQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedQueryError';
  }
}

// Message tasks avoid nested timer clamping without prioritising query continuations
// ahead of ordinary timers (including cancellation and responsiveness probes).
const pause = () =>
  new Promise<void>((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
const BUDGET_MS = 8;
/** Rows scanned or keyed between budget checks. */
export const QUERY_CHUNK_ROWS = 1 << 12;
/** Merge outputs between budget checks. */
export const MERGE_CHUNK_OUTPUTS = 1 << 16;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
// AG Grid serialises a date filter as a naive `YYYY-MM-DD HH:mm:ss` string. The
// column displays UTC, so the value is read as UTC: the user filters what they see.
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

// --- Filter compilation ------------------------------------------------------
// A filter model compiles once per query into a predicate over a column value.
// A `View` says how a column's stored value answers each coercion the filter
// grammar uses, so the timestamp column can be tested as epoch milliseconds
// while behaving exactly like its ISO string.
interface View<T> {
  /** The value a text filter lower-cases (`String(value ?? '')`). */
  text(value: T): unknown;
  /** `Number(value)`, as a number filter reads it. */
  number(value: T): number;
  /** `Date.parse(String(value))`, as a date filter reads it. */
  date(value: T): number;
  /** `value == null || value === ''`. */
  blank(value: T): boolean;
}
const RAW: View<unknown> = {
  text: (value) => value,
  number: (value) => Number(value),
  date: (value) => Date.parse(String(value)),
  blank: (value) => value == null || value === '',
};
// `timestamp` is an ISO string for the record's epoch milliseconds: parsing it
// returns those milliseconds, and `Number()` of it is always NaN.
const TIMESTAMP_MS: View<number> = {
  text: (ms) => new Date(ms).toISOString(),
  number: () => NaN,
  date: (ms) => ms,
  blank: () => false,
};
type Predicate<T> = (value: T) => boolean;
const scalarTypes = new Set([
  'equals',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'inRange',
]);
// Shared by number and date filters; an unparseable filter value matches nothing.
function scalar(type: unknown, from: number, to: number): Predicate<number> {
  if (!scalarTypes.has(type as string))
    throw new UnsupportedQueryError(`Unsupported comparison "${type}"`);
  if (Number.isNaN(from) || (type === 'inRange' && Number.isNaN(to)))
    return () => false;
  switch (type) {
    case 'equals':
      return (n) => n === from;
    case 'notEqual':
      return (n) => n !== from;
    case 'greaterThan':
      return (n) => n > from;
    case 'greaterThanOrEqual':
      return (n) => n >= from;
    case 'lessThan':
      return (n) => n < from;
    case 'lessThanOrEqual':
      return (n) => n <= from;
    default:
      return (n) => n >= from && n <= to;
  }
}
function textPredicate(type: unknown, raw: unknown): Predicate<string> {
  const filter = String(raw ?? '').toLowerCase();
  switch (type) {
    case 'equals':
      return (text) => text === filter;
    case 'notEqual':
      return (text) => text !== filter;
    case 'contains':
      return (text) => text.includes(filter);
    case 'notContains':
      return (text) => !text.includes(filter);
    case 'startsWith':
      return (text) => text.startsWith(filter);
    case 'endsWith':
      return (text) => text.endsWith(filter);
    default:
      throw new UnsupportedQueryError(`Unsupported text filter "${type}"`);
  }
}
// The grammar is the one AG Grid's provided filters produce and grid-state
// restoration accepts (storage.ts): a typed leaf, or one or two leaves of the
// same filter type joined by AND/OR. Anything else is refused before any row is
// read, so a malformed model can neither widen a result nor multiply the work.
function compile<T>(
  raw: unknown,
  view: View<T>,
  parentType?: unknown,
): Predicate<T> {
  const model = record(raw);
  if (!model)
    throw new UnsupportedQueryError('A filter model must be an object');
  const { filterType, type } = model;
  if (filterType !== 'text' && filterType !== 'number' && filterType !== 'date')
    throw new UnsupportedQueryError(`Unsupported filter type "${filterType}"`);
  if (Array.isArray(model.conditions)) {
    if (parentType !== undefined)
      throw new UnsupportedQueryError('Combined filters cannot be nested');
    if (model.conditions.length < 1 || model.conditions.length > 2)
      throw new UnsupportedQueryError(
        'A combined filter has one or two conditions',
      );
    const conditions = model.conditions.map((condition) =>
      compile(condition, view, filterType),
    );
    if (model.operator === 'OR')
      return (value) => conditions.some((condition) => condition(value));
    if (model.operator === 'AND')
      return (value) => conditions.every((condition) => condition(value));
    throw new UnsupportedQueryError(`Unsupported operator "${model.operator}"`);
  }
  if (parentType !== undefined && filterType !== parentType)
    throw new UnsupportedQueryError(
      'Combined conditions share one filter type',
    );
  if (type === 'blank') return (value) => view.blank(value);
  if (type === 'notBlank') return (value) => !view.blank(value);
  const inRange = type === 'inRange';
  if (filterType === 'number') {
    if (
      typeof model.filter !== 'number' ||
      (inRange && typeof model.filterTo !== 'number')
    )
      throw new UnsupportedQueryError('A number filter needs numeric values');
    const test = scalar(type, model.filter, Number(model.filterTo));
    return (value) => test(view.number(value));
  }
  if (filterType === 'date') {
    if (
      typeof model.dateFrom !== 'string' ||
      (inRange && typeof model.dateTo !== 'string')
    )
      throw new UnsupportedQueryError('A date filter needs date strings');
    const test = scalar(type, utcMs(model.dateFrom), utcMs(model.dateTo));
    return (value) => test(view.date(value));
  }
  if (typeof model.filter !== 'string')
    throw new UnsupportedQueryError('A text filter needs a text value');
  const test = textPredicate(type, model.filter);
  return (value) => test(String(view.text(value) ?? '').toLowerCase());
}

// --- Columns -----------------------------------------------------------------
type Value = string | number | undefined;
interface Column {
  /**
   * The record field's value, exactly as `telemetryAt(index)` holds it — except
   * `timestamp`, which is its epoch milliseconds (see `TIMESTAMP_MS`).
   */
  value(index: number): Value;
  /**
   * A finite domain: `code(index)` indexes `domain`. Any predicate or sort rank
   * over such a column is a pure function of the code, so it is tabulated once.
   */
  code?: (index: number) => number;
  domain?: readonly Value[];
}
const specByType = sensorTypes.map((type) => sensorSpecs[type]);
const valueAt = (index: number) =>
  measurementAt(index, sensorTypes[sensorTypeIndexAt(index)]);
const statusDomain = ['normal', 'warning', 'critical'] as const;
function statusCodeAt(index: number) {
  const spec = specByType[sensorTypeIndexAt(index)];
  const status = statusFor(valueAt(index), spec.warning, spec.critical);
  return (statusDomain as readonly string[]).indexOf(status);
}
function coded(code: (index: number) => number, domain: readonly Value[]) {
  return { code, domain, value: (index: number) => domain[code(index)] };
}
// The Historical Logs grid columns. Anything else is not part of the query grammar.
const columns = new Map<string, Column>([
  ['timestamp', { value: timestampMsAt }],
  [
    'deviceId',
    coded(
      (index) => index % HISTORY_FLEET_SIZE,
      Array.from({ length: HISTORY_FLEET_SIZE }, (_, index) =>
        deviceIdAt(index),
      ),
    ),
  ],
  ['location', coded(locationIndexAt, locations)],
  ['type', coded(sensorTypeIndexAt, sensorTypes)],
  [
    'unit',
    coded(
      sensorTypeIndexAt,
      specByType.map((spec) => spec.unit),
    ),
  ],
  ['value', { value: valueAt }],
  ['status', coded(statusCodeAt, statusDomain)],
  ['quality', { value: (index) => qualityAt(index) }],
  [
    'message',
    coded(
      (index) => (statusCodeAt(index) === 2 ? 1 : 0),
      [undefined, 'THRESHOLD_EXCEEDED'],
    ),
  ],
]);
function column(colId: string): Column {
  const found = columns.get(colId);
  if (!found) throw new UnsupportedQueryError(`Unknown column "${colId}"`);
  return found;
}
function rowPredicate(colId: string, model: unknown): Predicate<number> {
  const { value, code, domain } = column(colId);
  if (colId === 'timestamp') {
    const test = compile(model, TIMESTAMP_MS);
    return (index) => test(value(index) as number);
  }
  const test = compile(model, RAW);
  if (code && domain) {
    const table = Uint8Array.from(domain, (entry) => (test(entry) ? 1 : 0));
    return (index) => table[code(index)] === 1;
  }
  return (index) => test(value(index));
}
// Timestamps rise by one second per record, so a single bound or inclusive range
// is an index interval. Combined, notEqual and blank conditions are not intervals
// and stay on the per-row path.
const rangeTypes = new Set([...scalarTypes].filter((t) => t !== 'notEqual'));
function timestampRange(raw: unknown, total: number): [number, number] | null {
  const model = record(raw);
  if (
    !model ||
    Array.isArray(model.conditions) ||
    model.filterType !== 'date' ||
    !rangeTypes.has(model.type as string)
  )
    return null;
  const from = utcMs(model.dateFrom),
    to = utcMs(model.dateTo);
  if (Number.isNaN(from) || (model.type === 'inRange' && Number.isNaN(to)))
    return [0, 0];
  const f = (from - EPOCH) / 1000,
    g = (to - EPOCH) / 1000;
  let lo = 0,
    hi = total;
  switch (model.type) {
    case 'equals':
      [lo, hi] = Number.isInteger(f) ? [f, f + 1] : [0, 0];
      break;
    case 'greaterThan':
      lo = Math.floor(f) + 1;
      break;
    case 'greaterThanOrEqual':
      lo = Math.ceil(f);
      break;
    case 'lessThan':
      hi = Math.ceil(f);
      break;
    case 'lessThanOrEqual':
      hi = Math.floor(f) + 1;
      break;
    default:
      lo = Math.ceil(f);
      hi = Math.floor(g) + 1;
  }
  lo = Math.min(Math.max(lo, 0), total);
  return [lo, Math.min(Math.max(hi, lo), total)];
}

// --- Sort keys ---------------------------------------------------------------
// Every key is a Float64 so one comparator serves numbers and ranked strings and
// a descending sort is a sign flip. String domains are ranked with the same `<`
// comparison the grid contract uses, so equal strings share a rank. Keys compare
// only with `<`, so values that are neither less nor greater (including NaN,
// which no column produces today) tie exactly as they did before.
function sortKey(colId: string): (index: number) => number {
  const { value, code, domain } = column(colId);
  if (!code || !domain) return value as (index: number) => number;
  const text = domain.map((entry) => String(entry ?? ''));
  const distinct = [...new Set(text)].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const rank = Float64Array.from(text, (entry) => distinct.indexOf(entry));
  return (index) => rank[code(index)]!;
}

interface Runs {
  from: Uint32Array;
  to: Uint32Array;
  fromKey: Float64Array;
  toKey: Float64Array;
  secondary: Float64Array[];
}
interface MergeCursor {
  left: number;
  a: number;
  target: number;
}
/**
 * Advance one bottom-up merge pass by at most `MERGE_CHUNK_OUTPUTS` outputs; true once the
 * pass is complete. Positions travel with the primary key so the hot comparison
 * reads adjacent memory; secondary keys, indexed by position, only break ties.
 * Equal keys take the left run, which keeps the sort stable.
 */
function mergeSome(
  runs: Runs,
  width: number,
  count: number,
  cursor: MergeCursor,
): boolean {
  const { from, to, fromKey, toKey, secondary } = runs;
  let { left, a, target } = cursor;
  const stop = Math.min(target + MERGE_CHUNK_OUTPUTS, count);
  while (target < stop) {
    const middle = Math.min(left + width, count),
      end = Math.min(left + width * 2, count),
      limit = Math.min(end, stop);
    // Outputs so far in this pair = (a - left) + (b - middle) = target - left.
    let b = middle + target - a;
    for (; target < limit; target++) {
      let takeLeft = b >= end;
      if (!takeLeft && a < middle) {
        const x = fromKey[a]!,
          y = fromKey[b]!;
        // Take the right run only when it is strictly smaller; a tie keeps order.
        takeLeft = !(y < x);
        if (takeLeft && !(x < y)) {
          for (let s = 0; s < secondary.length; s++) {
            const u = secondary[s]![from[a]!]!,
              v = secondary[s]![from[b]!]!;
            if (v < u) {
              takeLeft = false;
              break;
            }
            if (u < v) break;
          }
        }
      }
      const source = takeLeft ? a++ : b++;
      to[target] = from[source]!;
      toKey[target] = fromKey[source]!;
    }
    if (target === end) left = a = end;
  }
  cursor.left = left;
  cursor.a = a;
  cursor.target = target;
  return target >= count;
}

/** Build a compact index once per query, yielding during scans and merge sorting. */
export async function prepareHistory(
  query: HistoryQuery,
): Promise<HistoryIndex> {
  const { signal } = query;
  signal?.throwIfAborted();
  const stats: QueryStats = {
    filtered: 0,
    keyed: 0,
    mergePasses: 0,
    yields: 0,
  };
  const total = Math.max(0, Math.floor(query.total));
  let deadline = performance.now() + BUDGET_MS;
  const breathe = async () => {
    if (performance.now() < deadline) return;
    await pause();
    stats.yields++;
    signal?.throwIfAborted();
    deadline = performance.now() + BUDGET_MS;
  };
  // Hot loops run as plain synchronous chunks, which the engine optimises far
  // better than a loop suspended inside this async function; the budget is
  // checked between chunks.
  const chunks = async (
    start: number,
    end: number,
    step: (from: number, to: number) => void,
  ) => {
    for (let from = start; from < end; from += QUERY_CHUNK_ROWS) {
      step(from, Math.min(from + QUERY_CHUNK_ROWS, end));
      await breathe();
    }
  };

  // Compile everything before touching a row, so an unsupported model fails first.
  let lo = 0,
    hi = total;
  const predicates: Predicate<number>[] = [];
  for (const [colId, model] of Object.entries(query.filterModel)) {
    if (model == null) continue;
    const range = colId === 'timestamp' && timestampRange(model, total);
    if (range) {
      rowPredicate(colId, model);
      [lo, hi] = range;
    } else predicates.push(rowPredicate(colId, model));
  }
  const sorts = query.sortModel.map(({ colId, sort }) => {
    if (sort !== 'asc' && sort !== 'desc')
      throw new UnsupportedQueryError(`Unsupported sort direction "${sort}"`);
    column(colId);
    return { colId, descending: sort === 'desc' };
  });
  // Timestamps are distinct and follow source order: keys after one never decide,
  // ascending it is the stable tie order, and descending it is that order reversed.
  const timestampAt = sorts.findIndex((sort) => sort.colId === 'timestamp');
  const reversed = timestampAt !== -1 && sorts[timestampAt]!.descending;
  const keyed = timestampAt === -1 ? sorts : sorts.slice(0, timestampAt);

  // Filter: matching source indices are the contiguous range [lo, hi) or `list`.
  let list: Uint32Array | null = null;
  let count = hi - lo;
  if (predicates.length) {
    const buffer = new Uint32Array(hi - lo);
    let matched = 0;
    stats.filtered = hi - lo;
    await chunks(lo, hi, (from, to) => {
      let n = matched;
      for (let index = from; index < to; index++) {
        let pass = true;
        for (let p = 0; p < predicates.length && pass; p++)
          pass = predicates[p]!(index);
        if (pass) buffer[n++] = index;
      }
      matched = n;
    });
    signal?.throwIfAborted();
    count = matched;
    list = count < buffer.length ? buffer.slice(0, count) : buffer;
  }
  const identity = !list && !reversed && lo === 0;
  const origin = list
    ? reversed
      ? (position: number) => list[count - 1 - position]!
      : (position: number) => list[position]!
    : reversed
      ? (position: number) => lo + count - 1 - position
      : (position: number) => lo + position;

  if (!keyed.length) {
    if (identity) return { indices: null, total: count, stats };
    if (list)
      return { indices: reversed ? list.reverse() : list, total: count, stats };
    const indices = new Uint32Array(count);
    for (let position = 0; position < count; position++)
      indices[position] = origin(position);
    return { indices, total: count, stats };
  }

  // Dense keys by result position; a descending timestamp tie order starts reversed.
  const keys: Float64Array[] = [];
  for (const { colId, descending } of keyed) {
    const key = new Float64Array(count),
      read = sortKey(colId),
      sign = descending ? -1 : 1;
    await chunks(0, count, (from, to) => {
      for (let position = from; position < to; position++)
        key[position] = sign * read(origin(position));
    });
    keys.push(key);
  }
  stats.keyed = count;
  signal?.throwIfAborted();

  const positions = new Uint32Array(count);
  for (let position = 0; position < count; position++)
    positions[position] = position;
  const runs: Runs = {
    from: positions,
    to: new Uint32Array(count),
    fromKey: keys[0]!,
    toKey: new Float64Array(count),
    secondary: keys.slice(1),
  };
  for (let width = 1; width < count; width *= 2) {
    const cursor: MergeCursor = { left: 0, a: 0, target: 0 };
    while (!mergeSome(runs, width, count, cursor)) await breathe();
    [runs.from, runs.to] = [runs.to, runs.from];
    [runs.fromKey, runs.toKey] = [runs.toKey, runs.fromKey];
    stats.mergePasses++;
    signal?.throwIfAborted();
  }
  if (identity) return { indices: runs.from, total: count, stats };
  const indices = runs.to;
  for (let target = 0; target < count; target++)
    indices[target] = origin(runs.from[target]!);
  return { indices, total: count, stats };
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
