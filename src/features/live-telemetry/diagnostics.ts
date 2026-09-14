export const ASYNC_TRANSACTION_WINDOW_MS = 50;

export function createCounters() {
  return { received: 0, applied: 0, batches: 0 };
}

export function sampleDiagnostics(
  current: ReturnType<typeof createCounters>,
  previous: ReturnType<typeof createCounters>,
  elapsedMs: number,
) {
  const rate = (value: number, before: number) =>
    elapsedMs > 0
      ? Math.round(
          ((value >= before ? value - before : value) * 1000) / elapsedMs,
        )
      : 0;
  return {
    received: current.received,
    applied: current.applied,
    rate: rate(current.received, previous.received),
    appliedRate: rate(current.applied, previous.applied),
    batchRate: rate(current.batches, previous.batches),
  };
}
