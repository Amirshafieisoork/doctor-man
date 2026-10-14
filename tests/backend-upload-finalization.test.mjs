import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import OpenAI from 'openai';
import { createToken } from '../server/api/_lib/session.js';
import { syntheticLabSections } from './fixtures/nine-section-report.mjs';

// Synthetic account state and provider/storage stubs keep these races local.
process.env.SUPABASE_URL = 'https://finalization-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-database-key';
process.env.SESSION_SECRET = 'test-only-session-secret-32-characters';
process.env.FREE_AI_API_KEY = 'test-only-model-key';
process.env.FREE_AI_ACCOUNT_CONFIRMED='true';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: analyze } = await import('../server/api/analyze-secure.js');
const { default: documents } = await import('../server/api/documents.js');
const { default: carePlan } = await import('../server/api/care-plan.js');
const { default: support } = await import('../server/api/support-chat.js');
const userId = '11111111-1111-4111-8111-111111111111';
const reservationId = '22222222-2222-4222-8222-222222222222';
const patientId = 'patient';
const operation = (ops, name) => ops.find(([op]) => op === name);
const labResult = {
  status: 'normal', status_reason: 'در محدوده مرجع', confidence: .9,
  read_quality: 'good', summary: 'نتیجه خوانا است', full_text: 'نتیجه آموزشی آزمایش',
  items: [{ name: 'Glucose', value: '90', unit: 'mg/dL', reference_range: '70-100', flag: 'normal', explanation: 'در محدوده مرجع' }],
  abnormal_items: [], next_steps: [], when_to_seek_care: 'در صورت علائم با پزشک مشورت کنید'
};
const generatedPlan = { summary: 'برنامه مراقبت آموزشی', follow_up: [], education_topics: [] };
function interpreterLabReport(rows) {
  const value = { ...labResult, items: rows.map((row, index) => ({ row_id: index + 1, flag: row.f, explanation: 'در محدوده مرجع' })), sections: syntheticLabSections() };
  delete value.full_text;
  delete value.abnormal_items;
  return value;
}

