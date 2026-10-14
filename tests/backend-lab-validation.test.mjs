import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLabResult } from '../server/api/_lib/lab-validation.js';

function result(value, range, flag = 'normal') {
  return { status: 'normal', status_reason: '', confidence: .9, read_quality: 'good', next_steps: [],
    items: [{ name: 'Synthetic test', value, reference_range: range, flag }] };
}
test('a single unqualified interval corrects a plain value and prevents a contradictory normal banner', () => {
  const out = validateLabResult(result('120', '70–100'));
  assert.equal(out.items[0].flag, 'high'); assert.equal(out.status, 'warning');
  assert.ok(out.validation_corrections.length);
});
test('comparator values remain comparisons instead of becoming an exact first number', () => {
  for (const value of ['<5', '<=5', '>5', '≥5', '5 mg/dL']) {
    const out = validateLabResult(result(value, '5-10', 'low'));
    assert.equal(out.items[0].flag, 'low'); assert.equal(out.validation_corrections, undefined);
  }
});
test('demographic, qualified and multiple reference intervals do not use the first range', () => {
  for (const range of ['Male 14-18; Female 12-16', '14-18 (male)', '12-16; 14-18', '<100', '70-100 mg/dL']) {
    const out = validateLabResult(result('13', range));
    assert.equal(out.items[0].flag, 'normal'); assert.equal(out.validation_corrections, undefined);
  }
});
test('Persian and Arabic plain numeric values and interval endpoints are compared consistently', () => {
  for (const [value, range] of [['۱۳٫۵','۱۲–۱۶'],['١٣.٥','١٢-١٦']]) {
    const out = validateLabResult(result(value, range, 'high'));
    assert.equal(out.items[0].flag, 'normal'); assert.equal(out.items[0].value, value);
  }
});
test('an explicit critical flag is preserved and never shown with a normal banner', () => {
  const out = validateLabResult(result('7.1', '3.5-5.1', 'critical'));
  assert.equal(out.items[0].flag, 'critical'); assert.equal(out.status, 'warning');
});
test('ambiguous decimal separators do not fabricate a numeric comparison', () => {
  const out = validateLabResult(result('12,3', '10-15', 'low'));
  assert.equal(out.items[0].flag, 'low'); assert.equal(out.validation_corrections, undefined);
});
