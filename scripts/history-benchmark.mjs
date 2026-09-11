import { build } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { requireAbort } from './require-abort.mjs';
const label = process.argv[2] || 'sample';
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry: 'src/features/historical-logs/query.ts',
      name: 'HistoryBench',
      formats: ['iife'],
    },
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
const runs = [];
for (let i = 0; i < 3; i++) {
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Performance.getMetrics');
  const run = await page.evaluate(async () => {
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
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 0) yields++;
      return nativeTimer(fn, ms, ...args);
    };
    const scheduler = globalThis.scheduler;
    const nativeYield = scheduler?.yield?.bind(scheduler);
    if (nativeYield)
      scheduler.yield = () => {
        yields++;
        return nativeYield();
      };
    const timer = setInterval(() => {
      const now = performance.now();
      maxLag = Math.max(maxLag, now - last - 16);
      last = now;
    }, 16);
    const start = performance.now();
    const result = await HistoryBench.prepareHistory({
      total: 500000,
      startRow: 0,
      endRow: 200,
      filterModel: {},
      sortModel: [{ colId: 'value', sort: 'asc' }],
    });
    const wallMs = performance.now() - start;
    const first = HistoryBench.historyPage(result, 0, 2).rows.map(
      (x) => x.value,
    );
    clearInterval(timer);
    window.setTimeout = nativeTimer;
    window.MessageChannel = NativeChannel;
    if (nativeYield) scheduler.yield = nativeYield;
    const controller = new AbortController();
    let requested = 0;
    const abortStart = performance.now();
    nativeTimer(() => {
      requested = performance.now();
      controller.abort();
    }, 20);
    await globalThis.requireAbort(
      HistoryBench.prepareHistory({
        total: 500000,
        startRow: 0,
        endRow: 200,
        filterModel: {},
        sortModel: [{ colId: 'value', sort: 'asc' }],
        signal: controller.signal,
      }),
      controller.signal,
    );
    return {
      wallMs,
      yields,
      maxLagMs: maxLag,
      first,
      indexBytes: result.indices.byteLength,
      abortResponseMs: performance.now() - requested,
      abortEndToEndMs: performance.now() - abortStart,
    };
  });
  const after = await cdp.send('Performance.getMetrics');
  const metric = (data, name) =>
    data.metrics.find((x) => x.name === name).value;
  run.cpuTaskMs =
    (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000;
  run.heapUsedDeltaBytes =
    metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize');
  runs.push(run);
}
await browser.close();
await mkdir('.claude/runs', { recursive: true });
await writeFile(
  `.claude/runs/history-${label}.json`,
  JSON.stringify({ label, node: process.version, runs }, null, 2),
);
console.log(JSON.stringify({ label, runs }, null, 2));
