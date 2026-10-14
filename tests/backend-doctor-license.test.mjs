import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import OpenAI from 'openai';
process.env.SUPABASE_URL = 'https://doctor-license-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-db-key';
process.env.SESSION_SECRET = 'test-only-session-secret-32-characters';
process.env.AVALAI_API_KEY = 'test-only-ai-key';
const { supabase } = await import('../server/api/_lib/db.js');
const { createToken } = await import('../server/api/_lib/session.js');
const { default: onboarding } = await import('../server/api/doctor-onboarding.js');
const { default: license } = await import('../server/api/doctor-license.js');
const { default: review } = await import('../server/api/admin-doctor-review.js');
const { default: dashboard } = await import('../server/api/doctor-dashboard.js');
const { licenseView, validateLicenseReport } = await import('../server/api/_lib/doctor-license.js');
const userId = '11111111-1111-4111-8111-111111111111', doctorId = '22222222-2222-4222-8222-222222222222', documentId = '33333333-3333-4333-8333-333333333333';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const document = { id: documentId, doctor_id: doctorId, uploaded_by_user_id: userId, storage_path: `${userId}/private.png`, mime_type: 'image/png', original_name: 'مجوز.png', file_size: png.length, sha256: 'a'.repeat(64), review_decision: 'pending', ai_report: { status: 'unavailable' }, updated_at: '2026-10-13T01:00:00.000Z' };
const profile = { full_name: 'پزشک آزمایشی', medical_license_number: '۱۲۳۴۵', specialty: 'پزشک عمومی', consultation_fee: '' };
const op = (operations, name) => operations.find(item => item[0] === name);
function response() { return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(bytes) { this.bytes = bytes; return this; }, setHeader(name, value) { this.headers[name] = value; }, getHeader(name) { return this.headers[name]; } }; }
function request(method = 'GET', body = {}, query = {}, role = 'user') { return { method, body, query, headers: { cookie: `${role === 'admin' ? 'drman_admin' : 'drman_session'}=${createToken({ sub: role === 'admin' ? 'admin' : userId, role })}` } }; }
function multipart({ mime = 'image/png', bytes = png, count = 1 } = {}) {
  const boundary = 'doctor-license-test', chunks = [];
  for (const [name, value] of Object.entries(profile)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (let index = 0; index < count; index++) { chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="license_image"; filename="license.png"\r\nContent-Type: ${mime}\r\n\r\n`)); chunks.push(bytes, Buffer.from('\r\n')); }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const req = Readable.from([Buffer.concat(chunks)]); Object.assign(req, request('POST')); delete req.body; req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`; return req;
}
function services(t, { existing = null, savedDocument = document, onQuery, onUpload, onAI, onRPC } = {}) {
  const saved = { from: supabase.from, storage: supabase.storage.from, rpc: supabase.rpc, create: OpenAI.Chat.Completions.prototype.create };
  t.after(() => { supabase.from = saved.from; supabase.storage.from = saved.storage; supabase.rpc = saved.rpc; OpenAI.Chat.Completions.prototype.create = saved.create; });
  const calls = [], uploads = [], removals = [], downloads = [], rpc = [], state = { active: true };
  supabase.from = table => {
    const operations = [], query = {};
    for (const name of ['select', 'eq', 'gte', 'in', 'order', 'range', 'insert', 'update']) query[name] = (...args) => { operations.push([name, ...args]); return query; };
    const finish = async () => {
      calls.push({ table, operations }); const override = await onQuery?.(table, operations, state); if (override !== undefined) return override;
      if (table === 'users') return { data: { id: userId, status: state.active ? 'active' : 'blocked' } };
      if (table === 'doctor_profiles') return { data: existing };
      if (table === 'doctor_license_documents') return { data: savedDocument };
      if (table === 'auth_rate_events' && op(operations, 'insert')) return { data: { id: 'reserved' } };
      if (table === 'auth_rate_events') return { count: 0 };
      return { data: null };
    };
    query.single = finish; query.maybeSingle = finish; query.then = (resolve, reject) => finish().then(resolve, reject); return query;
  };
  supabase.storage.from = bucket => ({
    async upload(path, bytes, options) { uploads.push({ bucket, path, bytes, options }); await onUpload?.(state); return { data: { path } }; },
    async remove(paths) { removals.push({ bucket, paths }); return {}; },
    async download(path) { downloads.push({ bucket, path }); return { data: new Blob([png]) }; }
  });
  supabase.rpc = async (name, args) => { rpc.push({ name, args }); const result = await onRPC?.(name, args); return result || { data: { doctor: { id: doctorId, user_id: userId, verification_status: 'pending' }, document: { ...document, ai_report: args.p_document?.ai_report || {} } } }; };
  OpenAI.Chat.Completions.prototype.create = async function (payload) { if (onAI) return await onAI(payload, state); throw new Error('test-only AI outage'); };
  return { calls, uploads, removals, downloads, rpc, state };
}

test('license metadata excludes storage paths, uploader identifiers and hashes', () => {
  const view = licenseView(document, doctorId); const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /storage_path|uploaded_by_user_id|sha256|private\.png/);
  assert.equal(view.document.updated_at, document.updated_at); assert.equal(view.status, 'uploaded');
});
test('AI report cannot approve a license, and normalized license mismatch is flagged', () => {
  const result = validateLicenseReport({ readable: true, extracted_name: 'پزشک آزمایشی', license_number: '999', document_type: 'کارت', expiry_date: '', flags: [], summary: 'خوانا', verified: true }, profile);
  assert.equal(result.authenticity_verified, false); assert.equal(result.verified, undefined); assert.ok(result.flags.some(flag => flag.includes('متفاوت')));
  assert.throws(() => validateLicenseReport({ readable: 'true' }, profile));
});
test('anonymous image access never queries or downloads private documents', async t => {
  const s = services(t); const res = response(); await license({ method: 'GET', headers: {}, query: { id: doctorId, image: '1' } }, res);
  assert.equal(res.statusCode, 401); assert.equal(s.calls.length, 0); assert.equal(s.downloads.length, 0);
});
test('request for another doctor must be scoped to logged-in owner before lookup', async t => {
  const s = services(t, { onQuery: (table, operations) => { if (table === 'doctor_profiles') { assert.ok(operations.some(([name, field, value]) => name === 'eq' && field === 'id' && value === doctorId)); assert.ok(operations.some(([name, field, value]) => name === 'eq' && field === 'user_id' && value === userId)); return { data: null }; } } });
  const res = response(); await license(request('GET', {}, { id: doctorId, image: '1' }), res);
  assert.equal(res.statusCode, 404); assert.equal(s.downloads.length, 0); assert.equal(s.calls.some(call => call.table === 'doctor_license_documents'), false);
});
for (const role of ['user', 'admin']) test(`${role} can view the authorized image through no-store private endpoint`, async t => {
  const s = services(t, { existing: { id: doctorId, user_id: userId } }); const res = response(); await license(request('GET', {}, { id: doctorId, image: '1' }, role), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.bytes, png); assert.equal(res.headers['Cache-Control'], 'no-store, private'); assert.equal(res.headers['Cross-Origin-Resource-Policy'], 'same-origin'); assert.equal(s.downloads[0].bucket, 'doctor-licenses');
});
test('new doctor cannot submit registration without a professional image', async t => {
  const s = services(t); const res = response(); await onboarding(request('POST', profile), res);
  assert.equal(res.statusCode, 400); assert.equal(s.uploads.length, 0); assert.equal(s.rpc.length, 0);
});
for (const bad of [{ mime: 'image/png', bytes: Buffer.from('<script>unsafe</script>') }, { mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7') }, { count: 2 }, { bytes: Buffer.alloc(4 * 1024 * 1024 + 1, 1) }]) test(`invalid or oversized license image is rejected before storage: ${JSON.stringify({ ...bad, bytes: bad.bytes?.length })}`, async t => {
  const s = services(t); const res = response(); await onboarding(multipart(bad), res); assert.equal(res.statusCode, 400); assert.equal(s.uploads.length, 0); assert.equal(s.rpc.length, 0);
});
test('AI outage still saves a private image and a pending application atomically', async t => {
  const s = services(t); const res = response(); await onboarding(multipart(), res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.doctor.verification_status, 'pending'); assert.equal(res.body.license.ai_report.status, 'unavailable');
  assert.equal(s.uploads[0].bucket, 'doctor-licenses'); assert.equal(s.uploads[0].options.upsert, false); assert.equal(s.rpc[0].name, 'submit_doctor_application');
  assert.equal(s.rpc[0].args.p_document.ai_report.authenticity_verified, false); assert.doesNotMatch(JSON.stringify(res.body), /storage_path|sha256/);
});
test('successful vision extraction remains preliminary and pending for the administrator', async t => {
  const s = services(t, { onAI: payload => {
    assert.equal(payload.response_format.json_schema.name, 'drman_doctor_license_screen');
    assert.match(payload.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
    return { choices: [{ message: { content: JSON.stringify({ readable: true, extracted_name: profile.full_name, license_number: '۱۲۳۴۵', document_type: 'پروانه طبابت', expiry_date: '', flags: [], summary: 'مشخصات قابل خواندن است؛ بررسی مرجع رسمی لازم است.' }) } }] };
  } }); const res = response(); await onboarding(multipart(), res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.doctor.verification_status, 'pending'); assert.equal(res.body.license.status, 'screened');
  assert.equal(res.body.license.ai_report.authenticity_verified, false); assert.equal(s.rpc[0].args.p_profile.verification_status, undefined);
});
test('editing a registered profile rescreens its existing private image instead of requiring a duplicate upload', async t => {
  const s = services(t, { existing: { id: doctorId, user_id: userId, slug: 'registered' } }); const res = response(); await onboarding(request('PATCH', profile), res);
  assert.equal(res.statusCode, 200); assert.equal(s.uploads.length, 0); assert.equal(s.downloads[0].bucket, 'doctor-licenses');
  assert.equal(s.rpc[0].args.p_document.storage_path, document.storage_path); assert.equal(s.rpc[0].args.p_document.ai_report.status, 'unavailable');
  assert.equal(s.rpc[0].args.p_document.expected_document_id, documentId);
  assert.equal(s.rpc[0].args.p_document.expected_document_updated_at, document.updated_at);
});
test('a replaced license during profile rescreen returns a refresh conflict without changing storage', async t => {
  const s = services(t, { existing: { id: doctorId, user_id: userId, slug: 'registered' }, onRPC: () => ({ error: { code: '40001', message: 'LICENSE_CHANGED' } }) });
  const res = response(); await onboarding(request('PATCH', profile), res);
  assert.equal(res.statusCode, 409); assert.match(res.body.error, /تازه/);
  assert.equal(s.uploads.length, 0); assert.equal(s.removals.length, 0);
  assert.equal(s.rpc[0].args.p_document.expected_document_id, documentId);
});
test('a suspended account after upload loses its new object and cannot persist registration', async t => {
  const s = services(t, { onUpload: state => { state.active = false; } }); const res = response(); await onboarding(multipart(), res);
  assert.equal(res.statusCode, 403); assert.equal(s.rpc.length, 0); assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]);
});
test('atomic registration failure cleans new private image without exposing database details', async t => {
  const s = services(t, { onRPC: () => ({ error: { code: 'PRIVATE_DATABASE_ERROR' } }) }); const res = response(); await onboarding(multipart(), res);
  assert.equal(res.statusCode, 503); assert.deepEqual(s.removals[0].paths, [s.uploads[0].path]); assert.doesNotMatch(res.body.error, /PRIVATE_DATABASE_ERROR/);
});
test('admin approval requires independent registry confirmation and document version', async t => {
  const s = services(t); const base = { id: doctorId, decision: 'verified', reason: 'مشخصات مطابقت دارد', document_id: documentId, document_updated_at: document.updated_at };
  const res = response(); await review(request('POST', base, {}, 'admin'), res); assert.equal(res.statusCode, 400); assert.equal(s.rpc.length, 0);
  const missing = response(); await review(request('POST', { ...base, registry_checked: true, document_id: undefined }, {}, 'admin'), missing); assert.equal(missing.statusCode, 400); assert.equal(s.rpc.length, 0);
});
test('user cannot call admin review and changed license is never approved', async t => {
  const s = services(t, { onRPC: () => ({ data: { ok: false, code: 'LICENSE_CHANGED' } }) }); const body = { id: doctorId, decision: 'verified', reason: 'مطابقت با مرجع رسمی', document_id: documentId, document_updated_at: document.updated_at, registry_checked: true };
  const denied = response(); await review(request('POST', body), denied); assert.equal(denied.statusCode, 401); assert.equal(s.rpc.length, 0);
  const changed = response(); await review(request('POST', body, {}, 'admin'), changed); assert.equal(changed.statusCode, 409); assert.equal(s.rpc[0].args.p_document_id, documentId); assert.equal(s.rpc[0].args.p_document_updated_at, document.updated_at);
});
for (const verification_status of ['pending', 'rejected', 'suspended']) test(`${verification_status} doctor sees own application without querying clinical records`, async t => {
  const s = services(t, { existing: { id: doctorId, user_id: userId, verification_status } }); const res = response();
  await dashboard(request(), res); assert.equal(res.statusCode, 200); assert.equal(res.body.doctor.verification_status, verification_status);
  assert.deepEqual(res.body.patients, []); assert.deepEqual(res.body.appointments, []); assert.deepEqual(res.body.messages, []);
  assert.deepEqual(s.calls.map(call => call.table), ['users', 'doctor_profiles']);
});
