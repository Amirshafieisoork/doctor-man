import test from 'node:test';
import assert from 'node:assert/strict';
import { createToken } from '../server/api/_lib/session.js';

// These boundary tests use synthetic rows and never reach a live database or storage.
process.env.SUPABASE_URL = 'https://care-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-database-key';
process.env.SESSION_SECRET = 'test-only-session-secret-32-characters';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: doctorAccess } = await import('../server/api/doctor-access.js');
const { default: consent } = await import('../server/api/consent.js');
const { default: adminAction } = await import('../server/api/admin-action.js');
const { default: appointments } = await import('../server/api/appointments.js');
const { default: availability } = await import('../server/api/availability.js');
const userId = '11111111-1111-4111-8111-111111111111';
const grant = { id: 'grant', patient_id: 'patient', doctor_id: 'doctor' };

function request(method, body = {}, query = {}, admin = false) {
  const cookie = admin ? `drman_admin=${createToken({ sub: 'admin', role: 'admin' })}`
    : `drman_session=${createToken({ sub: userId, role: 'user' })}`;
  return { method, body, query, headers: { cookie } };
}
function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; } };
}
function database(resolve) {
  const calls = [];
  supabase.from = table => {
    const operations = [], query = {};
    for (const name of ['select', 'eq', 'gte', 'lt', 'in', 'neq', 'order', 'limit', 'insert', 'update', 'delete']) {
      query[name] = (...args) => { operations.push([name, ...args]); return query; };
    }
    const finish = async () => {
      calls.push({ table, operations });
      if (table === 'users' && !operation(operations, 'update')) return { data: { id: userId, status: 'active' } };
      return resolve(table, operations);
    };
    query.maybeSingle = finish; query.single = finish;
    query.then = (fulfilled, rejected) => finish().then(fulfilled, rejected);
    query.catch = rejected => finish().catch(rejected);
    return query;
  };
  return calls;
}
const operation = (operations, name) => operations.find(([op]) => op === name);

test('generic consent cannot report doctor sharing granted or revoked while permissions stay unchanged', async () => {
  for (const granted of [true, false]) {
    const calls = database(() => { throw Error('Doctor sharing must use the dedicated access controls'); });
    const res = response(); await consent(request('POST', { patient_id: 'patient', consent_type: 'doctor_share', granted }), res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.code, 'DOCTOR_ACCESS_REQUIRED');
    assert.match(res.body.error, /دسترسی پزشک/);
    assert.deepEqual(calls.map(call => call.table), ['users']);
  }
});

test('a failed doctor-access revocation is never reported as success or recorded as revoked consent', async () => {
  const calls = database((table, ops) => {
    if (table === 'patients') return { data: { id: 'patient' } };
    if (table === 'patient_access_grants') return operation(ops, 'update')
      ? { data: null, error: { code: 'DB_FAILURE' } } : { data: grant };
    throw Error('Consent or audit must not claim a failed revocation');
  });
  const res = response(); await doctorAccess(request('DELETE', { id: grant.id }), res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.success, false);
  assert.equal(calls.some(call => call.table === 'consent_records'), false);
});

test('foreign patient grants cannot be revoked and ownership failures stop permission writes', async () => {
  for (const patient of [{ data: null }, { data: null, error: { code: 'DB_FAILURE' } }]) {
    const calls = database(table => table === 'patient_access_grants' ? { data: grant } : patient);
    const res = response(); await doctorAccess(request('DELETE', { id: grant.id }), res);
    assert.equal(res.statusCode, patient.error ? 503 : 404);
    assert.equal(calls.some(call => operation(call.operations, 'update')), false);
    const lookup = calls.find(call => call.table === 'patients');
    assert.ok(lookup.operations.some(([op, key, value]) => op === 'eq' && key === 'owner_user_id' && value === userId));
  }
});

