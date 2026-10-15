import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { automaticOverview, overviewRecord, recordFingerprint, localOverview, parseOverview, compactOverviewRecord } from '../server/api/_lib/health-overview.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const patient = { id: 'synthetic-self', birth_date: '1990-01-01', sex: 'female', height_cm: 170 };
const report = { overall: 'جمع‌بندی ساختگی برای آزمون و بررسی قدم‌های بعدی پرونده است.', next_steps: ['موارد خارج از محدوده را در مراجعه بررسی کنید.'], nutrition: ['سبزی و حبوبات را در غذای روزانه بگنجانید.'], movement: ['فعالیت سبک را در حد توان انجام دهید.'], seek_care: 'در صورت درد شدید قفسهٔ سینه یا تنگی نفس شدید با اورژانس تماس بگیرید.', questions_for_doctor: ['چه زمانی لازم است پیگیری کنم؟'], data_limits: ['این پرونده برای تشخیص کافی نیست.'] };
const completion = () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(report) } }] });
function setup(options = {}) {
  const state = { consent: true, active: true, owner: 'synthetic-owner', patient: { ...patient }, cache: null, pending: false, rpcCalls: [], providerCalls: [], clientReads: 0,
    rows: { patient_conditions: [], patient_allergies: [], patient_medications: [], patient_vitals: [{ measured_at: '2026-10-14', weight_kg: 72, systolic: 118, diastolic: 76 }], test_results: [{ created_at: '2026-10-14', status: 'warning', structured_analysis: { summary: 'خلاصهٔ آزمایش ساختگی', items: [{ name: 'LDL', value: '162', unit: 'mg/dL', reference_range: '<130', flag: 'high' }] } }], care_tasks: [], encounters: [] }, ...options };
  const database = { from(table) {
    const filters = [], query = {};
    for (const method of ['select', 'order', 'limit']) query[method] = () => query;
    query.eq = (key, value) => { filters.push([key, value]); return query; };
    const resolve = async () => {
      if (table === 'patients') return { data: filters.some(([key, value]) => key === 'owner_user_id' && value === state.owner) && filters.some(([key, value]) => key === 'id' && value === state.patient.id) ? { ...state.patient } : null };
      if (table === 'consent_records') return { data: { granted: state.consent } };
      if (table === 'patient_health_overviews') {
        const data = state.cache ? structuredClone(state.cache) : null;
        if (state.afterCacheRead) await state.afterCacheRead();
        return { data };
      }
      assert.ok(filters.some(([key, value]) => key === 'patient_id' && value === state.patient.id), table + ' must be patient scoped');
      return { data: structuredClone(state.rows[table] || []) };
    };
    query.maybeSingle = resolve; query.then = (yes, no) => resolve().then(yes, no); return query;
  }, async rpc(name, args) {
    state.rpcCalls.push({ name, args });
    if (name === 'finish_patient_health_overview' && args.p_overview && state.beforeSave) await state.beforeSave();
    if (!state.active || args.p_user_id !== state.owner || args.p_patient_id !== state.patient.id) return { data: { state: 'access_changed', saved: false } };
    if (!state.consent) return { data: { state: 'consent_not_granted', saved: false } };
    if (name === 'claim_patient_health_overview') {
      if (state.pending) return { data: { state: 'pending' } };
      if (state.claimState) return { data: { state: state.claimState } };
      state.pending = true; return { data: { state: 'claimed' } };
    }
    assert.equal(name, 'finish_patient_health_overview'); state.pending = false;
    if (!args.p_overview) return { data: { saved: false } };
    state.cache = { overview: structuredClone(args.p_overview), overview_fingerprint: args.p_fingerprint, generated_at: new Date(now).toISOString() };
    return { data: { saved: true, generated_at: state.cache.generated_at } };
  } };
  const client = { chat: { completions: { async create(body, requestOptions) {
    state.providerCalls.push({ body, requestOptions });
    return state.onProvider ? state.onProvider(body) : completion();
  } } } };
  const run = (extra = {}) => automaticOverview({ database, userId: state.owner, patientId: state.patient.id, now: () => now, verifySession: async () => state.active,
    getClient: async () => { state.clientReads++; return state.noClient ? null : client; }, ...extra });
  return { state, run };
}

