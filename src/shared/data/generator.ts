import {
  sensorTypes,
  type Device,
  type Telemetry,
  type LiveDevice,
  type Status,
  type SensorType,
} from '../types';
export const DEMO_SEED = 42;
export const EPOCH = Date.UTC(2026, 8, 1, 12);
export const locations = [
  'North plant',
  'Cold storage',
  'Assembly line',
  'West warehouse',
];
export const sensorSpecs = {
  temperature: { unit: '°C', min: 16, max: 48, warning: 35, critical: 42 },
  humidity: { unit: '% RH', min: 25, max: 85, warning: 65, critical: 78 },
  pressure: { unit: 'kPa', min: 95, max: 120, warning: 110, critical: 116 },
  vibration: { unit: 'mm/s', min: 0.1, max: 12, warning: 7, critical: 10 },
  battery: { unit: '% used', min: 0, max: 100, warning: 75, critical: 90 },
  'air-quality': { unit: 'µg/m³', min: 3, max: 65, warning: 35, critical: 55 },
} as const;
// Addressable integer hash: the same index and seed always produce the same value.
export function randomAt(index: number, seed = DEMO_SEED): number {
  let x = (index + Math.imul(seed, 0x9e3779b9)) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
export function statusFor(
  value: number,
  warning: number,
  critical: number,
): Status {
  return value >= critical
    ? 'critical'
    : value >= warning
      ? 'warning'
      : 'normal';
}
export function telemetryAt(index: number, seed = DEMO_SEED): Telemetry {
  const deviceIndex = index % 1000;
  const type = sensorTypes[deviceIndex % sensorTypes.length];
  const spec = sensorSpecs[type];
  const value = measurementAt(index, type, seed);
  const status = statusFor(value, spec.warning, spec.critical);
  return {
    id: `log-${index}`,
    deviceId: `device-${String(deviceIndex + 1).padStart(5, '0')}`,
    timestamp: new Date(EPOCH + index * 1000).toISOString(),
    location: locations[Math.floor(deviceIndex / 6) % locations.length],
    type,
    value,
    unit: spec.unit,
    status,
    quality: Math.floor(90 + randomAt(index + 17, seed) * 11),
    ...(status === 'critical' ? { message: 'THRESHOLD_EXCEEDED' } : {}),
  };
}
export function generateDevices(count: number, seed = DEMO_SEED): Device[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const type = sensorTypes[i % sensorTypes.length];
    const spec = sensorSpecs[type];
    return {
      id: `device-${String(i + 1).padStart(5, '0')}`,
      name: `${type[0].toUpperCase() + type.slice(1)} ${String(i + 1).padStart(4, '0')}`,
      type,
      location: locations[Math.floor(i / 6) % locations.length],
      status: statusFor(
        measurementAt(i, type, seed),
        spec.warning,
        spec.critical,
      ),
      enabled: true,
      unit: spec.unit,
      samplingInterval: 5 + Math.floor(randomAt(i, seed) * 25),
      warningThreshold: spec.warning,
      criticalThreshold: spec.critical,
      lastSeen: new Date(EPOCH).toISOString(),
    };
  });
}
export function generateLiveDevices(
  count: number,
  seed = DEMO_SEED,
): LiveDevice[] {
  return generateDevices(count, seed).map((device, i) => ({
    ...device,
    value: measurementAt(i, device.type, seed),
    quality: Math.floor(90 + randomAt(i + 17, seed) * 11),
  }));
}
function measurementAt(index: number, type: SensorType, seed: number): number {
  const spec = sensorSpecs[type];
  return (
    Math.round(
      (spec.min + randomAt(index, seed) * (spec.max - spec.min)) * 100,
    ) / 100
  );
}
