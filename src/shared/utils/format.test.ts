import { describe, expect, it } from 'vitest';
import { formatNumber, formatTimestamp } from './format';

describe('display formatting', () => {
  it('formats numbers with bounded precision', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57');
    expect(formatNumber(0)).toBe('0');
  });
  it('shows a placeholder for missing or nonfinite numbers', () => {
    for (const value of [undefined, NaN, Infinity])
      expect(formatNumber(value)).toBe('—');
  });
  it('handles missing and invalid timestamps without throwing', () => {
    expect(formatTimestamp(undefined)).toBe('—');
    expect(formatTimestamp('invalid')).toBe('—');
    expect(formatTimestamp('2026-01-01T12:30:00.000Z')).not.toBe('—');
  });
});
