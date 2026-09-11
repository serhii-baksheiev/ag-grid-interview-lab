import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('resets only the failed screen saved view and leaves sibling navigation available', () => {
    let shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('iot-lab:v1:history', 'malformed state');
    localStorage.setItem('iot-lab:v1:live', 'live view state');

    function HistoryView() {
      if (shouldThrow) throw new Error('Malformed history state');
      return <h1>Historical Logs ready</h1>;
    }
    function ScreenHarness() {
      const [showLive, setShowLive] = useState(false);
      return (
        <>
          <ErrorBoundary storageKey="iot-lab:v1:history">
            <HistoryView />
          </ErrorBoundary>
          <button onClick={() => setShowLive(true)}>Live Telemetry</button>
          {showLive && <p role="status">Live Telemetry ready</p>}
        </>
      );
    }

    render(<ScreenHarness />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This view could not be displayed.',
    );
    expect(
      screen.getByRole('button', { name: 'Live Telemetry' }),
    ).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved view' }));

    expect(localStorage.getItem('iot-lab:v1:history')).toBeNull();
    expect(localStorage.getItem('iot-lab:v1:live')).toBe('live view state');
    expect(
      screen.getByRole('heading', { name: 'Historical Logs ready' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Live Telemetry' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Live Telemetry ready',
    );
  });
});
