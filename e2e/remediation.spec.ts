import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateDevices, telemetryAt } from '../src/shared/data/generator';
import { failOnBrowserErrors } from './browserErrors';
import {
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './responsiveness';

failOnBrowserErrors(test);

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
      // Chromium page setup and axe's internal pages share this audit budget.
      test.setTimeout(60_000);
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

for (const invalid of [' ', '   '])
  test(`blocks committing the invalid name ${JSON.stringify(invalid)} with Enter and describes the error`, async ({
    page,
  }) => {
    await page.goto('/');
    await openView(page, 'Device Configuration');
    const original = generateDevices(1)[0]!.name;
    await page
      .getByRole('gridcell', { name: original, exact: true })
      .dblclick();
    const editor = page.getByRole('textbox', { name: 'Device name editor' });
    await editor.fill(invalid);
    await expect(editor).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await editor.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText(
      /1–80 characters/,
    );

    await page.keyboard.press('Enter');
    // The commit is blocked, not discarded: the editor stays open, focused and invalid.
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('aria-invalid', 'true');
    await expect(editor).toHaveValue(invalid);
    await expect(page.locator('.ag-aria-description-container')).toContainText(
      /Name must contain 1–80 characters/,
    );
    await expect(
      page.getByText('0 unsaved changes', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Clicking away does not commit or discard either: block mode holds the editor.
    await page
      .getByRole('gridcell', { name: generateDevices(2)[1]!.name, exact: true })
      .click();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(invalid);
    await expect(
      page.getByText('0 unsaved changes', { exact: true }),
    ).toBeVisible();

    await editor.fill('Corrected sensor');
    await expect(editor).toHaveAttribute('aria-invalid', 'false');
    await page.keyboard.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole('gridcell', { name: 'Corrected sensor', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('1 unsaved changes', { exact: true }),
    ).toBeVisible();

    // Escape still abandons an invalid draft explicitly.
    await page
      .getByRole('gridcell', { name: 'Corrected sensor', exact: true })
      .dblclick();
    await editor.fill(' ');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole('gridcell', { name: 'Corrected sensor', exact: true }),
    ).toBeVisible();
  });

test('blocks committing an empty or out-of-range sampling interval with Enter and commits a valid one', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  const cell = page.locator(
    '[row-id="device-00001"] [col-id="samplingInterval"]',
  );
  await cell.click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('spinbutton');

  await editor.fill('');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();

  await editor.fill('3601');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();

  await editor.fill('60');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
});

test('saves a selected new row into the baseline without losing other rows or drafts', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  const [first, second] = generateDevices(2);
  await renameFirstDevice(page, 'Existing draft');
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  await expect(
    page.getByText('2 unsaved changes', { exact: true }),
  ).toBeVisible();
  const added = page.getByRole('row').filter({
    has: page.getByRole('gridcell', { name: 'New sensor 101', exact: true }),
  });
  await added.getByRole('checkbox').first().check();
  await page
    .getByRole('button', { name: 'Save selected', exact: true })
    .click();
  await expect(
    page.getByText('Saved successfully', { exact: true }),
  ).toBeVisible();
  // Only the saved row left the dirty set; the unsaved rename remains.
  await expect(
    page.getByText('1 unsaved changes', { exact: true }),
  ).toBeVisible();
  const unsaved = page.getByRole('region', { name: 'Unsaved change list' });
  await expect(unsaved).toContainText('Existing draft: modified');
  await expect(unsaved).not.toContainText('New sensor 101');
  // The saved row is now baseline: editing it is a modification, not a new device.
  await page
    .getByRole('gridcell', { name: 'New sensor 101', exact: true })
    .dblclick();
  await page
    .getByRole('textbox', { name: 'Device name editor' })
    .fill('Saved then renamed');
  await page.keyboard.press('Enter');
  await expect(unsaved).toContainText('Saved then renamed: modified');
  await expect(
    page.getByText('2 unsaved changes', { exact: true }),
  ).toBeVisible();
  // Reverting everything restores the saved name and keeps every original row.
  await page.getByRole('button', { name: 'Revert all', exact: true }).click();
  await expect(
    page.getByText('0 unsaved changes', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: first!.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: second!.name, exact: true }),
  ).toBeVisible();
  // Saving a selection appends the new row to the baseline; jump the virtualised body to it.
  await page.getByRole('gridcell', { name: first!.name, exact: true }).click();
  await page.keyboard.press('Control+End');
  await expect(
    page.getByRole('gridcell', { name: 'New sensor 101', exact: true }),
  ).toBeVisible();
});

test('keeps the Columns checkboxes in step with the grid after Reset State', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Analytics');
  await visibleGrid(page);
  await page.getByText('Columns', { exact: true }).click();
  const average = page.getByLabel('Average', { exact: true });
  await average.uncheck();
  await expect(
    page.getByRole('columnheader', { name: 'Average', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset State', exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Average', exact: true }),
  ).toBeVisible();
  await expect(average).toBeChecked();
  // The first click after the reset acts on the live state: it hides the column.
  await average.click();
  await expect(average).not.toBeChecked();
  await expect(
    page.getByRole('columnheader', { name: 'Average', exact: true }),
  ).toHaveCount(0);
  // Restore view drives visibility from the grid as well.
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await average.check();
  await page.getByRole('button', { name: 'Restore view', exact: true }).click();
  await expect(page.getByText('View restored', { exact: true })).toBeVisible();
  await expect(average).not.toBeChecked();
});

