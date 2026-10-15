import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createEmergencyCardHandler } from '../server/api/emergency-card.js';
import { createEmergencyPageHandler } from '../server/api/emergency-page.js';

const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end(value) { this.body = value; return this; } });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture() {
  let card = null; const calls = [];
  const database = { from(table) {
    const operations = [], query = {};
    for (const method of ['select', 'eq', 'limit', 'upsert', 'insert']) query[method] = (...args) => { operations.push([method, ...args]); return query; };
    const finish = async () => {
      calls.push({ table, operations });
      const eq = key => operations.find(([op, field]) => op === 'eq' && field === key)?.[2];
      if (table === 'patients') {
        if (eq('owner_user_id') && eq('owner_user_id') !== 'owner') return { data: null };
        return { data: { id: 'patient', display_name: '<script>alert(1)</script>', blood_type: 'A+', emergency_contact_name: 'همراه', emergency_contact_phone: '09120000000' } };
      }
      if (table === 'emergency_cards') {
        const payload = operations.find(([op]) => op === 'upsert')?.[1]; if (payload) card = { ...payload, id: 'card' };
        if (eq('token_hash') && (eq('token_hash') !== card?.token_hash || !card?.enabled)) return { data: null };
        const fields = operations.find(([op]) => op === 'select')?.[1];
        return { data: card ? Object.fromEntries(fields.split(',').map(key => [key, card[key]])) : null };
      }
      if (table === 'patient_allergies') return { data: [{ allergen: '<img src=x onerror=alert(1)>', severity: 'severe', reaction: 'تنگی نفس' }] };
      if (table === 'patient_conditions') return { data: [{ name: 'بیماری ثبت‌شده', status: 'active' }] };
      if (table === 'patient_medications') return { data: [{ name: 'داروی ثبت‌شده', dose: 'مقدار', frequency: 'دفعات' }] };
      return { data: null };
    };
    query.then = (yes, no) => finish().then(yes, no); query.maybeSingle = finish; query.single = finish; return query;
  } };
  return { database, calls, card: () => card };
}
const auth = async () => ({ sub: 'owner' });
const save = async (handler, body) => { const res = response(); await handler({ method: 'POST', body: { patient_id: 'patient', enabled: true, ...body } }, res); return res; };

test('creating, rotating and disabling a QR stores only a digest and revokes old public links', async () => {
  const f = fixture(), handler = createEmergencyCardHandler({ database: f.database, authenticate: auth }), publicPage = createEmergencyPageHandler({ database: f.database });
  const first = await save(handler, { show_conditions: false }); assert.equal(first.statusCode, 200); const firstToken = first.body.url.split('/').pop();
  assert.match(firstToken, /^[A-Za-z0-9_-]{32}$/); assert.equal(f.card().token_hash, hash(firstToken)); assert.equal(JSON.stringify(f.card()).includes(firstToken), false); assert.equal(first.body.card.token_hash, undefined);
  let res = response(); await publicPage({ method: 'GET', query: { token: firstToken } }, res); assert.equal(res.statusCode, 200);
  const second = await save(handler, {}), secondToken = second.body.url.split('/').pop(); assert.notEqual(secondToken, firstToken);
  res = response(); await publicPage({ method: 'GET', query: { token: firstToken } }, res); assert.equal(res.statusCode, 404);
  res = response(); await publicPage({ method: 'GET', query: { token: secondToken } }, res); assert.equal(res.statusCode, 200);
  const disabled = await save(handler, { enabled: false }); assert.equal(disabled.body.url, null); assert.equal(f.card().token_hash, null);
  res = response(); await publicPage({ method: 'GET', query: { token: secondToken } }, res); assert.equal(res.statusCode, 404);
  assert.equal(f.calls.filter(call => call.table === 'audit_logs').length, 3);
});

test('owner GET never returns a raw token or digest and uses a private no-store response', async () => {
  const f = fixture(), handler = createEmergencyCardHandler({ database: f.database, authenticate: auth }); await save(handler, {});
  const res = response(); await handler({ method: 'GET', query: { patient_id: 'patient' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.card.token_hash, undefined); assert.equal(res.body.url, undefined); assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('public pages expose only selected emergency categories and escape stored text', async () => {
  const f = fixture(), handler = createEmergencyCardHandler({ database: f.database, authenticate: auth });
  const saved = await save(handler, { show_blood_type: false, show_conditions: false, show_medications: false, show_emergency_contact: false });
  const res = response(); await createEmergencyPageHandler({ database: f.database })({ method: 'GET', query: { token: saved.body.url.split('/').pop() } }, res);
  assert.equal(res.statusCode, 200); assert.match(res.body, /&lt;script&gt;/); assert.match(res.body, /&lt;img/); assert.doesNotMatch(res.body, /<img|<script>alert|09120000000|A\+|داروی ثبت‌شده|بیماری ثبت‌شده/);
  assert.equal(f.calls.some(call => ['patient_conditions', 'patient_medications'].includes(call.table)), false);
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer'); assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(res.body, /theme-v1|national_id|insurance|token_hash/);
  assert.ok(f.calls.filter(call => call.table === 'patients').every(call => !call.operations.find(([op, value]) => op === 'select' && /national|insurance|\*/.test(value))));
});

test('another owner cannot read, rotate or revoke a patient emergency card', async () => {
  const f = fixture(), handler = createEmergencyCardHandler({ database: f.database, authenticate: async () => ({ sub: 'other-owner' }) });
  for (const method of ['GET', 'POST']) { const res = response(); await handler({ method, query: { patient_id: 'patient' }, body: { patient_id: 'patient', enabled: true } }, res); assert.equal(res.statusCode, 404); }
  assert.equal(f.calls.some(call => call.table === 'emergency_cards'), false);
});

test('invalid consent controls and malformed tokens fail before touching medical records', async () => {
  const f = fixture(), handler = createEmergencyCardHandler({ database: f.database, authenticate: auth });
  for (const body of [{ enabled: 'true' }, { show_blood_type: 'true' }, { show_allergies: 0 }]) assert.equal((await save(handler, body)).statusCode, 400);
  const publicPage = createEmergencyPageHandler({ database: f.database });
  for (const token of ['../secrets', 'a'.repeat(9999), 'abc', 'a'.repeat(31) + '!']) { const res = response(); await publicPage({ method: 'GET', query: { token } }, res); assert.equal(res.statusCode, 404); }
  assert.equal(f.calls.length, 0);
});

test('database failures do not show a misleading empty medical card or echo internal details', async () => {
  const error = new Error('private-database-details'); const database = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { error }; } }; } };
  const res = response(); await createEmergencyPageHandler({ database })({ method: 'GET', query: { token: 'a'.repeat(32) } }, res); assert.equal(res.statusCode, 503); assert.doesNotMatch(res.body, /private-database-details/);
  const owner = await save(createEmergencyCardHandler({ database, authenticate: auth }), {}); assert.equal(owner.statusCode, 503); assert.doesNotMatch(JSON.stringify(owner.body), /private-database-details/);
});
