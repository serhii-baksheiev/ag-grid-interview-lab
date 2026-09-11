export async function requireAbort(promise, signal) {
  try {
    await promise;
  } catch (error) {
    if (signal.aborted && error?.name === 'AbortError') return;
    throw error;
  }
  throw new Error('Expected query cancellation to reject with AbortError');
}