test('a replacement grant is not created when the previous permissions cannot be revoked', async () => {
  const calls = database((table, ops) => {
    if (table === 'patients') return { data: { id: 'patient' } };
    if (table === 'doctor_profiles') return { data: { id: 'doctor', verification_status: 'verified' } };
    if (table === 'patient_access_grants' && operation(ops, 'update')) return { error: { code: 'DB_FAILURE' } };
    throw Error('Unexpected grant creation');
  });
  const res = response(); await doctorAccess(request('POST', { patient_id: 'patient', doctor_id: 'doctor', scope: ['labs'] }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls.some(call => operation(call.operations, 'insert')), false);
});

test('successful revocation updates the owned grant before recording consent and audit', async () => {
  const calls = database((table, ops) => {
    if (table === 'patients') return { data: { id: 'patient' } };
    if (table === 'patient_access_grants') return { data: operation(ops, 'update') ? { id: grant.id } : grant };
    return { data: [] };
  });
  const res = response(); await doctorAccess(request('DELETE', { id: grant.id }), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
  const update = calls.find(call => operation(call.operations, 'update'));
  assert.ok(update.operations.some(([op, key, value]) => op === 'eq' && key === 'patient_id' && value === grant.patient_id));
  assert.equal(operation(calls.find(call => call.table === 'consent_records').operations, 'insert')[1].granted, false);
});

function erasureRows(table, ops, failure = '') {
  if (table === failure) return { data: null, error: { code: 'DB_FAILURE' } };
  if (table === 'account_deletion_requests') return { data: operation(ops, 'update') ? { id: 'request' }
    : { id: 'request', user_id: userId, status: 'requested', users: { account_type: 'patient' } } };
  if (table === 'users') return { data: { id: userId, status: 'blocked' } };
  if (table === 'patients') return { data: [{ id: 'patient' }] };
  if (table === 'medical_documents') return { data: [{ storage_path: 'patient/document.pdf' }] };
  if (table === 'test_results') return { data: [{ image_paths: ['patient/lab.jpg'] }] };
  return { data: [] };
}
function privateServices(t, { storageError = false, finalize = { ok: true }, events = [] } = {}) {
  const originalStorage = supabase.storage.from, originalRpc = supabase.rpc;
  t.after(() => { supabase.storage.from = originalStorage; supabase.rpc = originalRpc; });
  supabase.storage.from = bucket => ({ async remove(paths) {
    events.push({ bucket, paths }); return storageError ? { error: { code: 'STORAGE_FAILURE' } } : { data: paths };
  } });
  supabase.rpc = async (name, args) => { events.push({ name, args }); return { data: finalize }; };
  return events;
}

test('all erasure source queries must succeed before deleting files or medical rows', async t => {
  const events = privateServices(t);
  for (const failure of ['account_deletion_requests', 'patients', 'medical_documents', 'test_results']) {
    const calls = database((table, ops) => erasureRows(table, ops, failure));
    const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
    assert.equal(res.statusCode, 500, failure); assert.equal(res.body.success, false);
    assert.deepEqual(events, [], failure);
    if(failure==='account_deletion_requests')assert.equal(calls.some(call => operation(call.operations, 'update')), false);
  }
});

test('patient erasure freezes the account before taking any file inventory', async t => {
  privateServices(t);
  const calls = database(erasureRows);
  const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
  assert.equal(res.statusCode, 200);
  const freezeIndex = calls.findIndex(call => call.table === 'users' && operation(call.operations, 'update'));
  const patientIndex = calls.findIndex(call => call.table === 'patients');
  assert.ok(freezeIndex >= 0 && freezeIndex < patientIndex);
  for(const table of ['medical_documents','test_results'])assert.ok(freezeIndex < calls.findIndex(call => call.table === table));
  const freeze = calls[freezeIndex];
  assert.equal(operation(freeze.operations, 'update')[1].status, 'blocked');
  assert.ok(freeze.operations.some(([op,key,value]) => op==='eq'&&key==='account_type'&&value==='patient'));
});

test('an unacknowledged account freeze cannot collect files or erase medical data', async t => {
  const events = privateServices(t);
  for(const result of [{data:null},{data:null,error:{code:'DB_FAILURE'}},{data:{id:userId,status:'active'}}]){
    const calls = database((table,ops) => table === 'users' ? result : erasureRows(table,ops));
    const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
    assert.equal(res.statusCode, 500);
    assert.equal(calls.some(call => ['patients','medical_documents','test_results'].includes(call.table)),false);
    assert.deepEqual(events,[]);
  }
});

test('a cancelled erasure request cannot delete files after losing its processing claim', async t => {
  const events = privateServices(t);
  database((table, ops) => table === 'account_deletion_requests' && operation(ops, 'update')
    ? { data: null } : erasureRows(table, ops));
  const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
  assert.equal(res.statusCode, 409); assert.deepEqual(events, []);
});

test('storage cleanup errors leave erasure retryable and never finalize medical data deletion', async t => {
  const events = privateServices(t, { storageError: true });
  const calls = database(erasureRows);
  const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
  assert.equal(res.statusCode, 500);
  assert.equal(events.some(event => event.name === 'process_patient_account_erasure'), false);
  const claim = calls.find(call => operation(call.operations, 'update'));
  assert.equal(operation(claim.operations, 'update')[1].status, 'processing');
  assert.ok(claim.operations.some(([op, key, value]) => op === 'eq' && key === 'status' && value === 'requested'));
});

test('successful erasure cleans both private buckets before confirmed database finalization', async t => {
  const events = privateServices(t);
  database(erasureRows);
  const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
  assert.deepEqual(events, [
    { bucket: 'medical-documents', paths: ['patient/document.pdf'] },
    { bucket: 'lab-images', paths: ['patient/lab.jpg'] },
    { name: 'process_patient_account_erasure', args: { p_request_id: 'request' } }
  ]);
});

test('erasure needs explicit database finalization acknowledgement', async t => {
  privateServices(t, { finalize: { ok: false } }); database(erasureRows);
  const res = response(); await adminAction(request('POST', { action: 'process-deletion', id: 'request' }, {}, true), res);
  assert.equal(res.statusCode, 500); assert.equal(res.body.success, false);
});

test('unverified visits are rejected before review publication mutates the row', async () => {
  const calls = database(() => ({ data: { id: 'review', verified_visit: false } }));
  const res = response(); await adminAction(request('POST', { action: 'publish-review', id: 'review' }, {}, true), res);
  assert.equal(res.statusCode, 409);
  assert.equal(calls.some(call => operation(call.operations, 'update')), false);
});

test('review publication keeps its verified-visit condition on the mutation', async () => {
  const calls = database((table, ops) => ({ data: table === 'doctor_reviews'
    ? { id: 'review', verified_visit: true, status: operation(ops, 'update') ? 'published' : 'pending' } : [] }));
  const res = response(); await adminAction(request('POST', { action: 'publish-review', id: 'review' }, {}, true), res);
  assert.equal(res.statusCode, 200);
  const update = calls.find(call => operation(call.operations, 'update'));
  assert.ok(update.operations.some(([op, key, value]) => op === 'eq' && key === 'verified_visit' && value === true));
});

const date = '2031-01-06', startsAt = `${date}T06:30:00.000Z`;
const doctor = { id: 'doctor', verification_status: 'verified', public_profile: true, timezone: 'Asia/Tehran' };
const schedule = organization => ({ weekday: 1, start_time: '10:00', end_time: '11:00', slot_minutes: 30, mode: 'in_person', active: true, organization_id: organization });
function bookingDatabase(rows, scheduleError = false) {
  return database((table, ops) => {
    if (table === 'app_settings') return { data: { value: { appointments: true } } };
    if (table === 'patients') return { data: { id: 'patient' } };
    if (table === 'doctor_profiles') return { data: doctor };
    if (table === 'doctor_availability') return scheduleError ? { error: { code: 'DB_FAILURE' } } : { data: rows };
    if (table === 'appointments') return { data: operation(ops, 'insert') ? { id: 'appointment', status: 'requested' } : [] };
    return { data: [] };
  });
}
const booking = extra => request('POST', { patient_id: 'patient', doctor_id: doctor.id, starts_at: startsAt, mode: 'in_person', ...extra });

test('pending and suspended doctors cannot read patient appointment details', async () => {
  for (const verification_status of ['pending', 'suspended']) {
    const calls = database(table => table === 'doctor_profiles' ? { data: { ...doctor, verification_status } } : { data: [] });
    const res = response(); await appointments(request('GET', {}, { role: 'doctor' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls.some(call => call.table === 'appointments'), false);
  }
});

test('booking cannot move an advertised slot to an unrelated clinic', async () => {
  const calls = bookingDatabase([schedule('clinic-a')]);
  const res = response(); await appointments(booking({ organization_id: 'clinic-b' }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(calls.some(call => call.table === 'appointments' && operation(call.operations, 'insert')), false);
});

test('booking uses the authoritative schedule clinic when the client omits a location', async () => {
  const calls = bookingDatabase([schedule('clinic-a')]);
  const res = response(); await appointments(booking({}), res);
  assert.equal(res.statusCode, 201);
  const insert = calls.find(call => call.table === 'appointments' && operation(call.operations, 'insert'));
  assert.equal(operation(insert.operations, 'insert')[1].organization_id, 'clinic-a');
});

test('multiple same-time clinics require an explicit selection and retain their own duration', async () => {
  const rows = [schedule('clinic-a'), { ...schedule('clinic-b'), slot_minutes: 60 }];
  let calls = bookingDatabase(rows), res = response(); await appointments(booking({}), res);
  assert.equal(res.statusCode, 409);
  assert.equal(calls.some(call => call.table === 'appointments' && operation(call.operations, 'insert')), false);
  calls = bookingDatabase(rows); res = response(); await appointments(booking({ organization_id: 'clinic-b' }), res);
  assert.equal(res.statusCode, 201);
  const payload = operation(calls.find(call => call.table === 'appointments' && operation(call.operations, 'insert')).operations, 'insert')[1];
  assert.equal(payload.organization_id, 'clinic-b'); assert.equal(payload.ends_at, `${date}T07:30:00.000Z`);
});

test('an explicitly selected slot without a clinic does not silently choose a clinic', async () => {
  const calls = bookingDatabase([schedule('clinic-a'), schedule(null)]);
  const res = response(); await appointments(booking({ organization_id: null }), res);
  assert.equal(res.statusCode, 201);
  const insert = calls.find(call => call.table === 'appointments' && operation(call.operations, 'insert'));
  assert.equal(operation(insert.operations, 'insert')[1].organization_id, null);
});

test('schedule query failure prevents appointment creation', async () => {
  const calls = bookingDatabase([], true);
  const res = response(); await appointments(booking({ organization_id: 'clinic-a' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(calls.some(call => call.table === 'appointments' && operation(call.operations, 'insert')), false);
});

test('public availability preserves separate locations and only reserves requested or confirmed visits', async () => {
  const cancelled = { starts_at: startsAt, ends_at: `${date}T07:00:00.000Z`, status: 'cancelled' };
  const calls = database((table, ops) => {
    if (table === 'doctor_profiles') return { data: doctor };
    if (table === 'doctor_availability') return { data: [schedule('clinic-a'), schedule('clinic-b')] };
    if (table === 'appointments') {
      const statuses = ops.find(([op, field]) => op === 'in' && field === 'status')?.[2];
      return { data: statuses ? [cancelled].filter(item => statuses.includes(item.status)) : [cancelled] };
    }
    return { data: [] };
  });
  const res = response(); await availability(request('GET', {}, { doctor_id: doctor.id, date }), res);
  assert.equal(res.statusCode, 200);
  const firstSlots = res.body.slots.filter(slot => slot.starts_at === startsAt);
  assert.deepEqual(firstSlots.map(slot => slot.organization_id), ['clinic-a', 'clinic-b']);
  const query = calls.find(call => call.table === 'appointments');
  assert.deepEqual(query.operations.find(([op, field]) => op === 'in' && field === 'status')[2], ['requested', 'confirmed']);
});

test('conflicting durations at the same location are not offered as bookable slots', async () => {
  for (const conflicts of [[], [{ starts_at: `${date}T07:00:00.000Z`, ends_at: `${date}T07:30:00.000Z`, status: 'confirmed' }]]) {
    database(table => table === 'doctor_profiles' ? { data: doctor } : table === 'doctor_availability'
      ? { data: [schedule('clinic-a'), { ...schedule('clinic-a'), slot_minutes: 60 }] }
      : { data: conflicts });
    const res = response(); await availability(request('GET', {}, { doctor_id: doctor.id, date }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.slots.some(slot => slot.starts_at === startsAt), false);
  }
});
