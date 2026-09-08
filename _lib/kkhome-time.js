// KK Home's Android app uses ZoneUtil.getZeroZoneMillis for entered local dates:
// local wall-clock fields encoded at UTC, not the actual UTC instant.
export function kkhomeLocalTimestamp(instant, timeZone = 'America/New_York') {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid KK Home access time.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) / 1000;
}
