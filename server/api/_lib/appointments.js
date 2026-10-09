import { InputValidationError } from './validate.js';

export function canTransitionAppointment(from, to, startsAt, now = Date.now()) {
  const transitions = {
    requested: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled', 'no_show']
  };
  if (!transitions[from]?.includes(to)) return false;
  if (['completed', 'no_show'].includes(to) && new Date(startsAt).getTime() > now) return false;
  return true;
}

export function meetingUrl(value) {
  if (value == null || value === '') return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 500) throw Error();
    return url.href;
  } catch { throw new InputValidationError('لینک جلسه باید آدرس HTTPS معتبر باشد'); }
}

export function overlaps(start, end, appointment) {
  const otherStart = new Date(appointment.starts_at).getTime();
  const otherEnd = appointment.ends_at ? new Date(appointment.ends_at).getTime() : otherStart + 30 * 60000;
  return start.getTime() < otherEnd && end.getTime() > otherStart;
}
