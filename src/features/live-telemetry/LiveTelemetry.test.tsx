import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveDevice } from '../../shared/types';

const mocked = vi.hoisted(() => ({
  gridProps: undefined as
    | {
        getRowId?: (params: { data: LiveDevice }) => string;
        onGridReady?: (event: unknown) => void;
        onAsyncTransactionsFlushed?: (event: unknown) => void;
        rowData?: LiveDevice[];
        asyncTransactionWaitMillis?: number;
      }
    | undefined,
}));

vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: typeof mocked.gridProps) => {
    mocked.gridProps = props;
    return <div role="grid" aria-label="Live telemetry grid" />;
  },
}));

import LiveTelemetry from './LiveTelemetry';

describe('Live Telemetry', () => {
  beforeEach(() => {
    mocked.gridProps = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores only changed rows through async transactions when resetting the same dataset size', async () => {
    vi.useFakeTimers();
    const rows = new Map<string, LiveDevice>();
    const api = {
      applyTransactionAsync: vi.fn(
        (
          transaction: { update?: LiveDevice[] },
          callback?: (result: { update: LiveDevice[] }) => void,
        ) => {
          for (const row of transaction.update ?? []) rows.set(row.id, row);
          callback?.({ update: transaction.update ?? [] });
        },
      ),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn((id: string) => {
        const data = rows.get(id);
        return data ? { data } : undefined;
      }),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    const initialRows = mocked.gridProps?.rowData;
    expect(initialRows).toHaveLength(1000);
    for (const row of initialRows ?? []) rows.set(row.id, row);
    act(() => mocked.gridProps?.onGridReady?.({ api }));

    expect(mocked.gridProps?.getRowId?.({ data: initialRows![0]! })).toBe(
      initialRows![0]!.id,
    );

    fireEvent.change(screen.getByLabelText('Changes / tick'), {
      target: { value: '10' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(api.applyTransactionAsync).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));

    expect(api.applyTransactionAsync).toHaveBeenCalledTimes(2);
    expect(api.applyTransactionAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringMatching(/^device-/) }),
        ]),
      }),
      expect.any(Function),
    );
    expect(mocked.gridProps?.rowData).toBe(initialRows);
    expect(screen.getByText('APPLIED UPDATES').parentElement).toHaveTextContent(
      '0',
    );
  });

  it('keeps incoming and applied work separate until a deferred transaction callback completes', async () => {
    vi.useFakeTimers();
    const transactions: Array<{
      update?: LiveDevice[];
      callback?: (result: { update: LiveDevice[] }) => void;
    }> = [];
    const api = {
      applyTransactionAsync: vi.fn(
        (
          transaction: { update?: LiveDevice[] },
          callback?: (result: { update: LiveDevice[] }) => void,
        ) => transactions.push({ update: transaction.update, callback }),
      ),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn((id: string) => ({
        data: mocked.gridProps?.rowData?.find((row) => row.id === id),
      })),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    act(() => mocked.gridProps?.onGridReady?.({ api }));
    fireEvent.change(screen.getByLabelText('Changes / tick'), {
      target: { value: '10' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText('EVENTS / SECOND').parentElement).toHaveTextContent(
      '30',
    );
    expect(
      screen.getByLabelText('Applied row updates / second'),
    ).toHaveTextContent('0 rows/s');

    act(() =>
      transactions[0]?.callback?.({ update: transactions[0]?.update ?? [] }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(
      screen.getByLabelText('Applied row updates / second'),
    ).toHaveTextContent('10 rows/s');
  });

  it('counts one async flush event as one batch even when it reports multiple transactions', async () => {
    vi.useFakeTimers();
    const api = {
      applyTransactionAsync: vi.fn(),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    act(() => mocked.gridProps?.onGridReady?.({ api }));
    expect(mocked.gridProps?.asyncTransactionWaitMillis).toBe(50);

    act(() => {
      mocked.gridProps?.onAsyncTransactionsFlushed?.({
        results: [{}, {}, {}],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByLabelText('Async batches / second')).toHaveTextContent(
      '1 batches/s',
    );
    expect(
      screen.getByText('TRANSACTION WINDOW').parentElement,
    ).toHaveTextContent('50 ms');
  });

  it('does not let a pre-reset transaction callback credit the reset counters', async () => {
    vi.useFakeTimers();
    let callback: ((result: { update: LiveDevice[] }) => void) | undefined;
    const rows = new Map<string, LiveDevice>();
    const api = {
      applyTransactionAsync: vi.fn(
        (
          transaction: { update?: LiveDevice[] },
          next?: (result: { update: LiveDevice[] }) => void,
        ) => {
          for (const row of transaction.update ?? []) rows.set(row.id, row);
          callback ??= next;
        },
      ),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn((id: string) => {
        const data = rows.get(id);
        return data ? { data } : undefined;
      }),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    for (const row of mocked.gridProps?.rowData ?? []) rows.set(row.id, row);
    act(() => mocked.gridProps?.onGridReady?.({ api }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));
    act(() => callback?.({ update: Array.from(rows.values()).slice(0, 100) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(
      screen.getByLabelText('Applied row updates / second'),
    ).toHaveTextContent('0 rows/s');
  });

  it('caps a burst at one update per stable row', async () => {
    vi.useFakeTimers();
    const rows = new Map<string, LiveDevice>();
    const telemetryUpdates: LiveDevice[][] = [];
    const api = {
      applyTransactionAsync: vi.fn(
        (
          transaction: {
            update?: LiveDevice[];
            add?: LiveDevice[];
            remove?: LiveDevice[];
          },
          callback?: (result: { update: LiveDevice[] }) => void,
        ) => {
          for (const row of transaction.remove ?? []) rows.delete(row.id);
          for (const row of transaction.add ?? []) rows.set(row.id, row);
          for (const row of transaction.update ?? []) rows.set(row.id, row);
          if (transaction.update?.length)
            telemetryUpdates.push(transaction.update);
          callback?.({ update: transaction.update ?? [] });
        },
      ),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn((id: string) => {
        const data = rows.get(id);
        return data ? { data } : undefined;
      }),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    for (const row of mocked.gridProps?.rowData ?? []) rows.set(row.id, row);
    act(() => mocked.gridProps?.onGridReady?.({ api }));
    fireEvent.change(screen.getByLabelText('Devices'), {
      target: { value: '100' },
    });
    telemetryUpdates.length = 0;
    fireEvent.change(screen.getByLabelText('Tick interval'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('Changes / tick'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByLabelText('Burst every 8 ticks'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const burst = telemetryUpdates.at(-1);
    expect(burst).toHaveLength(100);
    expect(new Set(burst?.map((row) => row.id)).size).toBe(100);
  });

  it('preserves stable row identity through row replacement and sorted ordering, then flushes when pausing', () => {
    const api = {
      applyTransactionAsync: vi.fn(),
      flushAsyncTransactions: vi.fn(),
      setGridAriaProperty: vi.fn(),
      getColumn: vi.fn(() => ({ isVisible: () => true })),
      getColumns: vi.fn(() => []),
      getRowNode: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setColumnsVisible: vi.fn(),
    };

    render(<LiveTelemetry />);
    const firstRow = mocked.gridProps?.rowData?.[0];
    const replacement = { ...firstRow!, value: firstRow!.value + 1 };
    const sortedRows = [...(mocked.gridProps?.rowData ?? [])].sort((a, b) =>
      b.name.localeCompare(a.name),
    );
    act(() => mocked.gridProps?.onGridReady?.({ api }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));

    expect(mocked.gridProps?.getRowId?.({ data: replacement })).toBe(
      firstRow?.id,
    );
    expect(
      new Set(
        sortedRows.map((row) => mocked.gridProps?.getRowId?.({ data: row })),
      ).size,
    ).toBe(sortedRows.length);
    expect(api.flushAsyncTransactions).toHaveBeenCalledTimes(1);
  });
});
