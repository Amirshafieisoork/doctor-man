// The browser's Persian calendar is also used to validate leap days. Only the
// date shown to people changes; APIs continue receiving YYYY-MM-DD Gregorian.
(() => {
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
  });
  const dayMs = 86400000;
  const digits = value => String(value ?? '').trim()
    .replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632));
  function parts(date) {
    const values = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return [Number(values.year), Number(values.month), Number(values.day)];
  }
  function format(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
    return parts(date).map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('/');
  }
  function toGregorian(value) {
    // Numeric phone keyboards may not expose a slash key.
    const normalized = digits(value).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3');
    const match = normalized.match(/^(\d{4})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})$/);
    if (!match) throw Error('تاریخ تولد را شمسی، به شکل ۱۳۷۰/۰۱/۱۵ وارد کنید.');
    const target = match.slice(1).map(Number), [year, month, day] = target;
    if (year < 1200 || year > 1500 || month < 1 || month > 12 || day < 1 || day > 31) throw Error('تاریخ شمسی معتبر نیست.');
    // A Persian year lies within these Gregorian years. Binary search actual
    // calendar dates, so 30 Esfand is accepted only when the year is a leap year.
    const key = values => values[0] * 10000 + values[1] * 100 + values[2];
    let low = Math.floor(Date.UTC(year + 621, 0, 1) / dayMs);
    let high = Math.floor(Date.UTC(year + 622, 11, 31) / dayMs);
    while (low <= high) {
      const middle = Math.floor((low + high) / 2), date = new Date(middle * dayMs);
      const comparison = key(parts(date)) - key(target);
      if (!comparison) return date.toISOString().slice(0, 10);
      if (comparison < 0) low = middle + 1; else high = middle - 1;
    }
    throw Error('این روز در تقویم شمسی وجود ندارد؛ ماه و روز را بررسی کنید.');
  }
  function birthDate(value, now = new Date()) {
    if (!digits(value)) return null;
    const iso = toGregorian(value), date = new Date(iso + 'T00:00:00Z');
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (date > today) throw Error('تاریخ تولد نمی‌تواند در آینده باشد.');
    let age = today.getUTCFullYear() - date.getUTCFullYear();
    if (today.getUTCMonth() < date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())) age--;
    if (date.getUTCFullYear() < 1900 || age > 125) throw Error('تاریخ تولد خارج از بازه قابل قبول است.');
    return iso;
  }
  function readInput(input) {
    input.setCustomValidity('');
    try { return birthDate(input.value); }
    catch (error) { input.setCustomValidity(error.message); input.reportValidity(); return undefined; }
  }
  globalThis.DrManJalali = Object.freeze({ digits, format, toGregorian, birthDate, readInput });
})();
