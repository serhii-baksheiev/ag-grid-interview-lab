import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median } from './median.mjs';

test('returns the middle sample of an odd count', () => {
  assert.equal(median([5, 1, 3]), 3);
});

test('averages the two middle samples of an even count', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('leaves the samples it is given in their original order', () => {
  const samples = [3, 1, 2];
  median(samples);
  assert.deepEqual(samples, [3, 1, 2]);
});

test('returns null when there are no samples', () => {
  assert.equal(median([]), null);
});
