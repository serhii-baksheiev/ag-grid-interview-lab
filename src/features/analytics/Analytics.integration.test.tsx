import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../shared/grid/register';
import * as generatorModule from '../../shared/data/generator';
import Analytics from './Analytics';
import { summarizeHistory, summarizeLocations } from './model';
import { formatNumber } from '../../shared/utils/format';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Analytics renders from an index-native aggregation', () => {
  it('shows the first summary group and an accurate chart description, without materialising telemetry rows', async () => {
    // jsdom has no layout; AG Grid needs viewport dimensions to render rows.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const spy = vi.spyOn(generatorModule, 'telemetryAt');

    render(<Analytics />);

    const summaries = summarizeHistory(10000);
    const firstGroup = summaries[0]!;
    expect(
      (await screen.findAllByRole('gridcell', { name: firstGroup.location }))
        .length,
    ).toBeGreaterThan(0);

    const expectedLocations = summarizeLocations(summaries);
    const expectedDescription = expectedLocations
      .map((row) => `${row.location}: ${formatNumber(row.rate)} percent alerts`)
      .join('. ');
    expect(
      screen.getByRole('img', { name: expectedDescription }),
    ).toBeInTheDocument();

    expect(spy).not.toHaveBeenCalled();
  });
});
