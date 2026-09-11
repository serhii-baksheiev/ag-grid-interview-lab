import { describe, expect, it } from 'vitest';
import type { GridState } from 'ag-grid-community';
import { deserializeState, readState, serializeState } from './storage';

describe('persisted grid state', () => {
  const state: GridState = {
    version: '35.0.0',
    columnOrder: { orderedColIds: ['name', 'value'] },
    columnVisibility: { hiddenColIds: ['id'] },
    sort: { sortModel: [{ colId: 'value', sort: 'desc' }] },
  };
  it('round trips necessary grid view state', () => {
    expect(deserializeState(serializeState(state))).toEqual(state);
  });
  it('discards malformed or unexpected stored data', () => {
    for (const input of [
      null,
      '',
      '{broken',
      'null',
      '[]',
      '42',
      '{"columnOrder":{"orderedColIds":42}}',
      '{"version":"35","sort":{"sortModel":[{"colId":"x","sort":"sideways"}]}}',
    ]) {
      expect(deserializeState(input)).toBeUndefined();
    }
  });
  it('survives corrupted localStorage and storage access errors', () => {
    localStorage.setItem('test-grid', '{broken');
    expect(readState('test-grid')).toBeUndefined();
    const unavailable = {
      getItem: () => {
        throw new Error('Storage disabled');
      },
    } as unknown as Storage;
    expect(readState('test-grid', unavailable)).toBeUndefined();
  });
});
