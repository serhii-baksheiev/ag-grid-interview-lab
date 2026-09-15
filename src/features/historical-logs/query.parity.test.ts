import { afterEach, describe, expect, it, vi } from 'vitest';
import * as generatorModule from '../../shared/data/generator';
import { telemetryAt } from '../../shared/data/generator';
import { referenceIndices } from '../../test/historyReference';
import { deserializeState } from '../../shared/grid/storage';
import { defaultColDef } from '../../shared/grid/base';
import { filterSchemaFor } from '../../shared/grid/filterSchema';
import { historyColumns } from './columns';
import {
  historyPage,
  MERGE_CHUNK_OUTPUTS,
  prepareHistory,
  QUERY_CHUNK_ROWS,
  UnsupportedQueryError,
  type HistoryIndex,
  type HistoryQuery,
} from './query';

afterEach(() => {
  vi.restoreAllMocks();
});

const order = (index: HistoryIndex): number[] =>
  index.indices
    ? Array.from(index.indices)
    : Array.from({ length: index.total }, (_, i) => i);

const naive = (i: number) =>
  telemetryAt(i).timestamp.slice(0, 19).replace('T', ' ');

/** Shifts a naive `YYYY-MM-DD HH:mm:ss` value by whole seconds, staying naive. */
function shiftNaive(value: string, deltaSeconds: number): string {
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`) + deltaSeconds * 1000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function makeQuery(
  overrides: Partial<HistoryQuery>,
  total: number,
): HistoryQuery {
  return {
    total,
    startRow: 0,
    endRow: 0,
    filterModel: {},
    sortModel: [],
    ...overrides,
  };
}

/** Runs the optimized engine and asserts identical order and total to the reference oracle. */
async function expectParity(
  overrides: Partial<HistoryQuery>,
  total = 3000,
): Promise<HistoryIndex> {
  const query = makeQuery(overrides, total);
  const index = await prepareHistory(query);
  const expected = referenceIndices({
    total: query.total,
    filterModel: query.filterModel,
    sortModel: query.sortModel,
  });
  expect(order(index)).toEqual(expected);
  expect(index.total).toBe(expected.length);
  return index;
}

describe('index-native prepareHistory matches the reference oracle', () => {
  it('returns identity order with no filters and no sort', async () => {
    await expectParity({});
  });

  it('applies a numeric greaterThan filter', async () => {
    await expectParity({
      filterModel: {
        value: { filterType: 'number', type: 'greaterThan', filter: 40 },
      },
    });
  });

  describe('text filters', () => {
    it('contains, case-insensitively, on deviceId', async () => {
      await expectParity({
        filterModel: {
          deviceId: {
            filterType: 'text',
            type: 'contains',
            filter: 'DEVICE-0001',
          },
        },
      });
    });
    it('equals on location, case-insensitively', async () => {
      await expectParity({
        filterModel: {
          location: {
            filterType: 'text',
            type: 'equals',
            filter: 'north plant',
          },
        },
      });
    });
    it('notEqual on type', async () => {
      await expectParity({
        filterModel: {
          type: { filterType: 'text', type: 'notEqual', filter: 'temperature' },
        },
      });
    });
    it('startsWith on status', async () => {
      await expectParity({
        filterModel: {
          status: { filterType: 'text', type: 'startsWith', filter: 'war' },
        },
      });
    });
    it('endsWith on message', async () => {
      await expectParity({
        filterModel: {
          message: { filterType: 'text', type: 'endsWith', filter: 'exceeded' },
        },
      });
    });
    it('notContains on deviceId', async () => {
      await expectParity({
        filterModel: {
          deviceId: { filterType: 'text', type: 'notContains', filter: '0001' },
        },
      });
    });
  });

  describe('date filters on timestamp', () => {
    it('equals a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'equals',
            dateFrom: naive(500),
          },
        },
      });
    });
    it('greaterThan a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'greaterThan',
            dateFrom: naive(500),
          },
        },
      });
    });
    it('greaterThanOrEqual a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'greaterThanOrEqual',
            dateFrom: naive(500),
          },
        },
      });
    });
    it('lessThan a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'lessThan',
            dateFrom: naive(500),
          },
        },
      });
    });
    it('lessThanOrEqual a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'lessThanOrEqual',
            dateFrom: naive(500),
          },
        },
      });
    });
    it('notEqual a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'notEqual',
            dateFrom: naive(500),
          },
        },
      });
    });

    it('inRange is inclusive of both endpoints', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'inRange',
            dateFrom: naive(100),
            dateTo: naive(200),
          },
        },
      });
    });
    it('a reversed inRange (dateFrom after dateTo) matches nothing', async () => {
      const index = await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'inRange',
            dateFrom: naive(200),
            dateTo: naive(100),
          },
        },
      });
      expect(index.total).toBe(0);
    });
    it('a range starting before the dataset and ending after it covers everything', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'inRange',
            dateFrom: shiftNaive(naive(0), -500),
            dateTo: shiftNaive(naive(2999), 500),
          },
        },
      });
    });

    it('matches a value exactly on a record second', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'equals',
            dateFrom: naive(1234),
          },
        },
      });
    });
    it('a date-only value parses as UTC midnight, before every record', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            type: 'greaterThanOrEqual',
            dateFrom: '2026-09-01',
          },
        },
      });
    });
    it('an unparseable date value matches nothing', async () => {
      const index = await expectParity({
        filterModel: {
          timestamp: { filterType: 'date', type: 'equals', dateFrom: 'soon' },
        },
      });
      expect(index.total).toBe(0);
    });
  });

  describe('combined conditions', () => {
    it('AND of two numeric conditions on value', async () => {
      await expectParity({
        filterModel: {
          value: {
            filterType: 'number',
            operator: 'AND',
            conditions: [
              { filterType: 'number', type: 'greaterThan', filter: 20 },
              { filterType: 'number', type: 'lessThan', filter: 80 },
            ],
          },
        },
      });
    });
    it('AND of two timestamp ranges (a compound range)', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            operator: 'AND',
            conditions: [
              {
                filterType: 'date',
                type: 'greaterThanOrEqual',
                dateFrom: naive(500),
              },
              {
                filterType: 'date',
                type: 'lessThanOrEqual',
                dateFrom: naive(1500),
              },
            ],
          },
        },
      });
    });
    it('OR of two text equals on status', async () => {
      await expectParity({
        filterModel: {
          status: {
            filterType: 'text',
            operator: 'OR',
            conditions: [
              { filterType: 'text', type: 'equals', filter: 'warning' },
              { filterType: 'text', type: 'equals', filter: 'critical' },
            ],
          },
        },
      });
    });
    it('OR of two timestamp equals', async () => {
      await expectParity({
        filterModel: {
          timestamp: {
            filterType: 'date',
            operator: 'OR',
            conditions: [
              { filterType: 'date', type: 'equals', dateFrom: naive(7) },
              { filterType: 'date', type: 'equals', dateFrom: naive(1234) },
            ],
          },
        },
      });
    });
  });

  describe('blank and notBlank', () => {
    it('blank on the sparse message field', async () => {
      await expectParity({
        filterModel: { message: { filterType: 'text', type: 'blank' } },
      });
    });
    it('notBlank on the sparse message field', async () => {
      await expectParity({
        filterModel: { message: { filterType: 'text', type: 'notBlank' } },
      });
    });
    it('blank on timestamp (never blank)', async () => {
      const index = await expectParity({
        filterModel: { timestamp: { filterType: 'date', type: 'blank' } },
      });
      expect(index.total).toBe(0);
    });
    it('notBlank on timestamp (always present)', async () => {
      const index = await expectParity({
        filterModel: { timestamp: { filterType: 'date', type: 'notBlank' } },
      });
      expect(index.total).toBe(3000);
    });
    it('blank on value (never blank, a number)', async () => {
      const index = await expectParity({
        filterModel: { value: { filterType: 'number', type: 'blank' } },
      });
      expect(index.total).toBe(0);
    });
    it('notBlank on value (always present)', async () => {
      await expectParity({
        filterModel: { value: { filterType: 'number', type: 'notBlank' } },
      });
    });
  });

  describe('single-column sorts', () => {
    it('numeric ascending on value', async () => {
      await expectParity({ sortModel: [{ colId: 'value', sort: 'asc' }] });
    });
    it('numeric descending on value', async () => {
      await expectParity({ sortModel: [{ colId: 'value', sort: 'desc' }] });
    });
    it('numeric ascending on quality (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'quality', sort: 'asc' }] });
    });
    it('numeric descending on quality (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'quality', sort: 'desc' }] });
    });
    it('string ascending on type (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'type', sort: 'asc' }] });
    });
    it('string descending on type (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'type', sort: 'desc' }] });
    });
    it('string ascending on deviceId', async () => {
      await expectParity({ sortModel: [{ colId: 'deviceId', sort: 'asc' }] });
    });
    it('string descending on deviceId', async () => {
      await expectParity({ sortModel: [{ colId: 'deviceId', sort: 'desc' }] });
    });
    it('string ascending on status (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'status', sort: 'asc' }] });
    });
    it('string descending on status (many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'status', sort: 'desc' }] });
    });
    it('string ascending on message (mostly blank, many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'message', sort: 'asc' }] });
    });
    it('string descending on message (mostly blank, many ties)', async () => {
      await expectParity({ sortModel: [{ colId: 'message', sort: 'desc' }] });
    });
    it('timestamp ascending alone', async () => {
      await expectParity({ sortModel: [{ colId: 'timestamp', sort: 'asc' }] });
    });
    it('timestamp descending alone', async () => {
      await expectParity({ sortModel: [{ colId: 'timestamp', sort: 'desc' }] });
    });
  });

  describe('multi-column sorts', () => {
    it('type asc, value desc', async () => {
      await expectParity({
        sortModel: [
          { colId: 'type', sort: 'asc' },
          { colId: 'value', sort: 'desc' },
        ],
      });
    });
    it('location desc, quality asc, deviceId asc', async () => {
      await expectParity({
        sortModel: [
          { colId: 'location', sort: 'desc' },
          { colId: 'quality', sort: 'asc' },
          { colId: 'deviceId', sort: 'asc' },
        ],
      });
    });
    it('status asc, timestamp desc', async () => {
      await expectParity({
        sortModel: [
          { colId: 'status', sort: 'asc' },
          { colId: 'timestamp', sort: 'desc' },
        ],
      });
    });
    it('timestamp as a secondary key breaking ties on a tie-heavy primary key', async () => {
      await expectParity({
        sortModel: [
          { colId: 'quality', sort: 'asc' },
          { colId: 'timestamp', sort: 'asc' },
        ],
      });
    });
  });

  describe('selective filter combined with a sort', () => {
    it('one device, sorted by value desc', async () => {
      const deviceId = telemetryAt(0).deviceId;
      await expectParity({
        filterModel: {
          deviceId: { filterType: 'text', type: 'equals', filter: deviceId },
        },
        sortModel: [{ colId: 'value', sort: 'desc' }],
      });
    });
    it('type equals AND a timestamp range, sorted by quality asc then timestamp desc', async () => {
      await expectParity({
        filterModel: {
          type: { filterType: 'text', type: 'equals', filter: 'temperature' },
          timestamp: {
            filterType: 'date',
            type: 'inRange',
            dateFrom: naive(0),
            dateTo: naive(2000),
          },
        },
        sortModel: [
          { colId: 'quality', sort: 'asc' },
          { colId: 'timestamp', sort: 'desc' },
        ],
      });
    });
  });

  describe('a filter type mismatched to its column', () => {
    it('a number filter applied to a string column', async () => {
      await expectParity({
        filterModel: {
          deviceId: { filterType: 'number', type: 'equals', filter: 5 },
        },
      });
    });
    it('a number filter applied to a string column (notEqual, always true)', async () => {
      await expectParity({
        filterModel: {
          status: { filterType: 'number', type: 'notEqual', filter: 0 },
        },
      });
    });
    it('a text filter applied to a numeric column', async () => {
      await expectParity({
        filterModel: {
          value: { filterType: 'text', type: 'contains', filter: '.5' },
        },
      });
    });
  });

  describe('edge-case totals', () => {
    it('total 0 yields an empty result', async () => {
      const index = await expectParity({}, 0);
      expect(index.total).toBe(0);
    });
    it('total 1 yields a single row', async () => {
      const index = await expectParity({}, 1);
      expect(index.total).toBe(1);
    });
    it('a non-integer total is floored', async () => {
      const index = await expectParity({}, 10.7);
      expect(index.total).toBe(10);
    });
  });
});

// --- seeded property test -------------------------------------------------

/** Deterministic PRNG so property-test failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

const TEXT_COLUMNS = [
  'deviceId',
  'location',
  'type',
  'status',
  'message',
  'unit',
];
const NUMBER_COLUMNS = ['value', 'quality'];
const DATE_COLUMNS = ['timestamp'];
const ALL_COLUMNS = [...TEXT_COLUMNS, ...NUMBER_COLUMNS, ...DATE_COLUMNS];
const TEXT_TYPES = [
  'equals',
  'notEqual',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
];
const NUMBER_TYPES = [
  'equals',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'inRange',
];
const DATE_TYPES = [...NUMBER_TYPES, 'blank', 'notBlank'];

function randomTextLeaf(
  rng: () => number,
  raw: string,
): Record<string, unknown> {
  const type = TEXT_TYPES[Math.floor(rng() * TEXT_TYPES.length)]!;
  let needle = raw;
  if (rng() < 0.5) needle = needle.toUpperCase();
  if (raw.length > 1 && rng() < 0.5) {
    const start = Math.floor(rng() * raw.length);
    const end = Math.min(
      raw.length,
      start + 1 + Math.floor(rng() * raw.length),
    );
    needle = needle.slice(start, end);
  }
  return { filterType: 'text', type, filter: needle };
}

function randomNumberLeaf(
  rng: () => number,
  value: number,
): Record<string, unknown> {
  const type = NUMBER_TYPES[Math.floor(rng() * NUMBER_TYPES.length)]!;
  const jitter = (rng() - 0.5) * 10;
  const from = rng() < 0.4 ? value : value + jitter;
  if (type === 'inRange') {
    const to = from + Math.abs(jitter) + 1;
    return {
      filterType: 'number',
      type,
      filter: Math.min(from, to),
      filterTo: Math.max(from, to),
    };
  }
  return { filterType: 'number', type, filter: from };
}

function randomDateLeaf(
  rng: () => number,
  base: string,
): Record<string, unknown> {
  const type = DATE_TYPES[Math.floor(rng() * DATE_TYPES.length)]!;
  if (type === 'blank' || type === 'notBlank')
    return { filterType: 'date', type };
  const dateFrom = shiftNaive(base, Math.floor((rng() - 0.5) * 12));
  if (type === 'inRange') {
    const dateTo = shiftNaive(dateFrom, 1 + Math.floor(rng() * 20));
    return { filterType: 'date', type, dateFrom, dateTo };
  }
  return { filterType: 'date', type, dateFrom };
}

function randomFilterLeaf(
  rng: () => number,
  column: string,
  total: number,
): Record<string, unknown> {
  const sampleIndex = Math.floor(rng() * Math.max(total, 1));
  const row = telemetryAt(sampleIndex);
  const raw = row[column as keyof typeof row];
  const roll = rng();
  // Blank checks on every kind of column, whatever filter type carries them.
  if (roll < 0.08)
    return {
      filterType: ['text', 'number', 'date'][Math.floor(rng() * 3)],
      type: rng() < 0.5 ? 'blank' : 'notBlank',
    };
  // A filter type that does not match the column still has defined semantics.
  if (roll < 0.18) {
    const kind = Math.floor(rng() * 3);
    if (kind === 0) return randomTextLeaf(rng, String(raw ?? ''));
    if (kind === 1) return randomNumberLeaf(rng, row.value);
    return randomDateLeaf(rng, naive(sampleIndex));
  }
  if (TEXT_COLUMNS.includes(column))
    return randomTextLeaf(rng, String(raw ?? ''));
  if (NUMBER_COLUMNS.includes(column)) {
    const leaf = randomNumberLeaf(rng, raw as number);
    // Occasionally a reversed numeric range, which matches nothing.
    if (leaf.type === 'inRange' && rng() < 0.2)
      return { ...leaf, filter: leaf.filterTo, filterTo: leaf.filter };
    return leaf;
  }
  return randomDateLeaf(rng, naive(sampleIndex));
}

function randomQuery(rng: () => number): HistoryQuery {
  const total =
    rng() < 0.05 ? Math.floor(rng() * 12000) : Math.floor(rng() * 2501);
  const filterModel: Record<string, unknown> = {};
  const filterColumns = shuffle([...ALL_COLUMNS], rng).slice(
    0,
    Math.floor(rng() * 4),
  );
  for (const column of filterColumns) {
    const first = randomFilterLeaf(rng, column, total);
    if (rng() < 0.3) {
      const second = randomFilterLeaf(rng, column, total);
      const operator = rng() < 0.5 ? 'AND' : 'OR';
      // AG Grid combines conditions of one filter type only.
      filterModel[column] =
        second.filterType === first.filterType
          ? {
              filterType: first.filterType,
              operator,
              conditions: [first, second],
            }
          : first;
    } else {
      filterModel[column] = first;
    }
  }
  const sortColumns = shuffle([...ALL_COLUMNS], rng).slice(
    0,
    Math.floor(rng() * 4),
  );
  const sortModel = sortColumns.map((colId) => ({
    colId,
    sort: rng() < 0.5 ? 'asc' : 'desc',
  }));
  return makeQuery({ filterModel, sortModel }, total);
}

describe('seeded property parity', () => {
  // Four independently seeded batches of 100 queries, each within the default timeout.
  it.each([0, 1, 2, 3])(
    'matches the reference oracle for 100 random queries (seed batch %i)',
    async (batch) => {
      const rng = mulberry32(0xc0ffee + batch);
      for (let i = 0; i < 100; i++) {
        const query = randomQuery(rng);
        const index = await prepareHistory(query);
        const expected = referenceIndices({
          total: query.total,
          filterModel: query.filterModel,
          sortModel: query.sortModel,
        });
        try {
          expect(order(index)).toEqual(expected);
        } catch (error) {
          throw new Error(
            `${(error as Error).message}\nquery=${JSON.stringify(query)}`,
            { cause: error },
          );
        }
      }
    },
  );
});

describe('parity across scan chunks and resumed merge passes', () => {
  const cases: [
    string,
    number,
    Record<string, unknown>,
    HistoryQuery['sortModel'],
  ][] = [
    [
      'value asc, merge passes resumed mid-pass',
      131_073,
      {},
      [{ colId: 'value', sort: 'asc' }],
    ],
    [
      'type filter across scan chunks, quality desc then deviceId asc',
      131_073,
      { type: { filterType: 'text', type: 'notEqual', filter: 'battery' } },
      [
        { colId: 'quality', sort: 'desc' },
        { colId: 'deviceId', sort: 'asc' },
      ],
    ],
    [
      'status asc with descending timestamp ties',
      65_537,
      {},
      [
        { colId: 'status', sort: 'asc' },
        { colId: 'timestamp', sort: 'desc' },
      ],
    ],
    [
      'timestamp range narrowing a value filter, location desc then value asc',
      200_003,
      {
        timestamp: {
          filterType: 'date',
          type: 'inRange',
          dateFrom: naive(3),
          dateTo: naive(190_001),
        },
        value: { filterType: 'number', type: 'greaterThan', filter: 30 },
      },
      [
        { colId: 'location', sort: 'desc' },
        { colId: 'value', sort: 'asc' },
      ],
    ],
    [
      'message notBlank across scan chunks, unsorted',
      40_961,
      { message: { filterType: 'text', type: 'notBlank' } },
      [],
    ],
  ];
  it.each(cases)('%s', async (_, total, filterModel, sortModel) => {
    const index = await expectParity({ filterModel, sortModel }, total);
    // Each case must really cross the boundaries it names.
    expect(index.stats.filtered + index.stats.keyed).toBeGreaterThan(
      QUERY_CHUNK_ROWS,
    );
    if (index.stats.keyed)
      expect(index.stats.keyed).toBeGreaterThan(MERGE_CHUNK_OUTPUTS);
  });
});

// --- unsupported query models fail closed (AGL-8d) -------------------------

describe('unsupported query models fail closed instead of silently matching', () => {
  async function expectUnsupported(
    filterModel: Record<string, unknown> = {},
    sortModel: HistoryQuery['sortModel'] = [],
  ) {
    const promise = prepareHistory(makeQuery({ filterModel, sortModel }, 100));
    await expect(promise).rejects.toBeInstanceOf(UnsupportedQueryError);
    await expect(promise).rejects.toMatchObject({
      name: 'UnsupportedQueryError',
    });
  }

  it('rejects an unknown text filter type', () =>
    expectUnsupported({
      deviceId: { filterType: 'text', type: 'regex', filter: 'x' },
    }));
  it('rejects an unknown number filter type', () =>
    expectUnsupported({
      value: { filterType: 'number', type: 'regex', filter: 1 },
    }));
  it('rejects an unknown date filter type', () =>
    expectUnsupported({
      timestamp: { filterType: 'date', type: 'regex', dateFrom: naive(0) },
    }));
  it('rejects an unknown filterType altogether', () =>
    expectUnsupported({ status: { filterType: 'set', values: ['warning'] } }));
  it('rejects a leaf with no filterType and a non-blank type', () =>
    expectUnsupported({ status: { type: 'equals', filter: 'warning' } }));
  it('rejects a combined model with operator XOR', () =>
    expectUnsupported({
      value: {
        filterType: 'number',
        operator: 'XOR',
        conditions: [
          { filterType: 'number', type: 'greaterThan', filter: 1 },
          { filterType: 'number', type: 'lessThan', filter: 10 },
        ],
      },
    }));
  it('rejects a filter on an unknown column', () =>
    expectUnsupported({
      ghost: { filterType: 'text', type: 'equals', filter: 'x' },
    }));
  it('rejects a filter on id, which is not a grid column', () =>
    expectUnsupported({
      id: { filterType: 'text', type: 'equals', filter: 'log-1' },
    }));
  it.each([42, 'x', []])(
    'rejects a non-object filter model value (%j)',
    (value) => expectUnsupported({ value }),
  );
  it.each([
    [
      'a combined model with no conditions',
      'value',
      { filterType: 'number', operator: 'AND', conditions: [] },
    ],
    [
      'a combined model with three conditions',
      'value',
      {
        filterType: 'number',
        operator: 'OR',
        conditions: [1, 2, 3].map((filter) => ({
          filterType: 'number',
          type: 'equals',
          filter,
        })),
      },
    ],
    [
      'a nested combined model',
      'status',
      {
        filterType: 'text',
        operator: 'AND',
        conditions: [
          {
            filterType: 'text',
            operator: 'OR',
            conditions: [
              { filterType: 'text', type: 'equals', filter: 'warning' },
            ],
          },
        ],
      },
    ],
    [
      'a combined model whose conditions differ in filter type',
      'value',
      {
        filterType: 'number',
        operator: 'OR',
        conditions: [
          { filterType: 'number', type: 'equals', filter: 1 },
          { filterType: 'text', type: 'contains', filter: '1' },
        ],
      },
    ],
    ['a blank check without a filter type', 'message', { type: 'blank' }],
    [
      'a text filter without a value',
      'deviceId',
      { filterType: 'text', type: 'contains' },
    ],
    [
      'a text filter with a numeric value',
      'deviceId',
      { filterType: 'text', type: 'equals', filter: 42 },
    ],
    [
      'a number filter with a string value',
      'value',
      { filterType: 'number', type: 'equals', filter: '40' },
    ],
    [
      'a number range without an upper bound',
      'value',
      { filterType: 'number', type: 'inRange', filter: 1 },
    ],
    [
      'a date filter without a date',
      'timestamp',
      { filterType: 'date', type: 'equals' },
    ],
    [
      'a date range without an end',
      'timestamp',
      { filterType: 'date', type: 'inRange', dateFrom: naive(1) },
    ],
    [
      'a boolean-column text type',
      'status',
      { filterType: 'text', type: 'true' },
    ],
  ] as const)('rejects %s', (_, column, model) =>
    expectUnsupported({ [column]: model }),
  );
  it('rejects a combined model whose conditions array has holes', () =>
    expectUnsupported({
      value: {
        filterType: 'number',
        operator: 'AND',
        // Not encodable in JSON, but a sparse array would otherwise compile no leaf.
        conditions: new Array(2),
      },
    }));
  it('rejects a sort on an unknown column', () =>
    expectUnsupported({}, [{ colId: 'ghost', sort: 'asc' }]));
  it('rejects a sort direction other than asc or desc', () =>
    expectUnsupported({}, [{ colId: 'value', sort: 'ascending' }]));
  it('rejects a sort model that repeats a column (unbounded key arrays, no decided order)', () =>
    expectUnsupported({}, [
      { colId: 'value', sort: 'asc' },
      { colId: 'value', sort: 'desc' },
    ]));
  it('rejects a leaf carrying a stray operator without a conditions array', () =>
    expectUnsupported({
      value: { filterType: 'number', type: 'notBlank', operator: 'AND' },
    }));
  it('rejects a leaf whose conditions is not an array', () =>
    expectUnsupported({
      value: {
        filterType: 'number',
        type: 'notBlank',
        operator: 'AND',
        conditions: {},
      },
    }));

  it('treats a null entry in the filter model as no filter for that column', async () => {
    const withNull = await prepareHistory(
      makeQuery(
        {
          filterModel: {
            deviceId: null,
            value: { filterType: 'number', type: 'greaterThan', filter: 40 },
          },
        },
        500,
      ),
    );
    const withoutNull = await prepareHistory(
      makeQuery(
        {
          filterModel: {
            value: { filterType: 'number', type: 'greaterThan', filter: 40 },
          },
        },
        500,
      ),
    );
    expect(order(withNull)).toEqual(order(withoutNull));
    expect(withNull.total).toBe(withoutNull.total);
  });
  it('treats an undefined entry in the filter model as no filter for that column', async () => {
    const withUndefined = await prepareHistory(
      makeQuery(
        {
          filterModel: {
            deviceId: undefined,
            value: { filterType: 'number', type: 'greaterThan', filter: 40 },
          },
        },
        500,
      ),
    );
    const withoutUndefined = await prepareHistory(
      makeQuery(
        {
          filterModel: {
            value: { filterType: 'number', type: 'greaterThan', filter: 40 },
          },
        },
        500,
      ),
    );
    expect(order(withUndefined)).toEqual(order(withoutUndefined));
    expect(withUndefined.total).toBe(withoutUndefined.total);
  });
});

// --- deterministic structural gates (AGL-7) --------------------------------

describe('index-native preparation never materialises a full row while preparing', () => {
  it.each([
    [
      'a value sort',
      makeQuery({ sortModel: [{ colId: 'value', sort: 'asc' }] }, 20_000),
    ],
    [
      'a type filter',
      makeQuery(
        {
          filterModel: {
            type: { filterType: 'text', type: 'equals', filter: 'temperature' },
          },
        },
        20_000,
      ),
    ],
    [
      'a date range filter',
      makeQuery(
        {
          filterModel: {
            timestamp: {
              filterType: 'date',
              type: 'inRange',
              dateFrom: naive(0),
              dateTo: naive(19_999),
            },
          },
        },
        20_000,
      ),
    ],
    [
      'a multi-column sort',
      makeQuery(
        {
          sortModel: [
            { colId: 'type', sort: 'asc' },
            { colId: 'value', sort: 'desc' },
          ],
        },
        20_000,
      ),
    ],
  ] as const)(
    'calls telemetryAt zero times preparing %s, then exactly 200 times paging 200 rows',
    async (_label, query) => {
      const spy = vi.spyOn(generatorModule, 'telemetryAt');
      const index = await prepareHistory(query);
      expect(spy).not.toHaveBeenCalled();
      historyPage(index, 100, 300);
      expect(spy).toHaveBeenCalledTimes(200);
    },
  );
});

describe('index-native preparation output size', () => {
  it('produces a full-length Uint32Array for an unfiltered value sort', async () => {
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'value', sort: 'asc' }] }, 500_000),
    );
    expect(index.indices).not.toBeNull();
    expect(index.indices!.byteLength).toBe(2_000_000);
  });
  it('sizes the index to the match count for a filter', async () => {
    const total = 500_000;
    const filterModel = {
      type: { filterType: 'text', type: 'equals', filter: 'temperature' },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    const matched = referenceIndices({
      total,
      filterModel,
      sortModel: [],
    }).length;
    expect(index.indices).not.toBeNull();
    expect(index.indices!.byteLength).toBe(4 * matched);
  });
});

describe('the timestamp sort fast path skips keying and merging entirely', () => {
  it('returns identity order for an ascending timestamp sort', async () => {
    const total = 500_000;
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'timestamp', sort: 'asc' }] }, total),
    );
    expect(index.indices).toBeNull();
    expect(index.total).toBe(total);
    expect(index.stats.keyed).toBe(0);
    expect(index.stats.mergePasses).toBe(0);
    expect(index.stats.filtered).toBe(0);
  });
  it('returns a fully reversed dense index for a descending timestamp sort', async () => {
    const total = 500_000;
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'timestamp', sort: 'desc' }] }, total),
    );
    expect(index.indices).not.toBeNull();
    expect(index.indices![0]).toBe(total - 1);
    expect(index.indices![index.indices!.length - 1]).toBe(0);
    expect(index.stats.keyed).toBe(0);
    expect(index.stats.mergePasses).toBe(0);
  });
});

describe('a lone timestamp range filter skips the per-row scan', () => {
  it('matches the reference for an inRange timestamp filter alone', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'inRange',
        dateFrom: naive(1000),
        dateTo: naive(3000),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('counts an inRange timestamp filter over 500000 rows without a per-row scan', async () => {
    const total = 500_000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'inRange',
        dateFrom: naive(100_000),
        dateTo: naive(300_000),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(index.total).toBe(200_001);
  });

  it('matches the reference for a greaterThan timestamp filter alone', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'greaterThan',
        dateFrom: naive(4990),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('counts a greaterThan timestamp filter over 500000 rows without a per-row scan', async () => {
    const total = 500_000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'greaterThan',
        dateFrom: naive(499_000),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(index.total).toBe(999);
  });

  it('matches the reference for a lessThanOrEqual timestamp filter alone', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'lessThanOrEqual',
        dateFrom: naive(10),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('counts a lessThanOrEqual timestamp filter over 500000 rows without a per-row scan', async () => {
    const total = 500_000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'lessThanOrEqual',
        dateFrom: naive(50),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(index.total).toBe(51);
  });

  it('matches the reference for an equals timestamp filter alone', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: { filterType: 'date', type: 'equals', dateFrom: naive(2500) },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('counts an equals timestamp filter over 500000 rows without a per-row scan', async () => {
    const total = 500_000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'equals',
        dateFrom: naive(250_000),
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(0);
    expect(index.total).toBe(1);
  });

  it('narrows the per-row scan to the timestamp range when another column also filters', async () => {
    const total = 500_000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        type: 'inRange',
        dateFrom: naive(100_000),
        dateTo: naive(300_000),
      },
      type: { filterType: 'text', type: 'equals', filter: 'temperature' },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(200_001);
  });
});

describe('non-range timestamp filters fall back to the general per-row path', () => {
  it('scans every row for a compound AND of two timestamp bounds', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        operator: 'AND',
        conditions: [
          {
            filterType: 'date',
            type: 'greaterThanOrEqual',
            dateFrom: naive(1000),
          },
          {
            filterType: 'date',
            type: 'lessThanOrEqual',
            dateFrom: naive(3000),
          },
        ],
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(total);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('scans every row for an OR of two timestamp equals', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: {
        filterType: 'date',
        operator: 'OR',
        conditions: [
          { filterType: 'date', type: 'equals', dateFrom: naive(10) },
          { filterType: 'date', type: 'equals', dateFrom: naive(4000) },
        ],
      },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(total);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('scans every row for a notEqual timestamp filter', async () => {
    const total = 5000;
    const filterModel = {
      timestamp: { filterType: 'date', type: 'notEqual', dateFrom: naive(10) },
    };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(total);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
  it('scans every row for a blank timestamp filter', async () => {
    const total = 5000;
    const filterModel = { timestamp: { filterType: 'date', type: 'blank' } };
    const index = await prepareHistory(makeQuery({ filterModel }, total));
    expect(index.stats.filtered).toBe(total);
    expect(order(index)).toEqual(
      referenceIndices({ total, filterModel, sortModel: [] }),
    );
  });
});

describe('sort key and merge-pass accounting', () => {
  it('keys every matched row once and runs ceil(log2(N)) merge passes for an unfiltered value sort', async () => {
    const total = 20_000;
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'value', sort: 'asc' }] }, total),
    );
    expect(index.stats.keyed).toBe(total);
    expect(index.stats.mergePasses).toBe(Math.ceil(Math.log2(total)));
    expect(index.stats.filtered).toBe(0);
  });
});

describe('cooperative yield points', () => {
  const dueEveryCheck = () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 100));
  };
  const sortYields = (total: number) =>
    Math.ceil(total / QUERY_CHUNK_ROWS) +
    Math.ceil(Math.log2(total)) * (Math.ceil(total / MERGE_CHUNK_OUTPUTS) - 1);

  it('yields at every key chunk and between merge chunks when each budget check is due', async () => {
    dueEveryCheck();
    const total = 100_000;
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'value', sort: 'asc' }] }, total),
    );
    expect(index.stats.yields).toBe(sortYields(total));
  });
  it('yields at every scan chunk of a filter when each budget check is due', async () => {
    dueEveryCheck();
    const total = 50_000;
    const index = await prepareHistory(
      makeQuery(
        {
          filterModel: {
            type: { filterType: 'text', type: 'equals', filter: 'humidity' },
          },
        },
        total,
      ),
    );
    expect(index.stats.yields).toBe(Math.ceil(total / QUERY_CHUNK_ROWS));
  });
  it('keeps each synchronous chunk small enough for the time budget to be checked often', () => {
    // The counts above follow these sizes, so they alone would stay green if a
    // chunk grew until one task blocked the main thread for most of a scan.
    expect(QUERY_CHUNK_ROWS).toBeLessThanOrEqual(4096);
    expect(MERGE_CHUNK_OUTPUTS).toBeLessThanOrEqual(65536);
  });
  it('never yields more often than its chunk boundaries on a real clock', async () => {
    const total = 500_000;
    const index = await prepareHistory(
      makeQuery({ sortModel: [{ colId: 'value', sort: 'asc' }] }, total),
    );
    expect(index.stats.yields).toBeLessThanOrEqual(sortYields(total));
  });
});

// --- cancellation ------------------------------------------------------------

describe('cancellation', () => {
  it('rejects immediately for an already aborted signal, before doing any work', async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi.spyOn(generatorModule, 'telemetryAt');
    await expect(
      prepareHistory(
        makeQuery(
          {
            sortModel: [{ colId: 'value', sort: 'asc' }],
            signal: controller.signal,
          },
          1000,
        ),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects when aborted mid-flight during a large value sort', async () => {
    const controller = new AbortController();
    const pending = prepareHistory(
      makeQuery(
        {
          sortModel: [{ colId: 'value', sort: 'asc' }],
          signal: controller.signal,
        },
        500_000,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when aborted mid-flight during a large filtered scan', async () => {
    const controller = new AbortController();
    const pending = prepareHistory(
      makeQuery(
        {
          filterModel: {
            value: { filterType: 'number', type: 'greaterThan', filter: 10 },
          },
          sortModel: [{ colId: 'quality', sort: 'asc' }],
          signal: controller.signal,
        },
        500_000,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('proves the abort happens during work, after the engine has already yielded once', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 100));
    const controller = new AbortController();
    const pending = prepareHistory(
      makeQuery(
        {
          sortModel: [{ colId: 'value', sort: 'asc' }],
          signal: controller.signal,
        },
        500_000,
      ),
    );
    // Queued right after the engine starts: this message fires strictly after
    // the engine's own first `pause()` message, proving at least one yield
    // already happened before the abort below is observed.
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        controller.abort();
        resolve();
      };
      channel.port2.postMessage(null);
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// --- one filter grammar ------------------------------------------------------

describe('grid-state restoration never hands the engine a filter it rejects', () => {
  // The Historical Logs filter schema is derived from the columns the grid
  // actually renders, so a column change is noticed here rather than only at
  // runtime.
  const schema = filterSchemaFor(historyColumns, defaultColDef);
  it('derives the expected filter schema from the Historical Logs columns', () => {
    expect(schema).toEqual({
      timestamp: 'date',
      deviceId: 'text',
      location: 'text',
      type: 'text',
      status: 'text',
      message: 'text',
      value: 'number',
      quality: 'number',
      // `unit` has `filter: false`, so it never appears here.
    });
  });
  const comparisons = [
    'equals',
    'notEqual',
    'lessThan',
    'lessThanOrEqual',
    'greaterThan',
    'greaterThanOrEqual',
  ];
  const leaves: Record<'text' | 'number' | 'date', unknown[]> = {
    text: [
      ...[
        'equals',
        'notEqual',
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
      ].map((type) => ({ filterType: 'text', type, filter: 'war' })),
      { filterType: 'text', type: 'contains' },
      { filterType: 'text', type: 'contains', filter: 7 },
      { filterType: 'text', type: 'regex', filter: 'x' },
    ],
    number: [
      ...comparisons.map((type) => ({
        filterType: 'number',
        type,
        filter: 40,
      })),
      { filterType: 'number', type: 'inRange', filter: 10, filterTo: 40 },
      { filterType: 'number', type: 'inRange', filter: 10 },
      { filterType: 'number', type: 'equals', filter: '40' },
    ],
    date: [
      ...comparisons.map((type) => ({
        filterType: 'date',
        type,
        dateFrom: naive(5),
        dateTo: null,
      })),
      {
        filterType: 'date',
        type: 'inRange',
        dateFrom: naive(5),
        dateTo: naive(50),
      },
      { filterType: 'date', type: 'inRange', dateFrom: naive(5) },
      { filterType: 'date', type: 'equals', dateFrom: '2026-09-01T12:00:05' },
      { filterType: 'date', type: 'equals' },
    ],
  };
  const candidates = Object.entries(schema).flatMap(([column, filterType]) => {
    const own = leaves[filterType as 'text' | 'number' | 'date'] ?? [];
    const blanks = ['blank', 'notBlank'].map((type) => ({ filterType, type }));
    const combined = ['AND', 'OR'].flatMap((operator) => [
      { filterType, operator, conditions: [own[0], own[1]] },
      { filterType, operator, conditions: [own[0]] },
      { filterType, operator, conditions: [] },
      { filterType, operator, conditions: [own[0], own[1], own[2]] },
    ]);
    const booleans = ['true', 'false'].map((type) => ({
      filterType: 'text',
      type,
    }));
    return [...own, ...blanks, ...combined, ...booleans].map(
      (model) => [column, model] as const,
    );
  });

  it('executes every model grid-state restoration keeps for a Historical Logs column', async () => {
    let restorable = 0;
    const rejected: string[] = [];
    for (const [column, model] of candidates) {
      const restored = deserializeState(
        JSON.stringify({
          version: '36.1.0',
          filter: { filterModel: { [column]: model } },
        }),
        schema,
      )?.filter?.filterModel?.[column];
      if (!restored) continue;
      restorable++;
      // Any rejection counts against the correspondence, not only the
      // engine's own UnsupportedQueryError: a model restoration kept alive
      // that the engine chokes on for some other reason is just as much a gap.
      try {
        await prepareHistory(
          makeQuery({ filterModel: { [column]: restored } }, 50),
        );
      } catch (error) {
        rejected.push(
          `${column}: ${(error as Error).name}: ${JSON.stringify(restored)}`,
        );
      }
    }
    // Not vacuous: the well-formed models survive restoration.
    // Pinned: a change to either grammar must revisit this count rather than
    // let the correspondence pass over fewer models.
    expect(restorable).toBe(99);
    // Historical Logs has no 'boolean'-schema column, so grid-state restoration
    // itself now drops a 'true'/'false' text filter on every one of its columns
    // (see filterSchema/storage: 'text' columns reject that type). Nothing
    // restoration keeps should be a model the engine then rejects.
    expect(rejected).toEqual([]);
  });
});
