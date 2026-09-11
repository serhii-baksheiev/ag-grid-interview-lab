const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
  hour12: false,
});
export function formatNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? '—'
    : numberFormat.format(value);
}
export function formatTimestamp(value: string | undefined): string {
  const date = value ? new Date(value) : undefined;
  return !date || !Number.isFinite(date.getTime())
    ? '—'
    : `${timeFormat.format(date)} UTC`;
}
