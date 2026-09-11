import { describe, expect, it } from 'vitest';
import {
  generateDevices,
  generateLiveDevices,
  sensorSpecs,
  statusFor,
  telemetryAt,
} from './generator';

describe('deterministic IoT data', () => {
  it('keeps every large-fleet reading within its own sensor range and thresholds', () => {
    for (const row of generateLiveDevices(10000)) {
      const spec = sensorSpecs[row.type];
      expect(row.value).toBeGreaterThanOrEqual(spec.min);
      expect(row.value).toBeLessThanOrEqual(spec.max);
      expect(row.status).toBe(
        statusFor(row.value, row.warningThreshold, row.criticalThreshold),
      );
    }
  });
  it('reproduces devices and changes measurements with the seed', () => {
    expect(generateDevices(12, 42)).toEqual(generateDevices(12, 42));
    expect(generateDevices(12, 43)).not.toEqual(generateDevices(12, 42));
  });
  it('creates unique device IDs and all six sensor types', () => {
    const rows = generateDevices(100, 42);
    expect(new Set(rows.map((row) => row.id)).size).toBe(100);
    expect(new Set(rows.map((row) => row.type)).size).toBe(6);
    expect(
      rows.every((row) => row.warningThreshold < row.criticalThreshold),
    ).toBe(true);
    expect(generateDevices(0)).toEqual([]);
  });
  it.each([
    ['below warning', 34.999, 'normal'],
    ['at warning', 35, 'warning'],
    ['above warning', 35.001, 'warning'],
    ['below critical', 41.999, 'warning'],
    ['at critical', 42, 'critical'],
    ['above critical', 42.001, 'critical'],
  ] as const)('classifies temperature %s at %s', (_, value, expected) => {
    expect(statusFor(value, 35, 42)).toBe(expected);
  });
  it('can directly address a historical row without generating its predecessors', () => {
    const row = telemetryAt(499_999, 42);
    expect(row).toEqual(telemetryAt(499_999, 42));
    expect(row.id).not.toBe(telemetryAt(499_998, 42).id);
    expect(Number.isFinite(row.value)).toBe(true);
    expect(Number.isFinite(Date.parse(row.timestamp))).toBe(true);
  });
});
