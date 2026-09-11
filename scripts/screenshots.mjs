import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4175');
await page.getByRole('button', { name: 'Pause stream' }).click();
await mkdir('docs/screenshots', { recursive: true });
async function shot(name) {
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    animations: 'disabled',
  });
}
await page.getByRole('button', { name: 'Use dark theme' }).click();
await shot('overview-dark');
await page.getByRole('button', { name: 'Use light theme' }).click();
await page.getByLabel('Search live').fill('temperature');
await shot('live-telemetry');
await page
  .getByRole('button', { name: 'Historical Logs', exact: true })
  .click();
await page.getByLabel('Device filter', { exact: true }).fill('device-0001');
await expect(page.locator('[row-index="0"] [col-id="deviceId"]')).toContainText(
  'device-0001',
);
await expect(
  page
    .getByText('Pending requests', { exact: true })
    .locator('..')
    .locator('strong'),
).toHaveText('0');
await shot('historical-logs');
await page
  .getByRole('button', { name: 'Device Configuration', exact: true })
  .click();
await page.getByRole('button', { name: 'Add device', exact: true }).click();
await expect(
  page.getByText('1 unsaved changes', { exact: true }),
).toBeVisible();
await shot('device-configuration');
await page.getByRole('button', { name: 'Analytics', exact: true }).click();
await expect(page.getByRole('gridcell').first()).toBeVisible();
await shot('analytics');
expect(errors).toEqual([]);
await browser.close();
