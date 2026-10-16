// Explicit commit-gated deployment test. This uses a synthetic in-memory
// clinical snapshot only: no patient reads, clinical/cache/quota writes, or
// account/session creation. Configuration reads use the existing private key.
import assert from 'node:assert/strict';
import { avalaiClient, configuredModels, HEALTH_NAVIGATOR_MODEL } from '../server/api/_lib/ai-models.js';
import { generateOverview, overviewRecord, overviewRequestEstimate } from '../server/api/_lib/health-overview.js';
import { safeErrorMetadata } from '../server/api/_lib/errors.js';
import { countPersianWords } from '../server/api/_lib/lab-report-format.js';

const expectedCommit = process.env.DRMAN_HEALTH_OVERVIEW_PROBE || '';
const enabled = /^[a-f0-9]{40}$/.test(expectedCommit) && expectedCommit === process.env.VERCEL_GIT_COMMIT_SHA;
const report = value => console.log('DRMAN_HEALTH_OVERVIEW_PROBE ' + JSON.stringify(value));

export function syntheticOverviewRecord() {
  const measuredAt = new Date().toISOString();
  return overviewRecord({ birth_date: '1990-01-01', sex: 'female', height_cm: 170 }, {
    conditions: [], allergies: [{ allergen: 'بادام زمینی', severity: 'moderate', reaction: 'کهیر' }], medications: [],
    vitals: [{ measured_at: measuredAt, weight_kg: 84, systolic: 138, diastolic: 86, heart_rate: 78, oxygen_saturation: 98 }],
    tests: [{ created_at: measuredAt, status: 'warning', structured_analysis: {
      summary: 'برگهٔ کاملاً ساختگی برای آزمون؛ چربی LDL بالاتر از محدودهٔ نوشته‌شده است.',
      items: [
        { name: 'LDL', value: '162', unit: 'mg/dL', reference_range: '<130', flag: 'high' },
        { name: 'Fasting glucose', value: '94', unit: 'mg/dL', reference_range: '70–99', flag: 'normal' },
        { name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12–16', flag: 'normal' }
      ]
    } }],
    tasks: [{ title: 'مرور نتیجهٔ چربی خون با پزشک', due_at: measuredAt, priority: 'normal' }],
    encounters: [], visit_intakes: [{ pregnancy_status: 'no', status: 'submitted', submitted_at: measuredAt, created_at: measuredAt, updated_at: measuredAt }]
  });
}

if (enabled) {
  try {
    const models = await configuredModels();
    assert.equal(models.provider, 'groq-free'); assert.equal(models.free_only, true);
    assert.equal(models.navigator, HEALTH_NAVIGATOR_MODEL);
    report({ stage: 'configuration', provider: models.provider, free_only: true, model: models.navigator });
    const client = await avalaiClient(); assert.ok(client);
    const create = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async (body, options) => {
      assert.equal(body.model, HEALTH_NAVIGATOR_MODEL);
      const result = await create(body, options);
      report({ stage: 'synthetic_response', model: result.model, finish_reason: result.choices?.[0]?.finish_reason });
      return result;
    };
    const started = Date.now(), record = syntheticOverviewRecord();
    assert.ok(overviewRequestEstimate(record) <= 7800, 'Synthetic program must fit the normal Free request allowance');
    const { overview, model } = await generateOverview(client, record, 'drman-synthetic-overview-test');
    const sectionCounts = Object.fromEntries(Object.entries(overview).map(([key, value]) => [key, Array.isArray(value) ? value.length : 1]));
    assert.ok(overview.next_steps.length >= 3);
    assert.ok(overview.nutrition.length >= 2);
    assert.ok(overview.movement.length >= 1);
    assert.match(JSON.stringify(overview), /LDL|چربی|کلسترول/iu);
    assert.match(JSON.stringify(overview), /فشار/u);
    const program = overview.lifestyle_plan;
    assert.ok(program && program.goal.length >= 15);
    assert.equal(program.first_week.length, 3);
    assert.ok(program.first_week.every(block => block.label && block.steps.length >= 2));
    for (const field of ['based_on', 'next_weeks', 'sleep_and_stress', 'tracking', 'precautions']) assert.ok(program[field].length >= 1, field);
    assert.match(program.based_on.join(' '), /LDL|چربی|کلسترول|فشار/iu);
    assert.match(program.precautions.join(' '), /بادام زمینی|حساسیت/u);
    // The fixture has peanut allergy: the proposed daily food actions should
    // not default to nuts. Allergy reminders belong in the precautions.
    assert.doesNotMatch(program.first_week.flatMap(block => block.steps).join(' '), /مصرف\s+(?:بادام|مغز|آجیل)|(?:بادام|مغزها|آجیل)\s+(?:بخور|اضافه|جایگزین)/u);
    const flattenText = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(flattenText).join(' ') : value && typeof value === 'object' ? Object.values(value).map(flattenText).join(' ') : '';
    report({ stage: 'complete', passed: true, model, elapsed_ms: Date.now() - started,
      section_count: Object.keys(overview).length, section_counts: sectionCounts,
      lifestyle: { first_week_blocks: program.first_week.length, first_week_actions: program.first_week.reduce((total, block) => total + block.steps.length, 0), follow_on_steps: program.next_weeks.length, precautions: program.precautions.length },
      words: countPersianWords(flattenText(overview)) });
  } catch (error) {
    report({ stage: 'failed', passed: false, ...safeErrorMetadata(error) });
    process.exitCode = 1;
  }
}
