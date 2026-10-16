import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayDate } from '../server/api/_lib/display-date.js';

test('public article evidence/review dates use the Persian calendar without shifting date-only values', () => {
  assert.equal(displayDate('2026-10-16'), '۱۴۰۵/۰۷/۲۴');
  assert.equal(displayDate('2025-03-20'), '۱۴۰۳/۱۲/۳۰');
  assert.equal(displayDate('2026-10-16', { timeZone: 'America/Los_Angeles' }), '۱۴۰۵/۰۷/۲۴');
  assert.equal(displayDate('2026-10-15T22:00:00Z'), '۱۴۰۵/۰۷/۲۴');
  assert.match(displayDate('2026-10-15T22:00:00Z', { time: true }), /۰۱:۳۰/);
  for (const invalid of ['', null, 'not a date', '2026-02-30']) assert.equal(displayDate(invalid), '—');
});
