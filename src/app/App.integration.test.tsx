import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { App } from './App';
import { generateDevices } from '../shared/data/generator';
import { formatNumber } from '../shared/utils/format';
import '../shared/grid/register';
import HistoricalLogs from '../features/historical-logs/HistoricalLogs';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('IoT console integration', () => {
  it('presents a neutral IoT Lab identity and exactly four product scenarios', () => {
    render(<App />);

    expect(screen.getByText('AG Grid IoT Lab', { exact: true })).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Main navigation' }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Live Telemetry',
      'Historical Logs',
      'Device Configuration',
      'Analytics',
    ]);
  });

  it('provides initial live data and allows the stream to stop', async () => {
    render(<App />);
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(
      await screen.findByRole('gridcell', {
        name: generateDevices(1)[0]!.name,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause stream' }));
    expect(
      screen.getByRole('button', { name: 'Start stream' }),
    ).toBeInTheDocument();
  });

  it('marks an added configuration dirty and clears dirty state after save', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }));
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving changes…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully');
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });

  it('keeps a configuration draft while navigating away and back', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }));
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Live Telemetry' }));
    expect(
      await screen.findByRole('heading', { name: 'Live Telemetry' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    expect(
      await screen.findByRole('gridcell', { name: 'New sensor 101' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });

  it('keeps unsaved configuration after a failed save', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }));
    fireEvent.click(
      screen.getByLabelText('Simulate save error', { exact: true }),
    );
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving changes…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revert all' }));
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });

  it('surfaces a historical request error and offers a successful retry', async () => {
    // jsdom has no layout; Infinite Row Model needs viewport dimensions to request rows.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    render(<HistoricalLogs />);
    // Wait for the actual initial block, not merely the controls rendered before gridReady.
    expect(
      await screen.findByText(generateDevices(1)[0]!.id, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByLabelText('Simulate request error', { exact: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Simulate request error', { exact: true }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText(generateDevices(1)[0]!.id)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('invalid name commits', () => {
  it('keeps the name editor open with an accessible error instead of discarding the edit', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    const cell = await screen.findByRole('gridcell', {
      name: generateDevices(1)[0]!.name,
    });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    const editor = await screen.findByRole('textbox', {
      name: 'Device name editor',
    });
    fireEvent.change(editor, { target: { value: '   ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(screen.getByRole('textbox', { name: 'Device name editor' })).toBe(
      editor,
    );
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor).toHaveAccessibleDescription(/1–80 characters/);
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: 'Corrected name' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(
      await screen.findByRole('gridcell', { name: 'Corrected name' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Device name editor' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });
});

// AG Grid number inputs track typing through `input` events, as a browser sends them.
describe('invalid threshold and sampling commits', () => {
  it('keeps the warning threshold editor open with an accessible error instead of discarding the edit', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    const original = generateDevices(1)[0]!;
    await screen.findByRole('gridcell', { name: original.name });
    const cell = document.querySelector(
      '[row-id="device-00001"] [col-id="warningThreshold"]',
    );
    expect(cell).toBeTruthy();
    fireEvent.click(cell!);
    fireEvent.keyDown(cell!, { key: 'Enter' });
    const editor = await screen.findByRole('spinbutton');

    fireEvent.input(editor, {
      target: { value: String(original.criticalThreshold + 1) },
    });
    fireEvent.keyDown(editor, { key: 'Enter' });

    expect(screen.getByRole('spinbutton')).toBe(editor);
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.input(editor, {
      target: { value: String(original.criticalThreshold - 1) },
    });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });

  it('keeps the sampling interval editor open for empty or out-of-range input and commits a valid value', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    await screen.findByRole('gridcell', { name: generateDevices(1)[0]!.name });
    const cell = document.querySelector(
      '[row-id="device-00001"] [col-id="samplingInterval"]',
    );
    expect(cell).toBeTruthy();
    fireEvent.click(cell!);
    fireEvent.keyDown(cell!, { key: 'Enter' });
    const editor = await screen.findByRole('spinbutton');

    fireEvent.input(editor, { target: { value: '' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByRole('spinbutton')).toBe(editor);
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();

    fireEvent.input(editor, { target: { value: '0' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByRole('spinbutton')).toBe(editor);
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();

    fireEvent.input(editor, { target: { value: '30' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(
      screen.getByText('1 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
  });

  // Native Undo cannot reach an invalid (warning, critical) pair here: AG
  // Grid's UndoRedoService only records a cellValueChange from the
  // `cellValueChanged` event, which the grid fires solely after a valueSetter
  // commit succeeds (ag-grid-community 36.1.0's ValueService#setValue:
  // `if (!valueSetterChanged) return false;` guards the call to
  // `finishValueChange`, which is what dispatches the event) — so every
  // change on the undo stack is one this app already validated as a full,
  // valid (warning, critical) pair. And any new edit clears the redo branch
  // (UndoRedoService#pushActionsToUndoStack calls `this.redoStack.clear()`),
  // so redo can't replay a captured value against a diverged current value
  // either. By induction over that single linear, always-valid history,
  // Ctrl+Z/Ctrl+Y can only ever step between pairs that were already valid —
  // never invert the order.
  //
  // The nearest UI-reachable write that truly bypasses the cell editor (and
  // therefore its own getValidationErrors/block-mode check) is the Delete
  // key: on a focused, non-editing, editable cell with no active range
  // selection, `onBackspaceOrDeleteKeyDown` calls
  // `rowNode.setDataValue(column, deleteValue, "cellClear")` directly — no
  // editor renders, so this still has to go through the same `valueSetter`
  // fallback the ticket keeps for exactly this kind of write. For a numeric
  // column with `valueParser: (params) => parseNumber(params.newValue)`,
  // `ValueService#getDeleteValue` parses `""` through that same parser, so
  // the delete value is always `NaN` — an invalid, non-finite threshold.
  it('rejects a Delete-key clear that would leave the warning threshold non-finite, through the valueSetter fallback', async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Device Configuration' }),
    );
    const original = generateDevices(1)[0]!;
    await screen.findByRole('gridcell', { name: original.name });
    const cell = document.querySelector(
      '[row-id="device-00001"] [col-id="warningThreshold"]',
    );
    expect(cell).toBeTruthy();
    fireEvent.click(cell!);
    fireEvent.keyDown(cell!, { key: 'Delete' });

    expect(screen.getByRole('alert')).toHaveTextContent('Edit rejected');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a finite warning threshold.',
    );
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
    ).toBeInTheDocument();
    expect(cell).toHaveTextContent(formatNumber(original.warningThreshold));
  });
});