test('filters historical timestamps by the displayed UTC value', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Historical Logs');
  await visibleGrid(page);
  await page.getByLabel('Network latency', { exact: true }).selectOption('0');
  const matching = page
    .getByText('Matching records', { exact: true })
    .locator('..')
    .locator('strong');
  await expect(matching).toHaveText('100,000');
  const floating = page.locator(
    '.ag-floating-filter[col-id="timestamp"] input[type="datetime-local"]',
  );
  // Record 65 is displayed as 01 Sept, 12:01:05 UTC; the picker takes that value as UTC.
  await floating.fill('2026-09-01T12:01:05');
  await expect(matching).toHaveText('1');
  await expect(page.locator('[row-index="0"] [col-id="timestamp"]')).toHaveText(
    '01 Sept, 12:01:05 UTC',
  );
  await expect(page.locator('[row-index="0"] [col-id="deviceId"]')).toHaveText(
    telemetryAt(65).deviceId,
  );
  await floating.fill('');
  await expect(matching).toHaveText('100,000');
  await expect(page.locator('[row-index="0"] [col-id="timestamp"]')).toHaveText(
    '01 Sept, 12:00:00 UTC',
  );
});

test('restores a persisted Last seen date filter on the live grid', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'iot-lab:v1:live',
      JSON.stringify({
        version: '36.1.0',
        filter: {
          filterModel: {
            lastSeen: {
              filterType: 'date',
              type: 'greaterThan',
              dateFrom: '2030-01-01 00:00:00',
            },
          },
        },
      }),
    );
  });
  await page.reload();
  await visibleGrid(page, 'Live telemetry grid');
  // Every seeded row is last seen in 2026, so a restored filter leaves no rows.
  await expect(page.getByRole('gridcell')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('iot-lab:v1:live')!).filter
            ?.filterModel?.lastSeen?.filterType,
      ),
    )
    .toBe('date');
  await page.getByRole('button', { name: 'Reset State', exact: true }).click();
  await expect(page.getByRole('gridcell').first()).toBeVisible();
});

test('restores a persisted timestamp range filter and drops filters the columns cannot hold', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'iot-lab:v1:history',
      JSON.stringify({
        version: '36.1.0',
        filter: {
          filterModel: {
            timestamp: {
              filterType: 'date',
              type: 'inRange',
              dateFrom: '2026-09-01 12:00:10',
              dateTo: '2026-09-01 12:00:19',
            },
            value: { filterType: 'text', type: 'contains', filter: '4' },
            ghost: { filterType: 'number', type: 'equals', filter: 1 },
          },
        },
      }),
    );
  });
  await openView(page, 'Historical Logs');
  await visibleGrid(page);
  const matching = page
    .getByText('Matching records', { exact: true })
    .locator('..')
    .locator('strong');
  await expect(matching).toHaveText('10');
  await expect(page.locator('[row-index="0"] [col-id="timestamp"]')).toHaveText(
    '01 Sept, 12:00:10 UTC',
  );
  await page.getByText('Request inspector', { exact: false }).click();
  const query = page.locator('pre').first();
  await expect(query).toContainText('"timestamp"');
  await expect(query).not.toContainText('"value"');
  await expect(query).not.toContainText('"ghost"');
  await page.getByRole('button', { name: 'Reset State', exact: true }).click();
  await expect(matching).toHaveText('100,000');
  await page.reload();
  await openView(page, 'Historical Logs');
  await expect(matching).toHaveText('100,000');
});

test('does not apply Ctrl+Z while a pessimistic save is pending', async ({
  page,
}) => {
  await page.goto('/');
  await openView(page, 'Device Configuration');
  await visibleGrid(page);
  await renameFirstDevice(page, 'Save remains stable');
  // A fixed epoch: `pauseAt(new Date())` after `install()` raced the two clocks
  // and failed on CI with "Cannot fast-forward to the past".
  await page.clock.install({ time: new Date('2026-09-14T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-14T12:00:01Z'));
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

test('sorts the virtual 500k dataset and records main-thread timing', async ({
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
  await startResponsivenessProbe(page);
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
  const sample = await stopResponsivenessProbe(page);
  await expect(page.locator('[row-index="0"] [col-id="value"]')).toHaveText(
    '0',
  );
  const values = await page
    .locator('[role="gridcell"][col-id="value"]')
    .allTextContents();
  expect(values.length).toBeGreaterThan(1);
  expect(values.map(Number)).toEqual(values.map(Number).sort((a, b) => a - b));
  // Recorded, not asserted: main-thread timing depends on the machine running
  // the suite. Cooperative yielding is gated by exact yield counts in
  // query.parity.test.ts ("cooperative yield points").
  test.info().annotations.push({
    type: 'main-thread sample',
    description: JSON.stringify(sample),
  });
});

test('filters the live grid to one location by search, then clears it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause stream' }).click();
  const search = page.getByLabel('Search live', { exact: true });
  const locations = page.locator('[role="gridcell"][col-id="location"]');
  await expect(locations.first()).toBeVisible();
  const distinctLocations = async () => [
    ...new Set(await locations.allTextContents()),
  ];
  // The quick filter matches each space-separated word against every visible
  // value, including computed numbers; words keep the expected set exact.
  await search.fill('Cold storage');
  await expect.poll(distinctLocations).toEqual(['Cold storage']);

  // After clearing, only the rendered rows are checked (the grid is
  // virtualised). The fleet is seeded in blocks of six devices per location
  // (North plant first, then Cold storage), so an unsorted rendered window
  // spans more than one location once the filter lifts. The search debounce
  // itself is covered in LiveTelemetry.test.tsx.
  await search.fill('');
  await expect
    .poll(async () => (await distinctLocations()).length)
    .toBeGreaterThan(1);
});
