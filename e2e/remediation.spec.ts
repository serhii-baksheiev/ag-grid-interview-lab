import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateDevices } from '../src/shared/data/generator';

async function openView(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function visibleGrid(page: Page, name?: string) {
  const grid = name
    ? page.getByRole('grid', { name, exact: true })
    : page.getByRole('grid');
  await expect(grid).toBeVisible();
  return grid;
}

async function renameFirstDevice(page: Page, name: string) {
  await page
    .getByRole('gridcell', { name: generateDevices(1)[0]!.name, exact: true })
    .dblclick();
  const editor = page.getByRole('textbox', { name: 'Device name editor' });
  await editor.fill(name);
  await page.keyboard.press('Enter');
}

function computedBackground(locator: Locator) {
  return locator.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
}

test('applies a 10k live stress stream and resets changed rows without losing the grid', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByLabel('Devices', { exact: true }).selectOption('10000');
  const reset = page.getByRole('button', { name: 'Reset data', exact: true });
  await expect(reset).toBeEnabled({ timeout: 15000 });
  await page.getByLabel('Tick interval', { exact: true }).selectOption('100');
  await page.getByLabel('Changes / tick', { exact: true }).selectOption('1000');
  await page.getByLabel('Burst every 8 ticks').check();
  const applied = page
    .getByText('APPLIED UPDATES', { exact: true })
    .locator('..')
    .locator('strong');
  await expect
    .poll(async () => Number((await applied.innerText()).replaceAll(',', '')))
    .toBeGreaterThan(10000);
  await page.getByRole('button', { name: 'Pause stream' }).click();
  await reset.click();
  await expect(reset).toBeEnabled({ timeout: 15000 });
  await expect(page.getByRole('gridcell').first()).toBeVisible();
  await expect(applied).toHaveText('0');
  await page.getByLabel('Devices', { exact: true }).selectOption('1000');
  await expect(reset).toBeEnabled({ timeout: 15000 });
  await expect(
    page
      .getByText('CONNECTED SENSORS', { exact: true })
      .locator('..')
      .locator('strong'),
  ).toHaveText('1,000');
  await expect(page.getByRole('gridcell').first()).toBeVisible();
});

test('applies and persists a distinct AG Grid dark theme', async ({ page }) => {
  await page.goto('/');
  await visibleGrid(page);
  const gridRoot = page.locator('.ag-root-wrapper').first();
  const lightBackground = await computedBackground(gridRoot);

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(
    page.getByRole('button', { name: 'Use light theme' }),
  ).toBeVisible();
  const darkBackground = await computedBackground(gridRoot);
  expect(darkBackground).not.toBe(lightBackground);

  await page.reload();
  await visibleGrid(page);
  await expect(
    page.getByRole('button', { name: 'Use light theme' }),
  ).toBeVisible();
  await expect
    .poll(() => computedBackground(page.locator('.ag-root-wrapper').first()))
    .toBe(darkBackground);

  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect
    .poll(() => computedBackground(page.locator('.ag-root-wrapper').first()))
    .toBe(lightBackground);
});

test('finishes the latest historical request after rapid datasource replacement', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Historical Logs');
  await visibleGrid(page);
  await page
    .getByLabel('Network latency', { exact: true })
    .selectOption('1500');
  await page.getByLabel('Dataset size', { exact: true }).selectOption('10000');
  await page.getByLabel('Dataset size', { exact: true }).selectOption('500000');

  await expect(page.getByText('500,000', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('gridcell').first()).toBeVisible({
    timeout: 10000,
  });

  await page
    .getByRole('button', { name: 'Refresh cache', exact: true })
    .click();
  await expect(
    page
      .locator('.metric')
      .filter({ hasText: 'Pending requests' })
      .locator('strong'),
  ).toHaveText('0', { timeout: 10000 });
  await expect(page.getByRole('gridcell').first()).toBeVisible({
    timeout: 10000,
  });
});

