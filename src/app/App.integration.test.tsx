import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { App } from './App';
import { generateDevices } from '../shared/data/generator';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('IoT console integration', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
    expect(
      screen.getByText('0 unsaved changes', { exact: true }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
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
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Historical Logs' }));
    // Wait for the actual initial block, not merely the controls rendered before gridReady.
    expect(
      await screen.findByText(generateDevices(1)[0]!.id, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByLabelText('Simulate request error', { exact: true }),
    );
    expect(
      await screen.findByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Simulate request error', { exact: true }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });
});
