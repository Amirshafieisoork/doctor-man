import test from 'node:test';
import assert from 'node:assert/strict';
import { inferPrintedRangeFlag, validateLabResult } from '../server/api/_lib/lab-validation.js';

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

test('a plain result with an unqualified printed interval gets a numeric flag including inclusive endpoints', () => {
  for (const [value, range, expected] of [
    ['69.9', '70-100', 'low'], ['70', '70-100', 'normal'], ['90', '70–100', 'normal'],
    ['100', '70—100', 'normal'], ['100.1', '70-100', 'high'], ['0.9', '0.6 - 1.1', 'normal'],
    ['-3', '-2--1', 'low'], ['-1.5', '-2 to -1', 'normal'], ['0', '-2 تا -1', 'high']
  ]) assert.equal(inferPrintedRangeFlag(value, range), expected, `${value} with ${range}`);
});

test('single-bound printed ranges distinguish strict and inclusive boundary values', () => {
  for (const [reference, below, equal, above] of [
    ['<100', 'normal', 'high', 'high'], ['<=100', 'normal', 'normal', 'high'], ['≤100', 'normal', 'normal', 'high'],
    ['>100', 'low', 'low', 'normal'], ['>=100', 'low', 'normal', 'normal'], ['≥100', 'low', 'normal', 'normal']
  ]) {
    for (const [value, expected] of [['99.9', below], ['100', equal], ['100.1', above]]) assert.equal(inferPrintedRangeFlag(value, reference), expected, `${value} with ${reference}`);
  }
});

test('numeric preparation reads Persian and Arabic digits and decimal marks without changing the supplied strings', () => {
  for (const [value, range, expected] of [
    ['۰٫۹', '۰٫۶ – ۱٫۱', 'normal'], ['١٦٢', '<١٠٠', 'high'], ['۱۴۰', '<۱۵۰', 'normal'],
    ['۱۰۰', '≤۱۰۰', 'normal'], ['١٠٠', '>١٠٠', 'low'], ['۱۳٫۵', '۱۲–۱۶', 'normal'], ['۱٬۲۳۴', '1000-1500', 'normal']
  ]) {
    const before = [value, range];
    assert.equal(inferPrintedRangeFlag(value, range), expected);
    assert.deepEqual([value, range], before);
  }
});

test('qualified, demographic, multi-range and incomplete references never guess a numeric flag', () => {
  for (const range of ['Male 14-18; Female 12-16', '14-18 (male)', '12-16; 14-18', '70-100 mg/dL',
    '<100 (adult)', 'Age 18-65: 70-100', '70-100 fasting', 'negative', '70-', '-100', '100-70', 'NaN', '', '<']) {
    assert.equal(inferPrintedRangeFlag('90', range), null, range);
  }
});

test('comparators, mixed units, scientific notation and ambiguous numeric results remain unknown', () => {
  for (const value of ['<5', '<=5', '>5', '≥5', '≤5', '5 mg/dL', '1e3', '12,3', '90 or 120', 'ناخوانا', '', '?', 'NaN', 'Infinity']) {
    for (const range of ['5-10', '<100', '≥5']) assert.equal(inferPrintedRangeFlag(value, range), null, `${value} with ${range}`);
  }
});
