import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../assets/jalali-date.js';
const { format, toGregorian, birthDate } = globalThis.DrManJalali;

test('Jalali birthday conversions match Nowruz and leap-day reference dates', () => {
  for (const [gregorian, jalali] of [
    ['1990-01-01', '1368/10/11'], ['2016-04-02', '1395/01/14'],
    ['2021-03-20', '1399/12/30'], ['2024-03-20', '1403/01/01'],
    ['2025-03-20', '1403/12/30'], ['2025-03-21', '1404/01/01'],
    ['2026-03-20', '1404/12/29'], ['2026-03-21', '1405/01/01']
  ]) { assert.equal(format(gregorian), jalali); assert.equal(toGregorian(jalali), gregorian); }
});
test('Gregorian birthdays round-trip across supported years without timezone shifts', () => {
  for (let year = 1901; year <= 2026; year++) {
    for (const suffix of ['01-01', '02-28', '03-20', '03-21', '06-30', '09-30', '12-31']) {
      const iso = year + '-' + suffix;
      assert.equal(toGregorian(format(iso)), iso);
    }
  }
});
test('Persian and Arabic numerals are accepted and invalid Jalali days rejected', () => {
  assert.equal(toGregorian(' ۱۳۹۹/۱۲/۳۰ '), '2021-03-20');
  assert.equal(toGregorian('١٣٩٥-١-١٤'), '2016-04-02');
  assert.equal(toGregorian('۱۳۹۹۱۲۳۰'), '2021-03-20');
  assert.equal(toGregorian('13950114'), '2016-04-02');
  for (const invalid of ['1400/12/30', '1404/12/30', '1405/07/31', '1405/13/01', '1405/00/01', '1405/01/00', '1990-01-01', 'دیشب']) assert.throws(() => toGregorian(invalid));
  assert.equal(format('2025-02-30'), '');
});
test('birthday validation preserves empty values and disallows future or excessive age', () => {
  const now = new Date('2026-10-15T08:00:00Z');
  assert.equal(birthDate('', now), null);
  assert.equal(birthDate('۱۳۶۸/۱۰/۱۱', now), '1990-01-01');
  assert.throws(() => birthDate('1410/01/01', now), /آینده/);
  assert.throws(() => birthDate('1279/01/01', now), /بازه/);
});
