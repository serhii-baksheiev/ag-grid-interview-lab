import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeLiveGrid, type Transaction } from '../../test/fakeLiveGrid';
import { generateLiveDevices } from '../../shared/data/generator';

const harness = vi.hoisted(() => ({
  grid: undefined as ReturnType<typeof createFakeLiveGrid> | undefined,
}));
type GridProps = Parameters<ReturnType<typeof createFakeLiveGrid>['Grid']>[0];
vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: GridProps) => harness.grid!.Grid(props),
}));

import LiveTelemetry from './LiveTelemetry';

const RESET_BATCH = 200;
// Reset and resize submit update/add/remove together; a tick submits only updates.
const isReset = (transaction: Transaction) => 'remove' in transaction;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const select = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const metric = (label: string) =>
  screen.getByText(label, { exact: true }).parentElement!;

function mount() {
  const grid = createFakeLiveGrid();
  harness.grid = grid;
  const view = render(<LiveTelemetry />);
  return { grid, ...view };
}

describe('Live Telemetry with AG Grid async transaction semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    harness.grid = undefined;
  });

  it('samples steady-state rates from a full window rather than the first partial one', async () => {
    mount();
    select('Changes / tick', '10');
    // Ticks every 250 ms; each batch is confirmed 50 ms later. Only whole windows count.
    await advance(2000);

    expect(metric('EVENTS / SECOND')).toHaveTextContent('40');
    expect(
      screen.getByLabelText('Applied row updates / second'),
    ).toHaveTextContent('40 rows/s');
    expect(screen.getByLabelText('Async batches / second')).toHaveTextContent(
      '4 batches/s',
    );
    expect(metric('TRANSACTION WINDOW')).toHaveTextContent('50 ms');
  });

  it('counts one flush as one batch even when it commits several transactions', async () => {
    const { grid } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    act(() => {
      grid.api.applyTransactionAsync({ update: [] });
      grid.api.applyTransactionAsync({ update: [] });
    });
    await advance(1000);
    expect(grid.flushes()).toBe(1);
    // The window the fake honours is the one the screen actually passes to the grid.
    expect(grid.props().asyncTransactionWaitMillis).toBe(50);
    expect(screen.getByLabelText('Async batches / second')).toHaveTextContent(
      '1 batches/s',
    );
  });

  it('flushes the pending window when pausing so no update is stranded', async () => {
    const { grid } = mount();
    select('Changes / tick', '10');
    await advance(250);
    expect(grid.pending()).toBe(1);
    const [tick] = grid.transactions;
    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    expect(grid.pending()).toBe(0);
    for (const row of tick!.update ?? [])
      expect(grid.rows.get(row.id)?.lastSeen).toBe(row.lastSeen);
    await advance(2000);
    expect(grid.transactions).toHaveLength(1);
    expect(metric('EVENTS / SECOND')).toHaveTextContent('0');
  });

  it('flushes before diffing a reset, restores only the changed rows, and does not credit the pre-reset callback', async () => {
    const { grid } = mount();
    select('Changes / tick', '10');
    const initialRows = grid.props().rowData;
    await advance(250);
    const changed = new Set(grid.transactions[0]!.update!.map((r) => r.id));
    expect(grid.pending()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));
    // The rowData array stays the same reference: reset goes through transactions.
    expect(grid.props().rowData).toBe(initialRows);
    // The queued tick was applied synchronously, so the reset saw its rows.
    const reset = grid.transactions.filter(isReset);
    expect(reset).toHaveLength(1);
    expect(new Set(reset[0]!.update!.map((r) => r.id))).toEqual(changed);
    expect(reset[0]!.add).toHaveLength(0);
    expect(reset[0]!.remove).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    await advance(1100);
    // The tick's callback ran after the counters were replaced; it must not count.
    expect(metric('APPLIED UPDATES')).toHaveTextContent('0');
    expect(
      screen.getByLabelText('Applied row updates / second'),
    ).toHaveTextContent('0 rows/s');
    for (const id of changed) expect(grid.rows.get(id)?.value).toBeDefined();
  });

  it('pauses ticks and disables controls until every bounded reset batch is confirmed', async () => {
    const { grid } = mount();
    select('Tick interval', '100');
    select('Devices', '100');
    const devices = screen.getByLabelText('Devices');
    const reset = screen.getByRole('button', { name: 'Reset data' });
    expect(devices).toBeDisabled();
    expect(reset).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Resetting fleet…');

    // 900 removals in batches of 200: five transactions, one per confirmed batch.
    await advance(200);
    expect(screen.getByRole('status')).toHaveTextContent('Resetting fleet…');
    expect(grid.transactions.filter((t) => !isReset(t))).toHaveLength(0);
    await advance(60);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(devices).toBeEnabled();
    expect(reset).toBeEnabled();
    const batches = grid.transactions.filter(isReset);
    expect(batches).toHaveLength(5);
    for (const batch of batches) {
      expect(batch.update!.length).toBeLessThanOrEqual(RESET_BATCH);
      expect(batch.add!.length).toBeLessThanOrEqual(RESET_BATCH);
      expect(batch.remove!.length).toBeLessThanOrEqual(RESET_BATCH);
    }
    expect(grid.rows.size).toBe(100);
    expect(metric('CONNECTED SENSORS')).toHaveTextContent('100');

    await advance(100);
    expect(grid.transactions.filter((t) => !isReset(t))).toHaveLength(1);
  });

  it('stops chaining reset batches once the grid is destroyed', async () => {
    const { grid, unmount } = mount();
    select('Devices', '100');
    await advance(60);
    const started = grid.transactions.filter(isReset).length;
    expect(started).toBeGreaterThan(1);
    expect(started).toBeLessThan(5);
    unmount();
    await advance(1000);
    expect(grid.destroyedCalls()).toBe(0);
    expect(grid.transactions.filter(isReset)).toHaveLength(started);
  });

  it('caps a burst at one update per stable row', async () => {
    const { grid } = mount();
    select('Devices', '100');
    await advance(300);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    grid.transactions.length = 0;
    select('Tick interval', '100');
    select('Changes / tick', '1000');
    fireEvent.click(screen.getByLabelText('Burst every 8 ticks'));
    await advance(800);
    const burst = grid.transactions.filter((t) => !isReset(t)).at(-1);
    expect(burst?.update).toHaveLength(100);
    expect(new Set(burst?.update?.map((row) => row.id)).size).toBe(100);
  });

  it('keeps stable row identity through row replacement and sorted ordering', () => {
    const { grid } = mount();
    const { rowData, getRowId } = grid.props();
    expect(rowData).toHaveLength(1000);
    const first = rowData![0]!;
    const replacement = { ...first, value: first.value + 1 };
    expect(getRowId!({ data: replacement })).toBe(first.id);
    const sorted = [...rowData!].sort((a, b) => b.name.localeCompare(a.name));
    expect(new Set(sorted.map((data) => getRowId!({ data }))).size).toBe(
      sorted.length,
    );
    expect(grid.rows.get(first.id)).toBe(first);
  });

  it('never reads row data back from the grid: ticks, a burst, a same-size reset, and a resize', async () => {
    const { grid } = mount();
    const getRowNode = vi.spyOn(grid.api, 'getRowNode');

    select('Tick interval', '100');
    select('Changes / tick', '50');
    await advance(300); // a few ordinary ticks

    select('Changes / tick', '1000');
    fireEvent.click(screen.getByLabelText('Burst every 8 ticks'));
    await advance(800); // through a burst tick

    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));
    await advance(2000); // drain the same-size reset
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    select('Devices', '100');
    await advance(2000); // drain the resize down to 100
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    expect(getRowNode).not.toHaveBeenCalled();
    expect(grid.rows.size).toBe(100);
  });

  it('ends a reset in the exact seeded state, built purely from submitted transactions', async () => {
    const { grid } = mount();
    select('Tick interval', '100');
    select('Changes / tick', '200');
    await advance(500); // several ticks with changes

    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset data' }));
    await advance(2000); // drain the reset
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const seeded = generateLiveDevices(1000);
    expect(grid.rows.size).toBe(1000);
    for (const device of seeded) {
      expect(grid.rows.get(device.id)).toEqual(device);
    }
  });
});