test('missing AI consent produces a useful local overview without reading a key, cache, quota or provider', async () => {
  const { state, run } = setup({ consent: false }); const result = await run();
  assert.equal(result.status, 200); assert.equal(result.body.source, 'local'); assert.equal(result.body.state, 'consent_not_granted');
  assert.match(result.body.overview.next_steps.join(' '), /LDL/); assert.equal(state.clientReads, 0); assert.deepEqual(state.rpcCalls, []); assert.deepEqual(state.providerCalls, []);
});

test('a valid completed overview is cached by clinical fingerprint and reopening consumes no quota or client', async () => {
  const { state, run } = setup(); const first = await run(); const count = state.rpcCalls.length;
  assert.equal(first.body.source, 'ai'); assert.deepEqual(first.body.overview, report);
  const second = await run({ getDailyLimit: async () => { throw Error('Cached reads must not check quota'); } });
  assert.equal(second.body.source, 'cached'); assert.equal(second.body.stale, false); assert.equal(state.rpcCalls.length, count); assert.equal(state.providerCalls.length, 1); assert.equal(state.clientReads, 1);
});

test('a cached response rechecks consent after loading the stored AI result', async () => {
  const { state, run } = setup(); await run();
  state.afterCacheRead = () => { state.consent = false; };
  const result = await run();
  assert.equal(result.body.source, 'local'); assert.equal(result.body.state, 'consent_not_granted');
  assert.notEqual(result.body.overview.overall, report.overall); assert.equal(state.providerCalls.length, 1);
});

test('a changed measurement invalidates the overview and produces a new fingerprint', async () => {
  const { state, run } = setup(); await run(); const first = state.cache.overview_fingerprint;
  state.rows.patient_vitals[0].weight_kg = 73; await run();
  assert.notEqual(state.cache.overview_fingerprint, first); assert.equal(state.providerCalls.length, 2);
});

test('identity and insurance information do not enter the model input or fingerprint', async () => {
  const { state, run } = setup(); state.patient = { ...state.patient, display_name: 'نام خصوصی ساختگی', national_code: '1234567890', phone: '09123456789', insurance_policy: 'private-policy', emergency_token: 'secret-qr' };
  await run(); const input = JSON.stringify(state.providerCalls[0].body);
  for (const omitted of ['نام خصوصی ساختگی', '1234567890', '09123456789', 'private-policy', 'secret-qr', 'synthetic-self']) assert.equal(input.includes(omitted), false);
  const first = state.cache.overview_fingerprint; state.patient.display_name = 'نام تازه'; await run();
  assert.equal(state.cache.overview_fingerprint, first); assert.equal(state.providerCalls.length, 1);
});

test('foreign patient IDs never read medical rows or generate an overview', async () => {
  const { state, run } = setup(); const result = await run({ patientId: 'someone-else' });
  assert.equal(result.status, 404); assert.equal(state.providerCalls.length, 0); assert.deepEqual(state.rpcCalls, []);
});

test('concurrent tabs share one atomic claim, so only one free generation starts', async () => {
  const { state, run } = setup(); let release; const gate = new Promise(resolve => { release = resolve; });
  state.onProvider = async () => { await gate; return completion(); };
  const first = run(); while (!state.providerCalls.length) await new Promise(resolve => setImmediate(resolve));
  const second = await run(); assert.equal(second.body.state, 'pending'); assert.equal(second.body.source, 'local'); assert.equal(state.providerCalls.length, 1);
  release(); assert.equal((await first).body.source, 'ai');
});

