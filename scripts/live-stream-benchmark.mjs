// Main-thread cost of the live stream at its heaviest setting, unsorted and
// sorted by Reading. Run against a production preview:
//   npm run build && npm run preview -- --port 4175
//   node scripts/live-stream-benchmark.mjs
// Prints long tasks (> 50 ms) and the worst 16 ms timer drift for each
// configuration over a fixed observation window. Local diagnostics only.
import { chromium, expect } from '@playwright/test';

const WINDOW_MS = Number(process.env.WINDOW_MS ?? 10000);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4175');
await page.getByRole('button', { name: 'Pause stream' }).click();
await page.getByLabel('Devices', { exact: true }).selectOption('10000');
const reset = page.getByRole('button', { name: 'Reset data', exact: true });
await expect(reset).toBeEnabled({ timeout: 15000 });
await page.getByLabel('Tick interval', { exact: true }).selectOption('100');
await page.getByLabel('Changes / tick', { exact: true }).selectOption('1000');
await page.getByLabel('Burst every 8 ticks').check();

const results = {};
for (const sorted of [false, true]) {
  if (sorted) {
    await page.locator('[role="columnheader"][col-id="value"]').click();
    await expect(
      page.locator('[role="columnheader"][col-id="value"]'),
    ).toHaveAttribute('aria-sort', 'ascending');
  }
  await page.getByRole('button', { name: 'Start stream' }).click();
  await page.evaluate(() => {
    window.tasks = [];
    window.maxDrift = 0;
    let expected = performance.now() + 16;
    window.drift = setInterval(() => {
      const now = performance.now();
      window.maxDrift = Math.max(window.maxDrift, now - expected);
      expected = now + 16;
    }, 16);
    window.observer = new PerformanceObserver((list) =>
      window.tasks.push(
        ...list.getEntries().map((e) => Math.round(e.duration)),
      ),
    );
    window.observer.observe({ type: 'longtask' });
  });
  await page.waitForTimeout(WINDOW_MS);
  results[sorted ? 'sortedByReading' : 'unsorted'] = await page.evaluate(() => {
    clearInterval(window.drift);
    window.tasks.push(
      ...window.observer.takeRecords().map((e) => Math.round(e.duration)),
    );
    window.observer.disconnect();
    const tasks = window.tasks;
    return {
      longTaskCount: tasks.length,
      longTaskMaxMs: tasks.length ? Math.max(...tasks) : 0,
      longTaskMedianMs: tasks.length
        ? [...tasks].sort((a, b) => a - b)[Math.floor(tasks.length / 2)]
        : 0,
      longTaskTotalMs: tasks.reduce((sum, t) => sum + t, 0),
      maxTimerDriftMs: Math.round(window.maxDrift),
    };
  });
  await page.getByRole('button', { name: 'Pause stream' }).click();
}
console.log(JSON.stringify({ windowMs: WINDOW_MS, ...results }, null, 2));
await browser.close();
