// Analytics aggregation and render timings, measured with performance.mark and
// performance.measure. Local engineering evidence only — never a CI gate.
//
//   node scripts/analytics-benchmark.mjs aggregate <label> [--root <checkout>] [--runs <n>]
//     Builds that checkout's analytics model and generator with Vite into a blank
//     Chromium page and times the 10,000-record aggregation the Analytics screen
//     performs: summarizeHistory + summarizeLocations when the checkout has them,
//     otherwise the previous path (10,000 telemetryAt records, summarize, then a
//     filter per location).
//
//   node scripts/analytics-benchmark.mjs render <label> --url <preview> [--runs <n>]
//     Opens a production preview, marks the click on Analytics and measures until
//     the summary grid shows a cell, on a fresh page per run.
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const [mode, label = 'sample'] = args;
const runs = Number(option('--runs', mode === 'render' ? 5 : 20));
if (!['aggregate', 'render'].includes(mode))
  throw new Error('Mode must be "aggregate" or "render"');
if (!/^[\w.-]+$/.test(label)) throw new Error(`Invalid label "${label}"`);
if (!Number.isInteger(runs) || runs < 1)
  throw new Error('--runs must be a positive integer');
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const browser = await chromium.launch();
let durations = [];
let detail = {};
if (mode === 'aggregate') {
  const root = resolve(option('--root', '.')).replaceAll('\\', '/');
  await mkdir('.claude/runs', { recursive: true });
  const entry = `.claude/runs/analytics-entry-${label}.js`;
  await writeFile(
    entry,
    `export * as model from '${root}/src/features/analytics/model.ts';\n` +
      `export { telemetryAt } from '${root}/src/shared/data/generator.ts';\n`,
  );
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: { entry, name: 'AnalyticsBench', formats: ['iife'] },
      minify: true,
    },
  });
  await rm(entry);
  const code = (Array.isArray(result) ? result[0] : result).output[0].code;
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: code });
  const measured = await page.evaluate((runs) => {
    const { model, telemetryAt } = globalThis.AnalyticsBench;
    const indexNative = typeof model.summarizeHistory === 'function';
    const aggregate = () => {
      if (indexNative) {
        const rows = model.summarizeHistory(10000);
        return { rows, locations: model.summarizeLocations(rows) };
      }
      const rows = model.summarize(
        Array.from({ length: 10000 }, (_, i) => telemetryAt(i)),
      );
      const locations = [...new Set(rows.map((row) => row.location))].map(
        (location) => {
          const groups = rows.filter((row) => row.location === location);
          const count = groups.reduce((sum, row) => sum + row.count, 0);
          const alerts = groups.reduce((sum, row) => sum + row.alerts, 0);
          return { location, count, alerts, rate: (100 * alerts) / count };
        },
      );
      return { rows, locations };
    };
    const durations = [];
    let last;
    for (let run = 0; run < runs; run++) {
      performance.mark('aggregate:start');
      last = aggregate();
      performance.mark('aggregate:end');
      durations.push(
        performance.measure('aggregate', 'aggregate:start', 'aggregate:end')
          .duration,
      );
    }
    return {
      durations,
      indexNative,
      groups: last.rows.length,
      locations: last.locations.map(
        ({ location, rate }) => `${location} ${rate.toFixed(4)}`,
      ),
    };
  }, runs);
  durations = measured.durations;
  detail = {
    root,
    indexNative: measured.indexNative,
    groups: measured.groups,
    locations: measured.locations,
  };
} else {
  const url = option('--url');
  if (!url) throw new Error('render mode needs --url');
  for (let run = 0; run < runs; run++) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    await page.goto(url);
    await page.getByRole('grid').first().waitFor();
    const duration = await page.evaluate(
      () =>
        new Promise((resolveDuration) => {
          const done = () => {
            performance.mark('analytics:rendered');
            resolveDuration(
              performance.measure(
                'analytics',
                'analytics:click',
                'analytics:rendered',
              ).duration,
            );
          };
          const observer = new MutationObserver(() => {
            const grid = document.querySelector(
              '[aria-label="Analytics summary grid"]',
            );
            if (grid?.querySelector('[role="gridcell"]')) {
              observer.disconnect();
              done();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          const button = [...document.querySelectorAll('nav button')].find(
            (element) => element.getAttribute('aria-label') === 'Analytics',
          );
          performance.mark('analytics:click');
          button.click();
        }),
    );
    durations.push(duration);
    await page.close();
  }
  detail = { url };
}
await browser.close();

const output = {
  mode,
  label,
  runs,
  firstMs: durations[0],
  medianMs: median(durations),
  medianAfterFirstMs: durations.length > 1 ? median(durations.slice(1)) : null,
  durations,
  ...detail,
};
await mkdir('.claude/runs', { recursive: true });
await writeFile(
  `.claude/runs/analytics-${mode}-${label}.json`,
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify(
    { ...output, durations: durations.map((d) => Math.round(d * 100) / 100) },
    null,
    2,
  ),
);
