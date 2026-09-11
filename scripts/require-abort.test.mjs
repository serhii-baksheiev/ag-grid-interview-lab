import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireAbort } from './require-abort.mjs';

function abortedSignal() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe('benchmark cancellation evidence', () => {
  it('accepts AbortError only after the requested signal was aborted', async () => {
    await assert.doesNotReject(() =>
      requireAbort(
        Promise.reject(new DOMException('Cancelled', 'AbortError')),
        abortedSignal(),
      ),
    );
  });

  it('propagates an unrelated query failure instead of recording an abort', async () => {
    const failure = new Error('Query index is broken');
    await assert.rejects(
      requireAbort(Promise.reject(failure), abortedSignal()),
      (error) => error === failure,
    );
  });

  it('rejects a query that resolves without observing cancellation', async () => {
    await assert.rejects(
      requireAbort(Promise.resolve({ total: 500000 }), abortedSignal()),
    );
  });

  it('rejects a spontaneous AbortError when cancellation was never requested', async () => {
    const controller = new AbortController();
    await assert.rejects(
      requireAbort(
        Promise.reject(new DOMException('Unrelated abort', 'AbortError')),
        controller.signal,
      ),
    );
  });
});
