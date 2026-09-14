import { describe, expect, it } from 'vitest';
import { createCounters, sampleDiagnostics } from './diagnostics';

describe('telemetry diagnostics', () => {
  it('starts every counter at zero', () => {
    expect(createCounters()).toEqual({
      received: 0,
      applied: 0,
      batches: 0,
      tick: 0,
    });
  });

  it('reports received, applied, and async batch rates from counter deltas', () => {
    const previous = { received: 100, applied: 80, batches: 8, tick: 10 };
    const current = { received: 130, applied: 100, batches: 12, tick: 13 };

    expect(sampleDiagnostics(current, previous, 500)).toEqual({
      received: 130,
      applied: 100,
      rate: 60,
      appliedRate: 40,
      batchRate: 8,
    });
  });

  it('reports zero rates when no elapsed time is available', () => {
    const counters = { received: 30, applied: 20, batches: 2, tick: 3 };

    expect(sampleDiagnostics(counters, createCounters(), 0)).toMatchObject({
      received: 30,
      applied: 20,
      rate: 0,
      appliedRate: 0,
      batchRate: 0,
    });
  });

  it('treats a reset counter as a new baseline instead of reporting a negative rate', () => {
    const beforeReset = { received: 100, applied: 90, batches: 9, tick: 10 };
    const afterReset = { received: 10, applied: 5, batches: 1, tick: 1 };

    expect(sampleDiagnostics(afterReset, beforeReset, 1000)).toMatchObject({
      rate: 10,
      appliedRate: 5,
      batchRate: 1,
    });
  });
});