function response() {
  return { statusCode: 200, headers: {}, sent: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.sent++; assert.equal(this.sent, 1, 'only one response may be sent'); this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; }
  };
}
function request(body = {}) {
  return { method: 'POST', body, headers: { cookie: `drman_session=${createToken({ sub: userId, role: 'user' })}` } };
}
function multipart(kind = 'document', fileCount = 1) {
  const boundary = 'finalization-test-boundary', chunks = [];
  const fields = { patient_id: patientId, ...(kind === 'lab' ? { ai_consent: 'true' } : {}) };
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (let i = 0; i < fileCount; i++) {
    const mime = kind === 'lab' ? 'image/png' : 'application/pdf';
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file-${i}.${kind === 'lab' ? 'png' : 'pdf'}"\r\nContent-Type: ${mime}\r\n\r\n`));
    chunks.push(kind === 'lab' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from('%PDF-1.7\n'));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const req = Readable.from([Buffer.concat(chunks)]);
  Object.assign(req, request());
  req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
  return req;
}
function pause() {
  let entered, resume;
  const started = new Promise(resolve => { entered = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  return { started, resume, async wait() { entered(); await released; } };
}
function services(t, { onAI, onUpload, onSign, onQuery, removalError, removalThrows = false } = {}) {
  const saved = { from: supabase.from, storage: supabase.storage.from, rpc: supabase.rpc, create: OpenAI.Chat.Completions.prototype.create };
  t.after(() => { supabase.from = saved.from; supabase.storage.from = saved.storage; supabase.rpc = saved.rpc; OpenAI.Chat.Completions.prototype.create = saved.create; });
  const state = { status: 'active', userExists: true, verificationError: false, supportTicket: null, supportMessages: [], labRows: [] };
  const calls = [], uploads = [], removals = [], rpcCalls = [];
  supabase.from = table => {
    const operations = [], query = {};
    for (const name of ['select', 'eq', 'gte', 'in', 'order', 'limit', 'insert', 'update', 'delete', 'upsert']) {
      query[name] = (...args) => { operations.push([name, ...args]); return query; };
    }
    const finish = async () => {
      calls.push({ table, operations });
      const override = await onQuery?.(table, operations, state);
      if (override !== undefined) return override;
      if (table === 'users') return state.verificationError ? { error: { code: 'ACCOUNT_CHECK_FAILURE' } }
        : { data: state.userExists ? { id: userId, status: state.status, plans: { active: true, name: 'آزمایشی', test_limit: 4, navigator_daily_limit: 3, support_daily_limit: 10 } } : null };
      if (table === 'patients') return { data: { id: patientId, display_name: 'پرونده آزمایشی', sex: 'female' } };
      if (table === 'consent_records' && operation(operations, 'select')) return { data: { granted: true } };
      if (table === 'support_tickets') return { data: state.supportTicket };
      if (table === 'support_ticket_messages') return { data: state.supportMessages.slice().reverse() };
      if (table === 'app_settings') return operations.some(([name,field,value])=>name==='eq'&&field==='key'&&value==='private_ai')?{data:null}:{ data: { value: { support_chat: true } } };
      if (operation(operations, 'insert')) return { data: { id: 'saved-record', ...operation(operations, 'insert')[1] } };
      return { data: [], count: 0 };
    };
    query.single = finish; query.maybeSingle = finish;
    query.then = (fulfilled, rejected) => finish().then(fulfilled, rejected);
    query.catch = rejected => finish().catch(rejected);
    return query;
  };
  supabase.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'create_support_ticket') {
      state.supportTicket = { id: '66666666-6666-4666-8666-666666666666', user_id: userId, title: args.p_title, category: args.p_category, status: 'waiting_admin', ai_enabled: true, tags: [] };
      state.supportMessages.push({ sender_type: 'user', content: args.p_content });
      return { data: state.supportTicket };
    }
    if (name === 'reserve_support_ai_reply') return { data: { reserved: true, reservation_id: reservationId, remaining_today: 9 } };
    if (name === 'append_support_ticket_message') {
      if (state.status !== 'active') return { data: { saved: false } };
      state.supportMessages.push({ sender_type: args.p_sender_type, content: args.p_content });
      return { data: { saved: true } };
    }
    if (name === 'release_support_ai_reservation') return { data: null };
    assert.equal(name, 'reserve_lab_analysis_quota');
    return { data: { allowed: true, reservation_id: reservationId, remaining: 3,
      expires_at: new Date(Date.now() + 900000).toISOString(), reserved_at: new Date().toISOString() } };
  };
  supabase.storage.from = bucket => ({
    async upload(path, bytes, options) {
      uploads.push({ bucket, path, bytes, options });
      const result = await onUpload?.(uploads.length, state);
      return result || { data: { path } };
    },
    async remove(paths) {
      removals.push({ bucket, paths });
      if (removalThrows) throw new Error('cleanup provider error with private details');
      return removalError ? { error: removalError } : { data: paths };
    },
    async createSignedUrl(path) {
      await onSign?.(state);
      return { data: { signedUrl: `https://finalization-tests.invalid/${path}` } };
    }
  });
  OpenAI.Chat.Completions.prototype.create = async function(payload) {
    await onAI?.(state);
    const schema = payload.response_format?.json_schema?.name;
    if (schema === 'drman_lab_read') {
      const ids = payload.response_format.json_schema.schema.properties.pages.items.properties.p.enum;
      const row = { n: 'Glucose', v: '90', u: 'mg/dL', r: '70-100', f: 'normal' };
      state.labRows.push(...ids.map(() => ({ ...row })));
      return { model: 'qwen/qwen3.8-27b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pages: ids.map(p => ({ p, read_quality: 'good', rows: [{ ...row }] })) }) } }] };
    }
    return { model: 'test-model', choices: [{ message: { content: schema === 'drman_lab_analysis'
      ? JSON.stringify(interpreterLabReport(state.labRows)) : schema === 'drman_personal_care_plan' ? JSON.stringify(generatedPlan) : 'پاسخ آموزشی پشتیبانی' } }] };
  };
  return { state, calls, uploads, removals, rpcCalls };
}
function writes(calls, table) {
  return calls.filter(call => call.table === table && ['insert', 'update', 'upsert'].some(name => operation(call.operations, name)));
}
function releasedReservation(calls) {
  const releases = calls.filter(call => call.table === 'ai_analysis_reservations' && operation(call.operations, 'delete'));
  assert.equal(releases.length, 1);
  assert.ok(releases[0].operations.some(([op, key, value]) => op === 'eq' && key === 'user_id' && value === userId));
  assert.ok(releases[0].operations.some(([op, key, value]) => op === 'eq' && key === 'id' && value === reservationId));
}
function denied(res, status = 403) {
  assert.equal(res.statusCode, status); assert.equal(res.body.success, false); assert.equal(res.sent, 1);
  assert.equal(res.body.analysis, undefined); assert.equal(res.body.answer, undefined);
}

test('account suspension during lab AI prevents uploads and late result writes while releasing quota', async t => {
  const gate = pause(), s = services(t, { onAI: () => gate.wait() }), res = response();
  const running = analyze(multipart('lab'), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(s.uploads.length, 0);
  for (const table of ['test_results', 'lab_biomarkers', 'audit_logs']) assert.equal(writes(s.calls, table).length, 0);
  releasedReservation(s.calls);
});

test('lab suspension during first storage upload cleans its object and skips remaining pages', async t => {
  const gate = pause(), s = services(t, { onUpload: () => gate.wait() }), res = response();
  const running = analyze(multipart('lab', 2), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(s.uploads.length, 1);
  assert.deepEqual(s.removals, [{ bucket: 'lab-images', paths: [s.uploads[0].path] }]);
  assert.equal(writes(s.calls, 'test_results').length, 0); releasedReservation(s.calls);
});

test('failed account revalidation after lab upload fails closed, removes the object and releases quota', async t => {
  const s = services(t, { onUpload: (_n, state) => { state.verificationError = true; } }), res = response();
  await analyze(multipart('lab'), res);
  denied(res, 503); assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]);
  assert.equal(writes(s.calls, 'test_results').length, 0); releasedReservation(s.calls);
});

test('partial lab upload failure cleans only successful objects and always releases quota', async t => {
  const s = services(t, { onUpload: n => n === 2 ? { error: new Error('upload failed') } : undefined }), res = response();
  await analyze(multipart('lab', 2), res);
  denied(res, 503); assert.equal(res.body.code, 'ANALYSIS_SAVE_FAILED');
  assert.deepEqual(s.removals, [{ bucket: 'lab-images', paths: [s.uploads[0].path] }]);
  assert.equal(writes(s.calls, 'test_results').length, 0); releasedReservation(s.calls);
});

for (const removalThrows of [false, true]) {
  test(`lab persistence throw releases quota when storage cleanup ${removalThrows ? 'throws' : 'returns an error'}`, async t => {
    const s = services(t, { removalThrows, removalError: { code: 'STORAGE_ERROR' },
      onQuery: table => { if (table === 'test_results') throw new Error('private persistence details'); } }), res = response();
    await analyze(multipart('lab'), res);
    denied(res, 503); assert.equal(res.body.code, 'ANALYSIS_SAVE_FAILED');
    assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]); releasedReservation(s.calls);
    assert.doesNotMatch(res.body.error, /private|STORAGE_ERROR/);
  });
}

