// Human-facing Persian dates only. ISO values in APIs, exports, metadata and
// database columns deliberately retain their interoperable Gregorian contract.
export function displayDate(value, { time = false, timeZone = 'Asia/Tehran' } = {}) {
  if (!value) return '—';
  const onlyDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(onlyDate ? value + 'T00:00:00Z' : value);
  if (!Number.isFinite(date.getTime())) return '—';
  if (onlyDate && date.toISOString().slice(0, 10) !== value) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: onlyDate ? 'UTC' : timeZone
  }).format(date);
}
