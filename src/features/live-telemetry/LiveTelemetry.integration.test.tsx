import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '../../shared/grid/register';
import LiveTelemetry from './LiveTelemetry';
import { generateLiveDevices } from '../../shared/data/generator';
import { formatNumber } from '../../shared/utils/format';

// jsdom has no layout; the Client-Side Row Model needs a real viewport size to
// render rows instead of just the estimated overflow.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function dataRowCount(grid: HTMLElement, headerOffset: number) {
  return Number(grid.getAttribute('aria-rowcount')) - headerOffset;
}

function valueCellText(id: string) {
  return document.querySelector(`[row-id="${id}"] [col-id="value"]`)
    ?.textContent;
}

describe('Live Telemetry against a real AG Grid instance', () => {
  it('streams into the grid and restores the exact seeded fleet after a reset', async () => {
    render(<LiveTelemetry />);
    const seeded = generateLiveDevices(1000);

    await screen.findByRole(
      'gridcell',
      { name: seeded[0]!.name },
      { timeout: 5000 },
    );

    const grid = screen.getByRole('grid', { name: 'Live telemetry grid' });
    const initialRowCount = Number(grid.getAttribute('aria-rowcount'));
    const headerOffset = initialRowCount - 1000;

    fireEvent.change(screen.getByLabelText('Tick interval'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Changes / tick'), {
      target: { value: '1000' },
    });

    await waitFor(
      () => {
        const applied = screen
          .getByText('APPLIED UPDATES', { exact: true })
          .parentElement!.querySelector('strong')!.textContent!;
        expect(Number(applied.replace(/,/g, ''))).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );

    // At least one sampled Reading has drifted from its seeded value, so the
    // post-reset check below actually proves a restore rather than a no-op.
    const driftedBeforeReset = Array.from({ length: 5 }, (_, i) => i).some(
      (i) =>
        valueCellText(`device-${String(i + 1).padStart(5, '0')}`) !==
        formatNumber(seeded[i]!.value),
    );
    expect(driftedBeforeReset).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Reset data' }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );

    for (let i = 0; i < 5; i++) {
      const id = `device-${String(i + 1).padStart(5, '0')}`;
      expect(valueCellText(id)).toBe(formatNumber(seeded[i]!.value));
    }
    expect(dataRowCount(grid, headerOffset)).toBe(1000);
  }, 10000);

  it('shrinks the grid to the requested fleet size', async () => {
    render(<LiveTelemetry />);
    const seeded = generateLiveDevices(1000);

    await screen.findByRole(
      'gridcell',
      { name: seeded[0]!.name },
      { timeout: 5000 },
    );

    const grid = screen.getByRole('grid', { name: 'Live telemetry grid' });
    const initialRowCount = Number(grid.getAttribute('aria-rowcount'));
    const headerOffset = initialRowCount - 1000;

    fireEvent.change(screen.getByLabelText('Devices'), {
      target: { value: '100' },
    });

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Reset data' }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );

    expect(dataRowCount(grid, headerOffset)).toBe(100);
  }, 10000);
});