test('document suspension during storage upload removes the object without persisting or auditing it', async t => {
  const gate = pause(), s = services(t, { onUpload: () => gate.wait() }), res = response();
  const running = documents(multipart(), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.deepEqual(s.removals, [{ bucket: 'medical-documents', paths: [s.uploads[0].path] }]);
  for (const table of ['medical_documents', 'audit_logs']) assert.equal(writes(s.calls, table).length, 0);
});

test('account deletion during document upload keeps its authentication response even if cleanup throws', async t => {
  const s = services(t, { removalThrows: true, onUpload: (_n, state) => { state.userExists = false; } }), res = response();
  await documents(multipart(), res);
  denied(res, 401); assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]);
  assert.equal(writes(s.calls, 'medical_documents').length, 0);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});

test('document persistence failure attempts cleanup without exposing provider details', async t => {
  const s = services(t, { onQuery: table => { if (table === 'medical_documents') throw new Error('private document input'); } }), res = response();
  await documents(multipart(), res);
  denied(res, 500); assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]);
  assert.doesNotMatch(res.body.error, /private/);
});

test('suspension during private document signing withholds the URL and its access audit', async t => {
  const gate = pause(), s = services(t, { onSign: () => gate.wait(), onQuery: table => {
    if (table === 'medical_documents') return { data: { id: 'document', patient_id: patientId, storage_path: 'patient/private.pdf' } };
  } }), res = response(), req = { ...request(), method: 'GET', query: { id: 'document' } };
  const running = documents(req, res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(res.body.url, undefined); assert.equal(writes(s.calls, 'audit_logs').length, 0);
});

test('account suspension during care-plan AI cannot supersede or insert a care plan', async t => {
  const gate = pause(), s = services(t, { onAI: () => gate.wait() }), res = response();
  const running = carePlan(request({ patient_id: patientId }), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(writes(s.calls, 'personalized_care_plans').length, 0);
  assert.equal(writes(s.calls, 'audit_logs').length, 0);
});

test('suspension while replacing a care plan prevents the replacement insert', async t => {
  const s = services(t, { onQuery: (table, ops, state) => {
    if (table === 'personalized_care_plans' && operation(ops, 'update')) state.status = 'blocked';
  } }), res = response();
  await carePlan(request({ patient_id: patientId }), res);
  denied(res); assert.equal(writes(s.calls, 'personalized_care_plans').filter(call => operation(call.operations, 'insert')).length, 0);
});

test('care-plan task lookup cannot finish with a write after account suspension', async t => {
  const gate = pause(), s = services(t, { onQuery: async (table, ops) => {
    if (table === 'personalized_care_plans') return { data: { id: 'plan', plan: {
      follow_up: [{ recommendation_id: 'recommendation', title: 'پیگیری', due_in_days: 7 }]
    } } };
    if (table === 'care_tasks' && operation(ops, 'select')) { await gate.wait(); return { data: null }; }
  } }), res = response();
  const running = carePlan(request({ patient_id: patientId, action: 'create_task', plan_id: 'plan', recommendation_id: 'recommendation' }), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(writes(s.calls, 'care_tasks').length, 0);
});

test('suspension during support AI retains the initial ticket but suppresses the late reply and response', async t => {
  const gate = pause(), s = services(t, { onAI: () => gate.wait() }), res = response();
  const running = support(request({ message: 'چطور پرونده بسازم؟' }), res);
  await gate.started; s.state.status = 'blocked'; gate.resume(); await running;
  denied(res); assert.equal(writes(s.calls, 'support_messages').length, 0);
  assert.deepEqual(s.state.supportMessages.map(message => message.sender_type), ['user']);
  assert.equal(s.state.supportMessages[0].content, 'چطور پرونده بسازم؟');
  assert.ok(s.rpcCalls.some(call => call.name === 'release_support_ai_reservation'));
  assert.equal(writes(s.calls, 'audit_logs').length, 0);
});

test('active accounts still persist documents, lab biomarkers, care plans and support replies', async t => {
  const s = services(t);
  for (const [handler, req, status] of [
    [documents, multipart(), 201], [analyze, multipart('lab'), 200],
    [carePlan, request({ patient_id: patientId }), 201], [support, request({ message: 'راهنمایی' }), 200]
  ]) {
    const res = response(); await handler(req, res);
    assert.equal(res.statusCode, status); assert.equal(res.body.success, true); assert.equal(res.sent, 1);
  }
  for (const table of ['medical_documents', 'test_results', 'lab_biomarkers', 'personalized_care_plans']) {
    assert.ok(writes(s.calls, table).length > 0, `${table} must still persist normally`);
  }
  const storedLab = operation(writes(s.calls, 'test_results')[0].operations, 'insert')[1];
  assert.deepEqual(storedLab.structured_analysis.sections.map(section => section.section_id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(storedLab.structured_analysis.sections.map(section => section.content), syntheticLabSections().map(section => section.content));
  assert.equal(storedLab.analysis, storedLab.structured_analysis.full_text);
  assert.deepEqual([...storedLab.analysis.matchAll(/^## (\d+)\. /gm)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(s.state.supportMessages.map(message => message.sender_type), ['user', 'assistant']);
  assert.equal(s.removals.length, 0); releasedReservation(s.calls);
});
