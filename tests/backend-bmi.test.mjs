import test from 'node:test';
import assert from 'node:assert/strict';
import { measurement, calculateBMI, ageInYears, bmiGuidance, hasPregnancyContext, pregnancyContext } from '../assets/bmi.js';
const now = new Date('2026-10-15T12:00:00Z');
const adult = { birthDate: '1990-10-15', heightCm: 170, now };

test('BMI uses kilograms and centimetres, accepts Persian digits, and rounds once', () => {
  assert.equal(calculateBMI(80, 180), 24.7);
  assert.equal(calculateBMI('۷۰٫۵', '۱۷۰'), 24.4);
  assert.equal(measurement('٠٫٢', .2, 500), .2);
});
test('empty, implausible and nonnumeric measurements do not produce BMI', () => {
  for (const [weight, height] of [[null, 170], ['', 170], [70, ''], [0, 170], [501, 170], [70, 0], [70, 261], [true, 170], ['70kg', 170], [70, '1.7'], [NaN, 170], [Infinity, 170]]) assert.equal(calculateBMI(weight, height), null);
});
test('age respects birthday, rejects fabricated or future dates and invalid calendar dates', () => {
  assert.equal(ageInYears('2006-10-15', now), 20);
  assert.equal(ageInYears('2006-10-16', now), 19);
  for (const value of [null, '', '2026-10-16', '2026-02-30', '1890-01-01', '1990-1-1']) assert.equal(ageInYears(value, now), null);
});
test('adult categories and reference weight use the supplied height', () => {
  assert.equal(bmiGuidance({ ...adult, weightKg: 50 }).category, 'underweight');
  assert.equal(bmiGuidance({ ...adult, weightKg: 65 }).category, 'healthy');
  assert.equal(bmiGuidance({ ...adult, weightKg: 80 }).category, 'overweight');
  const heavier = bmiGuidance({ ...adult, weightKg: 99 });
  assert.equal(heavier.category, 'obesity');
  assert.deepEqual(heavier.range, { min: 53.5, max: 72 });
  assert(heavier.advice.some(text => /پزشک/.test(text)));
});
test('adult BMI categories use the unrounded ratio on both sides of every boundary', () => {
  for (const [ratio, category] of [
    [18.49, 'underweight'], [18.5, 'healthy'], [18.51, 'healthy'],
    [24.96, 'healthy'], [25, 'overweight'], [25.01, 'overweight'],
    [29.96, 'overweight'], [30, 'obesity'], [30.01, 'obesity']
  ]) {
    const result = bmiGuidance({ ...adult, weightKg: ratio * 4, heightCm: 200 });
    assert.equal(result.category, category, 'unrounded BMI ' + ratio);
    assert.equal(result.bmi, Math.round(ratio * 10) / 10, 'rounded display contract ' + ratio);
  }
});
test('incomplete dates and children never receive adult labels, ranges or weight-loss targets', () => {
  for (const [birthDate, category] of [['', 'age-needed'], ['2025-04-01', 'infant'], ['2016-04-01', 'child'], ['2006-10-16', 'child']]) {
    const value = bmiGuidance({ weightKg: 60, heightCm: 150, birthDate, now });
    assert.equal(value.category, category); assert.equal(value.range, undefined); assert.equal(typeof value.bmi, 'number');
  }
});
test('known or possible pregnancy blocks adult weight targets and dieting advice', () => {
  for (const pregnancy of [true]) {
    const value = bmiGuidance({ ...adult, weightKg: 99, pregnancy });
    assert.equal(value.category, 'pregnancy'); assert.equal(value.range, undefined); assert(value.advice[0].includes('کاهش وزن خودسرانه نگیرید'));
  }
  assert.equal(hasPregnancyContext({ pregnancy_status: 'possible' }), true);
  assert.equal(hasPregnancyContext({}, { encounters: [{ pregnancy_status: 'yes' }] }), true);
  assert.equal(hasPregnancyContext({}, { conditions: [{ name: 'بارداری', status: 'active' }] }), true);
  assert.equal(hasPregnancyContext({}, { conditions: [{ name: 'بارداری', status: 'resolved' }] }), false);
});
test('the latest explicit clinical status resolves historical pregnancy; unanswered forms cannot clear it', () => {
  const historical = { pregnancy_status: 'yes', occurred_at: '2025-01-01T09:00:00Z' };
  const currentNo = { pregnancy_status: 'no', occurred_at: '2026-10-01T09:00:00Z' };
  const currentIntake = { pregnancy_status: 'possible', status: 'submitted', submitted_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z' };
  assert.equal(hasPregnancyContext({}, { encounters: [historical, currentNo] }), false);
  assert.equal(hasPregnancyContext({}, { encounters: [historical, currentNo], visit_intakes: [currentIntake] }), true);
  assert.equal(hasPregnancyContext({}, { encounters: [historical], visit_intakes: [{ ...currentIntake, pregnancy_status: 'no' }] }), false);
  assert.equal(hasPregnancyContext({}, { encounters: [historical], visit_intakes: [{ ...currentIntake, pregnancy_status: 'unknown' }] }), true);
  assert.equal(hasPregnancyContext({}, { encounters: [currentNo], visit_intakes: [{ ...currentIntake, pregnancy_status: 'yes', status: 'reviewed', submitted_at: '2025-01-01T09:00:00Z', updated_at: '2026-10-15T09:00:00Z' }] }), false, 'a review timestamp cannot turn an older report into a new pregnancy observation');
  assert.equal(hasPregnancyContext({}, { encounters: [currentNo, { ...currentNo, pregnancy_status: 'possible' }] }), true, 'uncertain pregnancy wins an exact timestamp tie');
  assert.equal(hasPregnancyContext({}, { encounters: [currentNo], conditions: [{ name: 'بارداری', status: 'active' }] }), true, 'an unresolved diagnosis still requires clinical review');
  assert.deepEqual(pregnancyContext({}, { visit_intakes: [currentIntake] }), { status: 'possible', detail: 'visit_intake' });
  assert.deepEqual(pregnancyContext({}, {}), { status: 'unknown', detail: 'not_recorded' });
});
test('extreme BMI prompts measurement verification rather than a numeric target', () => {
  const value = bmiGuidance({ ...adult, heightCm: 30, weightKg: 80 });
  assert.equal(value.category, 'check'); assert.equal(value.range, undefined);
});