test('revoking consent before provider processing prevents external transmission', async () => {
  const { state, run } = setup(); const result = await run({ getClient: async () => { state.consent = false; return {}; } });
  assert.equal(result.body.state, 'consent_not_granted'); assert.equal(state.providerCalls.length, 0); assert.equal(state.cache, null);
});

test('revoking consent while a request is in flight withholds the generated response and persistence', async () => {
  const { state, run } = setup(); state.onProvider = () => { state.consent = false; return completion(); };
  const result = await run(); assert.equal(result.body.source, 'local'); assert.equal(result.body.state, 'consent_not_granted'); assert.equal(state.cache, null);
  assert.equal(state.rpcCalls.some(call => call.args.p_overview), false);
});

test('revoking consent in the atomic save cannot reveal an older cached AI overview', async () => {
  const previous = { ...report, overall: 'این متن خصوصی ساختگی از جمع‌بندی قبلی نباید پس از لغو اجازه برگردد.' };
  const { state, run } = setup({ cache: { overview: previous, overview_fingerprint: 'older-fingerprint', generated_at: '2026-10-01T00:00:00Z' } });
  state.beforeSave = () => { state.consent = false; };
  const result = await run();
  assert.equal(result.status, 200); assert.equal(result.body.source, 'local'); assert.equal(result.body.state, 'consent_not_granted');
  assert.notEqual(result.body.overview.overall, previous.overall); assert.notEqual(result.body.overview.overall, report.overall);
  assert.equal(state.cache.overview_fingerprint, 'older-fingerprint'); assert.equal(state.providerCalls.length, 1);
});

test('session revocation in the atomic save withholds older cached and newly generated overviews', async () => {
  const { state, run } = setup({ cache: { overview: report, overview_fingerprint: 'older-fingerprint', generated_at: '2026-10-01T00:00:00Z' } });
  state.beforeSave = () => { state.active = false; };
  const result = await run(); assert.equal(result.status, 403); assert.equal(result.body.overview, undefined);
  assert.equal(state.cache.overview_fingerprint, 'older-fingerprint');
});

test('patient access removed during the atomic save withholds all overview content', async () => {
  const { state, run } = setup({ cache: { overview: report, overview_fingerprint: 'older-fingerprint', generated_at: '2026-10-01T00:00:00Z' } });
  state.beforeSave = () => { state.patient.id = 'different-patient'; };
  const result = await run(); assert.equal(result.status, 403); assert.equal(result.body.overview, undefined);
});

test('blocking the account during generation withholds the output and cache write', async () => {
  const { state, run } = setup(); state.onProvider = () => { state.active = false; return completion(); };
  const result = await run(); assert.equal(result.status, 403); assert.equal(state.cache, null); assert.equal(state.rpcCalls.some(call => call.args.p_overview), false);
});

test('medical data changed during processing cannot be saved under the previous fingerprint', async () => {
  const { state, run } = setup(); state.onProvider = () => { state.rows.patient_vitals[0].weight_kg = 74; return completion(); };
  const result = await run(); assert.equal(result.body.state, 'record_changed'); assert.equal(result.body.source, 'local'); assert.equal(state.cache, null);
  assert.equal(state.rpcCalls.some(call => call.args.p_overview), false);
});

test('daily limit, cooldown and unavailable key return local guidance without a provider request', async () => {
  for (const options of [{ noClient: true }, { claimState: 'daily_limit' }, { claimState: 'cooldown' }]) {
    const { state, run } = setup(options); const result = await run();
    assert.equal(result.status, 200); assert.equal(result.body.source, 'local'); assert.equal(state.providerCalls.length, 0);
  }
  const { state, run } = setup(); const result = await run({ getDailyLimit: async () => 0 });
  assert.equal(result.body.state, 'daily_limit'); assert.equal(state.clientReads, 0); assert.equal(state.rpcCalls.length, 0);
});

