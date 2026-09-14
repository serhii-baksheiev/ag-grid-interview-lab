import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasourceStatus } from './datasource';

const mocked = vi.hoisted(() => ({
  datasourceOptions: undefined as
    | {
        onStatus: (status: DatasourceStatus) => void;
      }
    | undefined,
  gridProps: undefined as
    | {
        onGridReady?: (event: unknown) => void;
        onStateUpdated?: (event: unknown) => void;
      }
    | undefined,
}));

vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: typeof mocked.gridProps) => {
    mocked.gridProps = props;
    return <div role="grid" />;
  },
}));

vi.mock('./datasource', () => ({
  createHistoryDatasource: vi.fn((options) => {
    mocked.datasourceOptions = options;
    return { getRows: vi.fn(), destroy: vi.fn() };
  }),
}));

import HistoricalLogs from './HistoricalLogs';

function renderReadyHistory() {
  const api = {
    setGridAriaProperty: vi.fn(),
    getFilterModel: vi.fn(() => ({})),
    isDestroyed: vi.fn(() => false),
    purgeInfiniteCache: vi.fn(),
    setFilterModel: vi.fn(),
    setGridOption: vi.fn(),
  };
  render(<HistoricalLogs />);
  act(() => mocked.gridProps?.onGridReady?.({ api }));
  return api;
}

beforeEach(() => {
  mocked.datasourceOptions = undefined;
  mocked.gridProps = undefined;
});

afterEach(() => vi.useRealTimers());

describe('Historical Logs screen', () => {
  it('removes the error alert after a successful retry status', () => {
    renderReadyHistory();
    act(() =>
      mocked.datasourceOptions?.onStatus({
        pending: 0,
        error: true,
        requests: [],
      }),
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() =>
      mocked.datasourceOptions?.onStatus({
        pending: 0,
        error: false,
        total: 10,
        requests: [],
      }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not replace newer device typing with a non-filter state update', async () => {
    vi.useFakeTimers();
    const api = renderReadyHistory();
    let model: Record<string, unknown> = {};
    api.getFilterModel.mockImplementation(() => model);
    api.setFilterModel.mockImplementation((next) => {
      model = next;
    });
    const input = screen.getByPlaceholderText('device-00001');
    fireEvent.change(input, { target: { value: 'device-00' } });
    await act(async () => vi.advanceTimersByTimeAsync(350));
    fireEvent.change(input, { target: { value: 'device-000' } });
    act(() => mocked.gridProps?.onStateUpdated?.({ api, sources: ['scroll'] }));

    expect(input).toHaveValue('device-000');
  });

  it('keeps the datasource instance when only network latency changes', () => {
    const api = renderReadyHistory();
    expect(api.setGridOption).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Network latency'), {
      target: { value: '750' },
    });

    expect(api.setGridOption).toHaveBeenCalledTimes(1);
  });
  it('protects pending typing from a delayed filter event', async () => {
    vi.useFakeTimers();
    const api = renderReadyHistory();
    api.getFilterModel.mockReturnValue({
      deviceId: { filterType: 'text', type: 'contains', filter: 'device-00' },
    });
    const input = screen.getByPlaceholderText('device-00001');
    fireEvent.change(input, { target: { value: 'device-0001' } });
    act(() => mocked.gridProps?.onStateUpdated?.({ api, sources: ['filter'] }));
    expect(input).toHaveValue('device-0001');
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({
      deviceId: { filterType: 'text', type: 'contains', filter: 'device-0001' },
    });
  });
});

describe('request inspector', () => {
  it('renders a half-open block range exactly once', () => {
    renderReadyHistory();
    act(() =>
      mocked.datasourceOptions?.onStatus({
        pending: 0,
        error: false,
        total: 100,
        requests: [
          {
            id: 1,
            range: '[0-200)',
            query: '[{},[]]',
            status: 'success',
            duration: 12,
          },
        ],
      }),
    );
    const entry = screen.getByText('#1 [0-200)', { exact: true });
    expect(entry).toBeInTheDocument();
    expect(entry.textContent).not.toContain('[[');
  });
});
