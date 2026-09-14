// Isolated historical query benchmark. Builds the query engine with Vite
// (minified IIFE), loads it into a blank Playwright Chromium page and runs each
// scenario several times over the virtual 500,000-record dataset. No grid, no
// network latency. Local engineering evidence only — never a CI gate.
//
//   node scripts/history-benchmark.mjs <label> [--entry <query.ts>] [--runs <n>]
//
// `--entry` points the same harness at another revision's query.ts (for example a
// `git worktree` of the baseline), so before/after figures share one method.
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { requireAbort } from './require-abort.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const label = args[0] && !args[0].startsWith('--') ? args[0] : 'sample';
const entry = option('--entry', 'src/features/historical-logs/query.ts');
const runsPerScenario = Number(option('--runs', 5));
const TOTAL = 500000;
const scenarios = {
  'value-asc': {
    filterModel: {},
    sortModel: [{ colId: 'value', sort: 'asc' }],
  },
  'timestamp-asc': {
    filterModel: {},
    sortModel: [{ colId: 'timestamp', sort: 'asc' }],
  },
  'timestamp-desc': {
    filterModel: {},
    sortModel: [{ colId: 'timestamp', sort: 'desc' }],
  },
  'type-filter-value-desc': {
    filterModel: {
      type: { filterType: 'text', type: 'equals', filter: 'temperature' },
    },
    sortModel: [{ colId: 'value', sort: 'desc' }],
  },
};

const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry, name: 'HistoryBench', formats: ['iife'] },
    minify: true,
  },
});
const code = (Array.isArray(result) ? result[0] : result).output[0].code;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.setContent('<h1>Isolated query benchmark</h1>');
await page.addScriptTag({ content: code });
await page.addScriptTag({
  content: `globalThis.requireAbort = ${requireAbort.toString()};`,
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metric = (data, name) => data.metrics.find((x) => x.name === name).value;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const report = {};
for (const [name, query] of Object.entries(scenarios)) {
  const runs = [];
  for (let i = 0; i < runsPerScenario; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Performance.getMetrics');
    const run = await page.evaluate(
      async ({ query, total }) => {
        let yields = 0,
          maxLag = 0,
          last = performance.now();
        const NativeChannel = window.MessageChannel;
        window.MessageChannel = class extends NativeChannel {
          constructor() {
            super();
            yields++;
          }
        };
        const nativeTimer = window.setTimeout;
        window.setTimeout = (fn, ms, ...rest) => {
          if (ms === 0) yields++;
          return nativeTimer(fn, ms, ...rest);
        };
        const timer = setInterval(() => {
          const now = performance.now();
          maxLag = Math.max(maxLag, now - last - 16);
          last = now;
        }, 16);
        const start = performance.now();
        const prepared = await HistoryBench.prepareHistory({
          total,
          startRow: 0,
          endRow: 200,
          ...query,
        });
        const wallMs = performance.now() - start;
        const page = HistoryBench.historyPage(prepared, 0, 3).rows;
        clearInterval(timer);
        window.setTimeout = nativeTimer;
        window.MessageChannel = NativeChannel;
        return {
          wallMs,
          yields,
          maxLagMs: maxLag,
          total: prepared.total,
          first: page.map((row) => row.id),
          indexBytes: prepared.indices?.byteLength ?? 0,
          stats: prepared.stats ?? null,
        };
      },
      { query, total: TOTAL },
    );
    const after = await cdp.send('Performance.getMetrics');
    run.cpuTaskMs =
      (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000;
    run.heapUsedDeltaBytes =
      metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize');
    runs.push(run);
  }
  report[name] = {
    medianWallMs: median(runs.map((run) => run.wallMs)),
    medianCpuTaskMs: median(runs.map((run) => run.cpuTaskMs)),
    runs,
  };
}

// Cancellation evidence: abort a Value sort 20 ms after it starts.
const abort = await page.evaluate(async (total) => {
  const controller = new AbortController();
  let requested = 0;
  const started = performance.now();
  setTimeout(() => {
    requested = performance.now();
    controller.abort();
  }, 20);
  await globalThis.requireAbort(
    HistoryBench.prepareHistory({
      total,
      startRow: 0,
      endRow: 200,
      filterModel: {},
      sortModel: [{ colId: 'value', sort: 'asc' }],
      signal: controller.signal,
    }),
    controller.signal,
  );
  return {
    abortResponseMs: performance.now() - requested,
    abortEndToEndMs: performance.now() - started,
  };
}, TOTAL);
await browser.close();

const output = {
  label,
  entry,
  node: process.version,
  total: TOTAL,
  abort,
  report,
};
await mkdir('.claude/runs', { recursive: true });
await writeFile(
  `.claude/runs/history-${label}.json`,
  JSON.stringify(output, null, 2),
);
const summary = Object.fromEntries(
  Object.entries(report).map(([name, value]) => [
    name,
    {
      medianWallMs: Math.round(value.medianWallMs),
      medianCpuTaskMs: Math.round(value.medianCpuTaskMs),
      wallMs: value.runs.map((run) => Math.round(run.wallMs)),
      yields: value.runs.map((run) => run.yields),
      indexBytes: value.runs[0].indexBytes,
      first: value.runs[0].first,
    },
  ]),
);
console.log(JSON.stringify({ label, entry, abort, summary }, null, 2));