test('provider failures and truncated or invalid JSON preserve the record with useful local guidance', async () => {
  for (const output of [null, { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(report) } }] }, { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }]) {
    const { state, run } = setup(); state.onProvider = () => { if (!output) throw Error('synthetic unavailable'); return output; };
    const result = await run(); assert.equal(result.body.source, 'local'); assert.equal(result.body.state, 'temporarily_unavailable'); assert.equal(state.cache, null); assert.equal(state.pending, false);
  }
});

test('the single free model call is bounded and includes age and conservative activity context', async () => {
  const { state, run } = setup(); await run(); const call = state.providerCalls[0];
  assert.equal(call.body.model, 'openai/gpt-oss-120b'); assert.equal(call.requestOptions.timeout, 45000); assert.equal(call.body.max_completion_tokens, 2600);
  assert.equal(call.body.response_format.json_schema.strict, true); assert.match(call.body.messages[0].content, /زیر ۲۰/); assert.match(call.body.messages[0].content, /تغییر مقدار/);
});

test('the overview uses the latest explicit intake pregnancy response without transmitting intake notes', () => {
  const results = {
    encounters: [{ occurred_at: '2026-09-01', pregnancy_status: 'yes' }],
    visit_intakes: [{ pregnancy_status: 'no', status: 'reviewed', submitted_at: '2026-10-01', created_at: '2026-10-01', updated_at: '2026-10-15', notes: 'unrelated-private-intake-notes' }]
  };
  const record = overviewRecord(patient, results, now);
  assert.equal(record.patient.pregnancy_status, 'no'); assert.equal(JSON.stringify(record).includes('unrelated-private-intake-notes'), false);
  results.visit_intakes[0].pregnancy_status = 'possible';
  assert.equal(overviewRecord(patient, results, now).patient.pregnancy_status, 'possible');
});

test('synthetic deployment probe remains inert without its exact commit gate', () => {
  for (const flag of ['', 'not-a-commit', 'a'.repeat(40)]) {
    const result = spawnSync(process.execPath, ['scripts/health-overview-probe.mjs'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      env: { ...process.env, DRMAN_HEALTH_OVERVIEW_PROBE: flag, VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }
    });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  }
});

test('fingerprints ignore key insertion order but reflect deleted medical content', () => {
  assert.equal(recordFingerprint({ a: 1, b: { y: 2, x: 3 } }), recordFingerprint({ b: { x: 3, y: 2 }, a: 1 }));
  assert.notEqual(recordFingerprint({ labs: ['LDL'] }), recordFingerprint({ labs: [] }));
});

test('local overview never labels a blank record as healthy and highlights critical flags', () => {
  const empty = overviewRecord(patient, {}, now); assert.match(localOverview(empty).overall, /با ثبت/);
  empty.tests = [{ items: [{ name: 'ساختگی', flag: 'critical' }], abnormal_items: [] }]; assert.match(localOverview(empty).seek_care, /بحرانی/);
});

test('schema parser rejects non-Persian or missing practical sections', () => {
  for (const invalid of [{ ...report, overall: 'This is a synthetic overview only.' }, { ...report, nutrition: [] }, { ...report, next_steps: [null] }]) assert.throws(() => parseOverview({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalid) } }] }));
});

test('compact free transport preserves every selected lab value and vital measurement', () => {
  const record = overviewRecord(patient, { vitals: [{ measured_at: '2026-10-14', weight_kg: 72, systolic: 118, diastolic: 76 }], tests: [{ created_at: '2026-10-14', structured_analysis: { items: [{ name: 'LDL', value: '162', unit: 'mg/dL', reference_range: '<130', flag: 'high' }] } }] }, now);
  const packed = compactOverviewRecord(record);
  assert.deepEqual(Object.fromEntries(packed.lab_columns.map((key, index) => [key, packed.tests[0].items[0][index]])), record.tests[0].items[0]);
  for(const key of packed.vital_columns)assert.equal(packed.vitals[0][packed.vital_columns.indexOf(key)],record.vitals[0][key]);
  assert.equal(packed.tests.length, record.tests.length); assert.equal(packed.tests[0].items.length, record.tests[0].items.length);
});
