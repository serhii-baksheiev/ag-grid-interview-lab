import { describe, expect, it } from 'vitest';
import { generateDevices } from '../../shared/data/generator';
import { isDirty, parseNumber, revertDevices, validateDevice } from './model';

describe('device configuration rules', () => {
  it('rejects missing numeric editor values rather than interpreting them as zero', () => {
    for (const value of [null, undefined, '', '   '])
      expect(parseNumber(value)).toBeNaN();
    expect(parseNumber('0')).toBe(0);
  });
  const device = () => generateDevices(1, 42)[0]!;
  it('accepts valid generated configuration', () => {
    expect(validateDevice(device())).toEqual({});
  });
  it('rejects equal or inverted thresholds', () => {
    expect(
      Object.keys(
        validateDevice({
          ...device(),
          warningThreshold: 10,
          criticalThreshold: 10,
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(
        validateDevice({
          ...device(),
          warningThreshold: 11,
          criticalThreshold: 10,
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects a blank name, out-of-range interval and nonfinite threshold', () => {
    expect(validateDevice({ ...device(), name: ' ' })).toHaveProperty('name');
    for (const samplingInterval of [0, 3601, NaN]) {
      expect(validateDevice({ ...device(), samplingInterval })).toHaveProperty(
        'samplingInterval',
      );
    }
    expect(
      Object.keys(validateDevice({ ...device(), warningThreshold: NaN }))
        .length,
    ).toBeGreaterThan(0);
  });
  it('marks only new or changed configuration as dirty', () => {
    const saved = device();
    expect(isDirty({ ...saved }, saved)).toBe(false);
    expect(isDirty({ ...saved, name: 'Updated' }, saved)).toBe(true);
    expect(isDirty(saved, undefined)).toBe(true);
  });
  it('reverts selected rows while preserving other edits', () => {
    const saved = generateDevices(2);
    const current = saved.map((row) => ({ ...row, name: 'Changed' }));
    const reverted = revertDevices(current, saved, [saved[0]!.id]);
    expect(reverted[0]).toEqual(saved[0]);
    expect(reverted[1]!.name).toBe('Changed');
    expect(current[0]!.name).toBe('Changed');
  });
  it('reverts all edits and removes unsaved additions', () => {
    const saved = generateDevices(2);
    const current = [
      ...saved.map((row) => ({ ...row, name: 'Changed' })),
      { ...saved[0]!, id: 'new' },
    ];
    expect(revertDevices(current, saved)).toEqual(saved);
    expect(revertDevices(current, saved, ['new'])).toHaveLength(2);
  });
});
