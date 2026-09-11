import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveDevice } from '../../shared/types';

const mocked = vi.hoisted(() => ({
  gridProps: undefined as
    | {
        getRowId?: (params: { data: LiveDevice }) => string;
        onGridReady?: (event: unknown) => void;
        rowData?: LiveDevice[];
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
});
