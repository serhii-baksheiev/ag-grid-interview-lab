export const sensorTypes = [
  'temperature',
  'humidity',
  'pressure',
  'vibration',
  'battery',
  'air-quality',
] as const;
export type SensorType = (typeof sensorTypes)[number];
export type Status = 'normal' | 'warning' | 'critical' | 'offline';
export interface Device {
  id: string;
  name: string;
  type: SensorType;
  location: string;
  status: Status;
  enabled: boolean;
  unit: string;
  samplingInterval: number;
  warningThreshold: number;
  criticalThreshold: number;
  lastSeen: string;
}
export interface Telemetry {
  id: string;
  deviceId: string;
  timestamp: string;
  location: string;
  type: SensorType;
  value: number;
  unit: string;
  status: Status;
  quality: number;
  message?: string;
}
export interface LiveDevice extends Device {
  value: number;
  quality: number;
}
