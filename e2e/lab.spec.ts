import { expect, test, type Page } from '@playwright/test';
import { generateDevices } from '../src/shared/data/generator';

const browserErrors = new Map<object, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(
    browserErrors.get(page) ?? [],
    'Browser must not report uncaught exceptions or console errors',
  ).toEqual([]);
  browserErrors.delete(page);
});

async function renameDevice(page: Page, oldName: string, newName: string) {
  await page.getByRole('gridcell', { name: oldName, exact: true }).dblclick();
  await page
    .getByRole('textbox')
    .filter({ visible: true })
    .last()
    .fill(newName);
  await page.keyboard.press('Enter');
}

test('rejects invalid thresholds and supports undo and redo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Device Configuration', exact: true })
    .click();
  const original = generateDevices(1)[0]!;
  await page
    .locator('[row-id="device-00001"] [col-id="warningThreshold"]')
    .click();
  await page.keyboard.press('Enter');
  await page
    .getByRole('spinbutton')
    .fill(String(original.criticalThreshold + 1));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Edit rejected');
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss validation' }).click();
  await renameDevice(page, original.name, 'Undo this edit');
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('gridcell', { name: original.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('gridcell', { name: 'Undo this edit', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
});

test('saves and reverts selected rows and stages reversible deletion', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Device Configuration', exact: true })
    .click();
  const original = generateDevices(2);
  await renameDevice(page, original[0]!.name, 'Selected draft');
  await renameDevice(page, original[1]!.name, 'Unselected draft');
  const selectedRow = page.getByRole('row').filter({
    has: page.getByRole('gridcell', { name: 'Selected draft', exact: true }),
  });
  await selectedRow.getByRole('checkbox').first().check();
  await page
    .getByRole('button', { name: 'Save selected', exact: true })
    .click();
  await expect(
    page.getByText('Saved successfully', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
  await renameDevice(page, 'Selected draft', 'Another selected draft');
  await page
    .getByRole('button', { name: 'Revert selected', exact: true })
    .click();
  await expect(
    page.getByRole('gridcell', { name: 'Selected draft', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: 'Unselected draft', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete selected', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page
    .getByRole('button', { name: 'Cancel deletion', exact: true })
    .click();
  await expect(
    page.getByRole('gridcell', { name: 'Selected draft', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete selected', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm deletion', exact: true })
    .click();
  await expect(
    page.getByRole('gridcell', { name: 'Selected draft', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('2 unsaved changes', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revert all', exact: true }).click();
  // Saving a selection preserves baseline order, so a revert does not move rows.
  await expect(
    page.getByRole('gridcell', { name: 'Selected draft', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();
});

test('keeps active history filters through dataset and latency changes', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Historical Logs', exact: true })
    .click();
  await page
    .getByLabel('Device filter', { exact: true })
    .fill('no-such-device');
  await expect(
    page.getByText('No rows to show', { exact: true }),
  ).toBeVisible();
  const timestamp = page.getByRole('columnheader', {
    name: 'Timestamp · UTC',
    exact: true,
  });
  await timestamp.click();
  await expect(timestamp).toHaveAttribute('aria-sort', 'ascending');
  await page.getByLabel('Dataset size', { exact: true }).selectOption('10000');
  await expect(
    page.getByText('No rows to show', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Network latency', { exact: true }).selectOption('750');
  await expect(
    page.getByText('No rows to show', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Device filter', { exact: true })).toHaveValue(
    'no-such-device',
  );
  await expect(timestamp).toHaveAttribute('aria-sort', 'ascending');
});

test('resets live counters without negative rates and stops applying updates when paused', async ({
  page,
}) => {
  await page.goto('/');
  const applied = page
    .getByText('APPLIED UPDATES', { exact: true })
    .locator('..')
    .locator('strong');
  const rate = page
    .getByText('EVENTS / SECOND', { exact: true })
    .locator('..')
    .locator('strong');
  await expect
    .poll(async () => Number((await applied.innerText()).replaceAll(',', '')))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Reset data', exact: true }).click();
  await page.getByRole('button', { name: 'Pause stream', exact: true }).click();
  await expect
    .poll(async () =>
      Number.parseFloat((await rate.innerText()).replaceAll(',', '')),
    )
    .toBe(0);
  // Allow the diagnostics to publish transactions already queued before Pause.
  await page.clock.install();
  await page.clock.runFor(1100);
  const stable = await applied.innerText();
  // One diagnostics interval is needed to observe stability, not merely the immediate label.
  await page.clock.runFor(1100);
  await expect(applied).toHaveText(stable);
  expect(Number(stable.replaceAll(',', ''))).toBeGreaterThanOrEqual(0);
  expect(
    Number.parseFloat((await rate.innerText()).replaceAll(',', '')),
  ).toBeGreaterThanOrEqual(0);
});

test('restores a saved analytics column view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  await page.getByText('Columns', { exact: true }).click();
  await page.getByLabel('Average', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(page.getByText('View saved', { exact: true })).toBeVisible();
  await page.getByLabel('Average', { exact: true }).check();
  await expect(
    page.getByRole('columnheader', { name: 'Average', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore view', exact: true }).click();
  await expect(page.getByText('View restored', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Average', exact: true }),
  ).toHaveCount(0);
});

test('keeps each screen inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const screen of [
    'Live Telemetry',
    'Historical Logs',
    'Device Configuration',
    'Analytics',
    'Interview Guide',
  ]) {
    await page.getByRole('button', { name: screen, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      screen,
    ).toBe(true);
  }
});

test('opens live rows and pauses telemetry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(
    page.getByRole('gridcell', {
      name: generateDevices(1)[0]!.name,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause stream', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start stream', exact: true }),
  ).toBeVisible();
});

test('filters historical logs and retries a failed request', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Historical Logs', exact: true })
    .click();
  await page
    .getByLabel('Device filter', { exact: true })
    .fill('no-such-device');
  await expect(
    page.getByText('No rows to show', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Device filter', { exact: true }).fill('');
  await page.getByLabel('Simulate request error', { exact: true }).check();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Simulate request error', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('gridcell').first()).toBeVisible();
});

test('edits and saves device configuration', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Device Configuration', exact: true })
    .click();
  const cell = page.getByRole('gridcell', {
    name: generateDevices(1)[0]!.name,
    exact: true,
  });
  await cell.dblclick();
  await page
    .getByRole('textbox')
    .filter({ visible: true })
    .last()
    .fill('Interview sensor');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save all', exact: true }).click();
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: 'Interview sensor', exact: true }),
  ).toBeVisible();
});

test('preserves edits after save failure and allows revert', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Device Configuration', exact: true })
    .click();
  await page
    .getByRole('gridcell', { name: generateDevices(1)[0]!.name, exact: true })
    .dblclick();
  await page
    .getByRole('textbox')
    .filter({ visible: true })
    .last()
    .fill('Keep my changes');
  await page.keyboard.press('Enter');
  await page.getByLabel('Simulate save error', { exact: true }).check();
  await page.getByRole('button', { name: 'Save all', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/save/i);
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: 'Keep my changes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revert all', exact: true }).click();
  await expect(
    page.getByRole('gridcell', {
      name: generateDevices(1)[0]!.name,
      exact: true,
    }),
  ).toBeVisible();
});

test('restores live column visibility after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Show Location', { exact: true }).uncheck();
  await expect(
    page.getByRole('columnheader', { name: 'Location', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel('Show Location', { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('columnheader', { name: 'Location', exact: true }),
  ).toHaveCount(0);
});

test('loads 10,000 live devices and filters 500,000 history records', async ({
  page,
}) => {
  await page.goto('/');
  test.setTimeout(60000);
  await page.getByLabel('Devices', { exact: true }).selectOption('10000');
  await page.getByLabel('Changes / tick', { exact: true }).selectOption('1000');
  await page.getByRole('button', { name: 'Pause stream', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start stream', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Historical Logs', exact: true })
    .click();
  await page.getByLabel('Dataset size', { exact: true }).selectOption('500000');
  await expect(page.getByRole('gridcell').first()).toBeVisible();
  await page
    .getByLabel('Device filter', { exact: true })
    .fill('no-such-device');
  await expect(page.getByText('No rows to show', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole('button', { name: 'Live Telemetry', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Pause stream', exact: true }),
  ).toBeVisible();
});
