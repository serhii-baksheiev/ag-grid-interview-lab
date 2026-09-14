import { describe, expect, it } from 'vitest';
import {
  deviceIdAt,
  EPOCH,
  generateDevices,
  generateLiveDevices,
  HISTORY_FLEET_SIZE,
  locationIndexAt,
  locations,
  measurementAt,
  qualityAt,
  sensorSpecs,
  sensorTypeIndexAt,
  statusFor,
  telemetryAt,
  timestampMsAt,
} from './generator';
import { sensorTypes } from '../types';

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

describe('index-native field primitives', () => {
  const spreadIndices = [
    ...Array.from({ length: 2001 }, (_, i) => i), // 0..2000
    499_999,
    123_457,
    999,
    1000,
    1001,
  ];

  it('agrees with telemetryAt on sensor type, location, device id, value, quality and timestamp for a spread of indices', () => {
    for (const index of spreadIndices) {
      const row = telemetryAt(index);
      expect(sensorTypes[sensorTypeIndexAt(index)]).toBe(row.type);
      expect(locations[locationIndexAt(index)]).toBe(row.location);
      expect(deviceIdAt(index)).toBe(row.deviceId);
      expect(measurementAt(index, row.type)).toBe(row.value);
      expect(qualityAt(index)).toBe(row.quality);
      expect(timestampMsAt(index)).toBe(Date.parse(row.timestamp));
    }
  });

  it('honors an explicit seed the same way telemetryAt does', () => {
    for (const index of [0, 17, 512, 4096]) {
      for (const seed of [42, 7, 99]) {
        const row = telemetryAt(index, seed);
        expect(measurementAt(index, row.type, seed)).toBe(row.value);
        expect(qualityAt(index, seed)).toBe(row.quality);
      }
    }
  });

  it('derives every timestamp as EPOCH + index * 1000', () => {
    for (const index of spreadIndices) {
      expect(timestampMsAt(index)).toBe(EPOCH + index * 1000);
    }
  });

  it('keeps ISO timestamp lexicographic order equal to numeric order up to 2**32 - 1, guarding the timestamp-sort fast path', () => {
    const points = [
      0,
      1,
      2,
      999,
      1000,
      1001,
      123_456,
      123_457,
      499_998,
      499_999,
      2 ** 31 - 1,
      2 ** 31,
      2 ** 32 - 1,
    ];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!,
          b = points[j]!;
        const isoA = telemetryAt(a).timestamp,
          isoB = telemetryAt(b).timestamp;
        expect(isoA < isoB).toBe(a < b);
        expect(timestampMsAt(a) < timestampMsAt(b)).toBe(a < b);
      }
    }
  });

  it('exposes the addressable fleet size backing the device id, location and type cycle', () => {
    expect(HISTORY_FLEET_SIZE).toBe(1000);
    for (const index of [0, 37, 999]) {
      expect(deviceIdAt(index)).toBe(deviceIdAt(index + HISTORY_FLEET_SIZE));
      expect(locationIndexAt(index)).toBe(
        locationIndexAt(index + HISTORY_FLEET_SIZE),
      );
      expect(sensorTypeIndexAt(index)).toBe(
        sensorTypeIndexAt(index + HISTORY_FLEET_SIZE),
      );
    }
  });

  it('shares device ids and locations with generateDevices for the first fleet page', () => {
    const devices = generateDevices(12);
    devices.forEach((device, i) => {
      expect(device.id).toBe(deviceIdAt(i));
      expect(locations[locationIndexAt(i)]).toBe(device.location);
    });
  });
});
