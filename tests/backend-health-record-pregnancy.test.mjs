import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createToken } from '../server/api/_lib/session.js';
import { hasPregnancyContext } from '../assets/bmi.js';

process.env.SUPABASE_URL = 'https://pregnancy-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-pregnancy-key';
process.env.SESSION_SECRET = 'test-only-pregnancy-session-secret-32-characters';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: healthRecord } = await import('../server/api/health-record.js');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), self = id(2), child = id(3), foreign = id(4);
function setup(t) {
  const rows = {
    users: [{ id: owner, status: 'active', session_version: 0 }],
    patients: [{ id: self, owner_user_id: owner, relation: 'self' }, { id: child, owner_user_id: owner, relation: 'child' }, { id: foreign, owner_user_id: id(5), relation: 'self' }],
    encounters: [{ patient_id: self, pregnancy_status: 'no', occurred_at: '2026-10-01T09:00:00Z' }],
    visit_intakes: [
      { patient_id: self, pregnancy_status: 'yes', status: 'reviewed', submitted_at: '2025-01-01T09:00:00Z', created_at: '2025-01-01T09:00:00Z', updated_at: '2026-10-15T10:00:00Z', chief_complaint: 'private old notes' },
      { patient_id: self, pregnancy_status: 'possible', status: 'submitted', submitted_at: '2026-10-14T09:00:00Z', created_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z', history_of_present_illness: 'private notes' },
      { patient_id: self, pregnancy_status: 'unknown', status: 'draft', created_at: '2026-10-15T11:00:00Z', updated_at: '2026-10-15T11:00:00Z' },
      { patient_id: child, pregnancy_status: 'no', status: 'submitted', submitted_at: '2026-10-14T09:00:00Z', created_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z' },
      { patient_id: foreign, pregnancy_status: 'yes', status: 'submitted', created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z' }
    ]
  }, calls = [];
  const client = createClient('https://pregnancy-tests.invalid', 'test-only-client-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { async fetch(input, init) {
    const req = new Request(input, init), url = new URL(req.url), table = url.pathname.split('/').at(-1);
    assert.equal(url.origin, 'https://pregnancy-tests.invalid');
    calls.push({ table, method: req.method, query: url.searchParams });
    let data = (rows[table] || []).filter(row => [...url.searchParams].every(([key, value]) => value.startsWith('eq.') ? String(row[key]) === value.slice(3) : value.startsWith('in.(') ? value.slice(4, -1).split(',').includes(String(row[key])) : true));
    if (req.method !== 'GET') data = [];
    const order = url.searchParams.get('order');
    if (order) { const [key, direction] = order.split('.'); data.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (direction === 'desc' ? -1 : 1)); }
    data = data.slice(0, Number(url.searchParams.get('limit') || data.length));
    // Model the real Data API's selected-column projection for the intake.
    if (table === 'visit_intakes') data = data.map(row => Object.fromEntries(url.searchParams.get('select').split(',').map(key => [key, row[key] ?? null])));
    return new Response(JSON.stringify(req.headers.get('accept')?.includes('vnd.pgrst.object') ? data[0] || null : data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  const from = supabase.from; supabase.from = client.from.bind(client);
  t.after(() => { supabase.from = from; });
  return { rows, calls };
}
async function run(patientId) {
  const req = { method: 'GET', query: { patient_id: patientId }, headers: { cookie: `drman_session=${createToken({ sub: owner, role: 'user', ver: 0 })}` } };
  const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; } };
  await healthRecord(req, res); return res;
}
test('the owner sees minimal recent pregnancy context, including an intake before a completed visit', async t => {
  const { calls, rows } = setup(t);
  for (let index = 0; index < 20; index++) rows.visit_intakes.push({ patient_id: self, pregnancy_status: 'unknown', status: 'draft', updated_at: '2026-10-15T12:00:00Z' });
  const res = await run(self);
  assert.equal(res.statusCode, 200); assert.equal(res.body.record.visit_intakes.length, 2);
  assert.equal(hasPregnancyContext(res.body.patient, res.body.record), true);
  const query = calls.find(call => call.table === 'visit_intakes').query;
  assert.equal(query.get('patient_id'), 'eq.' + self);
  assert.deepEqual(query.get('select').split(',').sort(), ['pregnancy_status', 'status', 'submitted_at', 'created_at', 'updated_at'].sort());
  assert.equal(query.get('limit'), '10');
  assert.equal(query.get('pregnancy_status'), 'in.(yes,possible,no,not_applicable)');
  assert.doesNotMatch(JSON.stringify(res.body.record.visit_intakes), /private|history_of_present_illness|chief_complaint|patient_id/);
});
test('family context stays separate, and a later explicit no resolves an old reviewed pregnancy', async t => {
  const { rows } = setup(t); let res = await run(child);
  assert.equal(res.statusCode, 200); assert.equal(res.body.record.visit_intakes.length, 1); assert.equal(hasPregnancyContext(res.body.patient, res.body.record), false);
  rows.visit_intakes[1].pregnancy_status = 'no'; res = await run(self);
  assert.equal(hasPregnancyContext(res.body.patient, res.body.record), false);
});
test('an unowned patient cannot trigger any pregnancy intake query', async t => {
  const { calls } = setup(t); const res = await run(foreign);
  assert.equal(res.statusCode, 404); assert.equal(calls.some(call => call.table === 'visit_intakes'), false);
});