for (const recovery of ['Retry', 'Refresh cache'])
  test(`removes the historical error banner after ${recovery}`, async ({
    page,
  }) => {
    await page.goto('/');
    await openView(page, 'Historical Logs');
    await visibleGrid(page);
    await page.getByLabel('Simulate request error', { exact: true }).check();
    await expect(page.getByRole('alert')).toContainText(
      'Historical request failed',
    );
    await expect(
      page
        .getByText('Pending requests', { exact: true })
        .locator('..')
        .locator('strong'),
    ).toHaveText('0');

    await page.getByLabel('Simulate request error', { exact: true }).uncheck();
    await page.getByRole('button', { name: recovery, exact: true }).click();
    await expect(page.getByRole('gridcell').first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('does not overwrite newer device-filter typing with an old grid update', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Historical Logs');
  const filter = page.getByLabel('Device filter', { exact: true });
  await filter.fill('device-00');
  // The pause matches the documented debounce race: the first grid event is now in flight.
  await page.waitForTimeout(380);
  await filter.pressSequentially('0');
  await filter.pressSequentially('1');
  await expect(filter).toHaveValue('device-0001');
  await expect(page.getByText('device-0001', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(filter).toHaveValue('device-0001');
});

test('keeps column controls inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await openView(page, 'Analytics');
  const columns = page.locator('.column-controls').first();
  await columns.getByText('Columns', { exact: true }).click();
  const popover = columns.locator('> div');
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

test('makes each data grid discoverable by an accessible name', async ({
  page,
}) => {
  await page.goto('/');
  await visibleGrid(page, 'Live telemetry grid');
  await openView(page, 'Historical Logs');
  await visibleGrid(page, 'Historical measurements grid');
  await openView(page, 'Device Configuration');
  await visibleGrid(page, 'Device configuration grid');
  await openView(page, 'Analytics');
  await visibleGrid(page, 'Analytics summary grid');
});

test('meets AA contrast for the normal-status label', async ({ page }) => {
  await page.goto('/');
  const ratio = await page
    .locator('.status-normal')
    .first()
    .evaluate((element) => {
      const parse = (color: string) => color.match(/\d+/g)!.map(Number);
      const luminance = (color: number[]) => {
        const [red, green, blue] = color.slice(0, 3).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const styles = getComputedStyle(element);
      const foreground = luminance(parse(styles.color));
      const background = luminance(parse(styles.backgroundColor));
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

for (const theme of ['light', 'dark'] as const) {
  for (const view of [
    'Live Telemetry',
    'Historical Logs',
    'Device Configuration',
    'Analytics',
  ]) {
    test(`has no axe violations: ${theme} ${view}`, async ({ page }) => {
      await page.goto('/');
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Use dark theme' }).click();
      }
      await openView(page, view);
      await expect(page.getByRole('grid')).toBeVisible();
      const report = await new AxeBuilder({ page }).include('main').analyze();
      expect(report.violations).toEqual([]);
    });
  }
}

test('focuses the safe cancellation choice in the delete confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  const row = page.getByRole('row').filter({
    has: page.getByRole('gridcell', {
      name: generateDevices(1)[0]!.name,
      exact: true,
    }),
  });
  await row.getByRole('checkbox').first().check();
  await page
    .getByRole('button', { name: 'Delete selected', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel deletion', exact: true }),
  ).toBeFocused();
});

test('describes an invalid name editor error to assistive technology', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await page
    .getByRole('gridcell', { name: generateDevices(1)[0]!.name, exact: true })
    .dblclick();
  const editor = page.getByRole('textbox', { name: 'Device name editor' });
  await editor.fill(' ');
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await editor.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText(/name/i);
});

test('does not apply Ctrl+Z while a pessimistic save is pending', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  await renameFirstDevice(page, 'Save remains stable');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole('button', { name: 'Save all', exact: true }).click();
  await expect(
    page.getByText('Saving changes…', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('gridcell', { name: 'Save remains stable', exact: true })
    .click();
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+z' : 'Control+z',
  );
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(500);
  await expect(
    page.getByText('Saved successfully', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: 'Save remains stable', exact: true }),
  ).toBeVisible();
});

test('restores a saved boolean filter view and lets the user reset it', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'iot-lab:v1:configuration',
      JSON.stringify({
        version: '36.1.0',
        columnSizing: { columnSizingModel: [{ colId: 'name', width: 400 }] },
        sort: { sortModel: [{ colId: 'samplingInterval', sort: 'desc' }] },
        filter: {
          filterModel: {
            enabled: { filterType: 'text', type: 'true' },
          },
        },
      }),
    );
  });
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  await page.reload();
  await openView(page, 'Device Configuration');
  await expect(page.locator('[role="columnheader"][col-id="name"]')).toHaveCSS(
    'width',
    '400px',
  );
  const readView = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('iot-lab:v1:configuration')!),
    );
  await expect
    .poll(async () => (await readView()).filter.filterModel.enabled)
    .toEqual({ filterType: 'text', type: 'true' });
  await expect
    .poll(async () => (await readView()).sort.sortModel)
    .toMatchObject([{ colId: 'samplingInterval', sort: 'desc' }]);
  await page.getByRole('button', { name: 'Reset State', exact: true }).click();
  await expect
    .poll(async () => (await readView()).filter?.filterModel ?? {})
    .toEqual({});
  await page.reload();
  await openView(page, 'Device Configuration');
  await expect(page.locator('[role="columnheader"][col-id="name"]')).toHaveCSS(
    'width',
    '225px',
  );
});

test('discards malformed stored filters and keeps every screen reachable', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const key of ['live', 'history', 'configuration', 'analytics'])
      localStorage.setItem(
        `iot-lab:v1:${key}`,
        JSON.stringify({
          version: '36.1.0',
          filter: {
            filterModel: {
              deviceId: { filterType: 'text', operator: 'OR', conditions: [] },
            },
          },
        }),
      );
  });
  await page.reload();
  for (const name of [
    'Historical Logs',
    'Device Configuration',
    'Analytics',
    'Live Telemetry',
  ]) {
    await openView(page, name);
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Reset State', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('This view could not be displayed.'),
    ).toHaveCount(0);
  }
});

test('sorts the virtual 500k dataset while remaining responsive', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await openView(page, 'Historical Logs');
  await page.getByLabel('Network latency', { exact: true }).selectOption('0');
  await page.getByLabel('Dataset size', { exact: true }).selectOption('500000');
  await expect(
    page.locator('[row-index="0"] [col-id="value"]'),
  ).not.toBeEmpty();
  await page.locator('[role="columnheader"][col-id="value"]').click();
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(
    page.getByRole('button', { name: 'Use light theme' }),
  ).toBeVisible();
  await expect(
    page
      .getByText('Pending requests', { exact: true })
      .locator('..')
      .locator('strong'),
  ).toHaveText('0', { timeout: 30000 });
  await expect(page.locator('[row-index="0"] [col-id="value"]')).toHaveText(
    '0',
  );
  const values = await page
    .locator('[role="gridcell"][col-id="value"]')
    .allTextContents();
  expect(values.length).toBeGreaterThan(1);
  expect(values.map(Number)).toEqual(values.map(Number).sort((a, b) => a - b));
});
