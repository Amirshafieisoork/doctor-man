import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// Exercise the installed PostgREST builders, with all HTTP requests confined to
// fake fetch. Adding a .catch method to a homemade builder would hide this bug.
process.env.SUPABASE_URL = 'https://record-write-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-record-database-key';
process.env.SESSION_SECRET = 'test-only-record-session-secret-32-characters';
const { supabase } = await import('../server/api/_lib/db.js');
const { createToken } = await import('../server/api/_lib/session.js');
const { default: patients } = await import('../server/api/patients.js');
const { default: healthEntry } = await import('../server/api/health-entry.js');

const userId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const entryId = '33333333-3333-4333-8333-333333333333';
const patient = { id: patientId, owner_user_id: userId, relation: 'child', display_name: 'پرونده آزمون' };
const entry = { id: entryId, patient_id: patientId, name: 'ورودی سلامت آزمون', status: 'active' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function database(t, { auditFailure = '', owned = true, writeFailure = false } = {}) {
  const calls = [];
  const client = createClient('https://record-write-tests.invalid', 'test-only-sdk-client-key', {
    auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false },
    global: { async fetch(input, init) {
      const req = new Request(input, init), url = new URL(req.url);
      assert.equal(url.origin, 'https://record-write-tests.invalid');
      const table = url.pathname.split('/').at(-1);
      const body = ['GET', 'HEAD'].includes(req.method) || !req.body ? null : await req.json();
      calls.push({ table, method: req.method, body, query: url.searchParams });
      if (table === 'users' && req.method === 'GET') return json([{ id: userId, status: 'active', plans: { active: true, family_profile_limit: 4 } }]);
      if (table === 'audit_logs') {
        assert.equal(req.method, 'POST');
        if (auditFailure === 'transport') throw new TypeError('synthetic audit connection failure');
        if (auditFailure === 'http') return json({ code: 'TEST_AUDIT_FAILURE', message: 'synthetic audit write failure' }, 500);
        return new Response(null, { status: 201 });
      }
      if (table === 'patients' || table === 'patient_conditions') {
        if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': '*/1' } });
        if (req.method === 'GET') return json(table === 'patients' ? (owned ? [patient] : []) : [entry]);
        if (writeFailure) return json({ code: 'TEST_RECORD_FAILURE', message: 'synthetic primary write failure' }, 500);
        if (req.method === 'DELETE') return new Response(null, { status: 204 });
        const payload = Array.isArray(body) ? body[0] : body;
        return json({ ...(table === 'patients' ? patient : entry), ...payload }, req.method === 'POST' ? 201 : 200);
      }
      throw new Error(`Unexpected fake request: ${req.method} ${table}`);
    } }
  });
  const original = supabase.from;
  supabase.from = client.from.bind(client);
  t.after(() => { supabase.from = original; });
  return { calls, client };
}

function response() {
  return { statusCode: 200, sent: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.sent++; assert.equal(this.sent, 1); this.body = body; return this; },
    setHeader() {}, getHeader() {}
  };
}
function request(method, body) {
  return { method, body, headers: { cookie: 'drman_session=' + createToken({ sub: userId, role: 'user' }) } };
}
const cases = [
  { name: 'family creation', handler: patients, method: 'POST', body: { relation: 'child', display_name: 'پرونده آزمون' }, table: 'patients', action: 'patient.created', status: 201 },
  { name: 'family update', handler: patients, method: 'PATCH', body: { id: patientId, display_name: 'پرونده اصلاح‌شده' }, table: 'patients', action: 'patient.updated', status: 200 },
  { name: 'health creation', handler: healthEntry, method: 'POST', body: { type: 'condition', patient_id: patientId, name: entry.name }, table: 'patient_conditions', action: 'record.condition.created', status: 201 },
  { name: 'health update', handler: healthEntry, method: 'PATCH', body: { type: 'condition', patient_id: patientId, id: entryId, name: 'نام اصلاح‌شده' }, table: 'patient_conditions', action: 'record.condition.updated', status: 200 },
  { name: 'health deletion', handler: healthEntry, method: 'DELETE', body: { type: 'condition', patient_id: patientId, id: entryId }, table: 'patient_conditions', action: 'record.condition.deleted', status: 200 }
];

test('record regression uses the installed SDK thenable without an invented catch method', t => {
  const { client } = database(t);
  const builder = client.from('audit_logs').insert({ action: 'synthetic' });
  assert.equal(typeof builder.then, 'function');
  assert.equal(typeof builder.catch, 'undefined');
});

for (const scenario of cases) {
  for (const auditFailure of ['', 'http', 'transport']) {
    test(`${scenario.name} returns success after the saved write with ${auditFailure || 'successful'} optional audit`, async t => {
      const { calls } = database(t, { auditFailure });
      const res = response();
      await scenario.handler(request(scenario.method, scenario.body), res);
      assert.equal(res.statusCode, scenario.status);
      assert.equal(res.body.success, true);
      assert.equal(res.sent, 1);
      const writes = calls.filter(call => call.table === scenario.table && call.method === scenario.method);
      assert.equal(writes.length, 1, 'the clinical operation must not be repeated after an audit error');
      const audit = calls.find(call => call.table === 'audit_logs');
      const auditBody = Array.isArray(audit.body) ? audit.body[0] : audit.body;
      assert.equal(auditBody.actor_user_id, userId);
      assert.equal(auditBody.patient_id, patientId);
      assert.equal(auditBody.action, scenario.action);
      assert.ok(calls.indexOf(audit) > calls.indexOf(writes[0]));
      const ownership = calls.find(call => call.table === 'patients' && call.method === 'GET');
      if (scenario.method !== 'POST' || scenario.handler === healthEntry) assert.equal(ownership.query.get('owner_user_id'), 'eq.' + userId);
      if (scenario.handler === healthEntry && scenario.method !== 'POST') assert.equal(writes[0].query.get('patient_id'), 'eq.' + patientId);
      if (scenario.handler === patients && scenario.method === 'PATCH') assert.equal(writes[0].query.get('owner_user_id'), 'eq.' + userId);
    });
  }
}

for (const scenario of cases.filter(scenario => scenario.handler === healthEntry)) {
  test(`${scenario.name} rejects another account's patient before either write`, async t => {
    const { calls } = database(t, { owned: false });
    const res = response();
    await scenario.handler(request(scenario.method, scenario.body), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(calls.every(call => ['GET', 'HEAD'].includes(call.method)));
  });
}

test('a failed primary record write returns an error and never emits a success audit', async t => {
  const { calls } = database(t, { writeFailure: true });
  t.mock.method(console, 'error', () => {});
  const res = response();
  await healthEntry(request('POST', { type: 'condition', patient_id: patientId, name: entry.name }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(calls.some(call => call.table === 'audit_logs'), false);
});
