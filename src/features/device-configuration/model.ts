import { sensorTypes, type Device } from '../../shared/types';
export function validateDevice(device: Device): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!device.name.trim() || device.name.length > 80)
    errors.name = 'Name must contain 1–80 characters.';
  if (!device.location.trim()) errors.location = 'Location is required.';
  if (!sensorTypes.includes(device.type))
    errors.type = 'Select a known sensor type.';
  if (
    !Number.isInteger(device.samplingInterval) ||
    device.samplingInterval < 1 ||
    device.samplingInterval > 3600
  )
    errors.samplingInterval =
      'Sampling interval must be a whole number from 1 to 3600 seconds.';
  if (!Number.isFinite(device.warningThreshold))
    errors.warningThreshold = 'Enter a finite warning threshold.';
  if (!Number.isFinite(device.criticalThreshold))
    errors.criticalThreshold = 'Enter a finite critical threshold.';
  if (device.warningThreshold >= device.criticalThreshold) {
    errors.warningThreshold = 'Warning must be lower than critical.';
    errors.criticalThreshold = 'Critical must be higher than warning.';
  }
  return errors;
}
export function isDirty(current: Device, saved: Device | undefined): boolean {
  return (
    !saved ||
    (Object.keys(current) as (keyof Device)[]).some(
      (key) => current[key] !== saved[key],
    )
  );
}
export function revertDevices(
  current: Device[],
  saved: Device[],
  ids?: string[],
): Device[] {
  if (!ids) return saved.map((row) => ({ ...row }));
  const selected = new Set(ids);
  const baseline = new Map(saved.map((row) => [row.id, row]));
  const restored = current.flatMap((row) =>
    !selected.has(row.id)
      ? [{ ...row }]
      : baseline.has(row.id)
        ? [{ ...baseline.get(row.id)! }]
        : [],
  );
  const present = new Set(restored.map((row) => row.id));
  return [
    ...restored,
    ...saved
      .filter((row) => selected.has(row.id) && !present.has(row.id))
      .map((row) => ({ ...row })),
  ];
}
export function parseNumber(value: unknown): number {
  return value == null || (typeof value === 'string' && value.trim() === '')
    ? NaN
    : Number(value);
}
