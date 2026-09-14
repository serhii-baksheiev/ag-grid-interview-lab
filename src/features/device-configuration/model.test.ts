import { describe, expect, it } from 'vitest';
import { generateDevices, locations } from '../../shared/data/generator';
import {
  fieldError,
  isDirty,
  parseNumber,
  revertDevices,
  validateDevice,
} from './model';

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
  it.each([
    ['minimum', 1, false],
    ['maximum', 3600, false],
    ['below minimum', 0, true],
    ['above maximum', 3601, true],
    ['fractional', 1.5, true],
  ])('treats %s sampling interval as %s', (_, samplingInterval, invalid) => {
    const errors = validateDevice({ ...device(), samplingInterval });
    expect('samplingInterval' in errors).toBe(invalid);
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

  describe('fieldError', () => {
    it('reports the domain name error for a blank name', () => {
      expect(fieldError(device(), 'name', '')).toBe(
        'Name must contain 1–80 characters.',
      );
    });
    it('reports the domain name error for an 81-character name', () => {
      expect(fieldError(device(), 'name', 'a'.repeat(81))).toBe(
        'Name must contain 1–80 characters.',
      );
    });
    it('accepts a valid name', () => {
      expect(fieldError(device(), 'name', 'Valid sensor name')).toBeUndefined();
    });
    it('accepts a name the caller already trimmed, without re-trimming itself', () => {
      // fieldError trusts its caller (NameEditor / columns.ts) to trim first;
      // it validates whatever string it is given.
      const typed = '  Reference sensor  ';
      expect(fieldError(device(), 'name', typed.trim())).toBeUndefined();
    });

    it('reports the domain location error for a blank location', () => {
      expect(fieldError(device(), 'location', '')).toBe(
        'Location is required.',
      );
    });
    it('accepts a known location', () => {
      expect(fieldError(device(), 'location', locations[0])).toBeUndefined();
    });

    it.each([
      ['below minimum', 0],
      ['above maximum', 3601],
      ['fractional', 1.5],
      ['empty/NaN', NaN],
    ])('reports the sampling interval error for %s', (_, samplingInterval) => {
      expect(fieldError(device(), 'samplingInterval', samplingInterval)).toBe(
        'Sampling interval must be a whole number from 1 to 3600 seconds.',
      );
    });
    it.each([1, 3600])(
      'accepts a sampling interval of %i',
      (samplingInterval) => {
        expect(
          fieldError(device(), 'samplingInterval', samplingInterval),
        ).toBeUndefined();
      },
    );

    it('reports the exact domain message when warning would equal or exceed critical', () => {
      const base = device();
      expect(fieldError(base, 'warningThreshold', base.criticalThreshold)).toBe(
        'Warning must be lower than critical.',
      );
    });
    it('reports the exact domain message when critical would equal or fall below warning', () => {
      const base = device();
      expect(fieldError(base, 'criticalThreshold', base.warningThreshold)).toBe(
        'Critical must be higher than warning.',
      );
    });
    it('reports non-finite thresholds', () => {
      expect(fieldError(device(), 'warningThreshold', NaN)).toBe(
        'Enter a finite warning threshold.',
      );
      expect(fieldError(device(), 'criticalThreshold', Infinity)).toBe(
        'Enter a finite critical threshold.',
      );
    });

    it('never reports an error for enabled, which has no invalid state', () => {
      expect(fieldError(device(), 'enabled', true)).toBeUndefined();
      expect(fieldError(device(), 'enabled', false)).toBeUndefined();
    });
  });
});
