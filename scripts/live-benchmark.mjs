import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4175');
await page.getByRole('button', { name: 'Pause stream' }).click();
await page.getByLabel('Devices', { exact: true }).selectOption('10000');
const reset = page.getByRole('button', { name: 'Reset data', exact: true });
await expect(reset).toBeEnabled({ timeout: 15000 });
const results = [];
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    window.tasks = [];
    window.observer = new PerformanceObserver((list) =>
      window.tasks.push(...list.getEntries().map((e) => e.duration)),
    );
    window.observer.observe({ type: 'longtask' });
    window.started = performance.now();
  });
  await reset.click();
  await expect(reset).toBeEnabled({ timeout: 15000 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  results.push(
    await page.evaluate(() => {
      window.tasks.push(
        ...window.observer.takeRecords().map((e) => e.duration),
      );
      window.observer.disconnect();
      return {
        wallMs: performance.now() - window.started,
        longTasksMs: window.tasks,
      };
    }),
  );
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
