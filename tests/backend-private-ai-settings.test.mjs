import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPrivateAIKey, decryptPrivateAIKey, readPrivateAISettings, readPublicPrivateAISettings, savePrivateAISettings } from '../server/api/_lib/private-ai-settings.js';
import { createToken } from '../server/api/_lib/session.js';

process.env.SUPABASE_URL = 'https://private-ai-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'synthetic-only-database-key';
process.env.SESSION_SECRET = 'synthetic-only-encryption-secret-at-least-32';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: adminAISettings } = await import('../server/api/admin-ai-settings.js');
const { default: adminSettings } = await import('../server/api/admin-settings.js');
const syntheticKey = 'gsk-synthetic-only-free-key-not-a-real-secret';
function response() { return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; } }; }
function request(method, body, role = 'admin') { return { method, body, headers: { cookie: role ? `${role === 'admin' ? 'drman_admin' : 'drman_session'}=${createToken({ sub: role, role })}` : '' } }; }
function fixture(initial = null) {
  let row = initial; const calls = [];
  const database = { from(table) {
    const operations = [], query = {};
    for (const method of ['select', 'eq', 'in', 'order', 'insert', 'upsert']) query[method] = (...args) => { operations.push([method, ...args]); return query; };
    const finish = async () => { calls.push({ table, operations }); if (table === 'app_settings') { const upsert = operations.find(([name]) => name === 'upsert'); if (upsert) row = upsert[1]; return { data: row, error: null }; } return { data: [], error: null }; };
    query.then = (a, b) => finish().then(a, b); query.maybeSingle = finish; return query;
  } };
  return { database, calls, row: () => row };
}

test('provider-bound AES-GCM ciphertext changes on each save and decrypts only under the correct server secret', () => {
  const one = encryptPrivateAIKey(syntheticKey, 'groq'), two = encryptPrivateAIKey(syntheticKey, 'groq');
  assert.notEqual(one.ciphertext, two.ciphertext); assert.notEqual(one.iv, two.iv); assert.equal(decryptPrivateAIKey(one, 'groq'), syntheticKey);
  assert.throws(() => decryptPrivateAIKey(one, 'other-provider'));
  const previous = process.env.SESSION_SECRET; try { process.env.SESSION_SECRET = 'another-synthetic-encryption-secret-at-least-32'; assert.throws(() => decryptPrivateAIKey(one, 'groq')); } finally { process.env.SESSION_SECRET = previous; }
});

test('tampered ciphertext, authentication tag and noncanonical IV are rejected', () => {
  const encrypted = encryptPrivateAIKey(syntheticKey, 'groq');
  for (const altered of [{ ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -1) + (encrypted.ciphertext.endsWith('A') ? 'B' : 'A') }, { ...encrypted, tag: 'A'.repeat(22) }, { ...encrypted, iv: encrypted.iv + '=' }, { ...encrypted, version: 2 }]) assert.throws(() => decryptPrivateAIKey(altered, 'groq'));
});

test('secrets are never stored in plaintext and public summary exposes no key, ciphertext or suffix', async () => {
  const f = fixture(); const saved = await savePrivateAISettings({ provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }, f.database);
  assert.equal(saved.free_only, true); assert.equal(saved.key_configured, true); assert.equal(JSON.stringify(f.row()).includes(syntheticKey), false);
  assert.deepEqual(await readPrivateAISettings(f.database), { provider: 'groq', free_only: true, free_account_confirmed: true, api_key: syntheticKey });
  const summary = await readPublicPrivateAISettings(f.database); assert.equal(summary.key_configured, true);
  assert.deepEqual(Object.keys(summary).sort(), ['provider', 'free_only', 'key_configured', 'free_account_confirmed', 'encryption_ready', 'updated_at'].sort());
  assert.equal(JSON.stringify(summary).includes(syntheticKey), false); assert.equal(JSON.stringify(summary).includes(f.row().value.encrypted_api_key.ciphertext), false);
  assert.ok(f.calls.every(call => call.operations.some(([op, key, value]) => op === 'eq' && key === 'key' && value === 'private_ai') || call.operations.some(([op]) => op === 'upsert')));
});

test('empty key preserves the same provider key, a provider switch needs a new key, and explicit clearing removes it', async () => {
  const f = fixture(); await savePrivateAISettings({ provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }, f.database);
  await savePrivateAISettings({ provider: 'groq', free_account_confirmed: true, api_key: '' }, f.database); assert.equal((await readPrivateAISettings(f.database)).api_key, syntheticKey);
  assert.equal(f.calls.filter(call => call.operations.some(([op]) => op === 'upsert')).length, 1);
  await assert.rejects(savePrivateAISettings({ provider: 'other-provider', free_account_confirmed: true, api_key: '' }, f.database), { status: 400 }); assert.equal(f.row().value.provider, 'groq');
  await savePrivateAISettings({ provider: 'groq', free_account_confirmed: true, clear_key: true }, f.database); assert.equal(f.row().value.encrypted_api_key, null); assert.equal((await readPublicPrivateAISettings(f.database)).key_configured, false);
});

test('paid configuration, arbitrary providers, invalid keys and contradictory deletion cannot mutate stored settings', async () => {
  const f = fixture();
  for (const input of [{ provider: 'groq', free_account_confirmed: true, api_key: syntheticKey, free_only: false }, { provider: 'custom', free_account_confirmed: true, api_key: syntheticKey }, { provider: 'groq', free_account_confirmed: true, api_key: 'contains line\n' + syntheticKey }, { provider: 'groq', free_account_confirmed: true, api_key: syntheticKey, clear_key: true }, { provider: 'groq', free_account_confirmed: true, api_key: { key: syntheticKey } }, { provider: 'groq', free_account_confirmed: true, api_key: syntheticKey, clear_key: 'true' }]) await assert.rejects(savePrivateAISettings(input, f.database), { status: 400 });
  assert.equal(f.row(), null); assert.equal(f.calls.length, 0);
});

test('unconfirmed or paid Groq accounts are rejected before reading or writing configuration', async () => {
  const f = fixture();
  for (const free_account_confirmed of [false, undefined, 'true', 1]) {
    await assert.rejects(savePrivateAISettings({ provider: 'groq', api_key: syntheticKey, free_account_confirmed }, f.database), { status: 400 });
  }
  assert.equal(f.calls.length, 0);
});

test('configuration read fails closed on corrupted ciphertext, unsupported provider or paid flag', async () => {
  const encrypted = encryptPrivateAIKey(syntheticKey, 'groq');
  for (const value of [{ version: 1, provider: 'groq', free_only: false, free_account_confirmed: true, encrypted_api_key: encrypted }, { version: 1, provider: 'custom', free_only: true, free_account_confirmed: true, encrypted_api_key: encrypted }, { version: 1, provider: 'groq', free_only: true, free_account_confirmed: true, encrypted_api_key: { ...encrypted, tag: 'A'.repeat(22) } }]) await assert.rejects(readPrivateAISettings(fixture({ value }).database));
});

test('missing encryption secret refuses API key storage rather than using service-role credentials as a cipher secret', async () => {
  const f = fixture(), previous = process.env.SESSION_SECRET; try { delete process.env.SESSION_SECRET; await assert.rejects(savePrivateAISettings({ provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }, f.database), { code: 'AI_SETTINGS_ENCRYPTION_UNAVAILABLE' }); assert.equal(f.row(), null); } finally { process.env.SESSION_SECRET = previous; }
});

test('anonymous and ordinary user sessions cannot read or write provider settings', async t => {
  const previous = supabase.from; t.after(() => { supabase.from = previous; }); supabase.from = () => { throw new Error('unauthorized database access'); };
  for (const role of [null, 'user']) for (const method of ['GET', 'PUT']) { const res = response(); await adminAISettings(request(method, { provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }, role), res); assert.equal(res.statusCode, 401); }
});

test('owner PUT/GET return only configuration metadata, and audit contains no secret', async t => {
  const f = fixture(), previous = supabase.from; t.after(() => { supabase.from = previous; }); supabase.from = f.database.from;
  let res = response(); await adminAISettings(request('PUT', { provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }), res); assert.equal(res.statusCode, 200); assert.equal(res.body.settings.key_configured, true); assert.equal(JSON.stringify(res.body).includes(syntheticKey), false);
  const audit = f.calls.find(call => call.table === 'audit_logs').operations.find(([name]) => name === 'insert')[1]; assert.equal(audit.metadata.provider, 'groq'); assert.equal(JSON.stringify(audit).includes(syntheticKey), false); assert.equal(JSON.stringify(audit).includes('ciphertext'), false);
  res = response(); await adminAISettings(request('GET'), res); assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(res.body.settings.key_configured, true); assert.equal(JSON.stringify(res.body).includes(syntheticKey), false);
});

test('database failure messages cannot echo a supplied API key in owner response', async t => {
  const previous = supabase.from; t.after(() => { supabase.from = previous; }); supabase.from = () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ error: new Error('database echoed ' + syntheticKey) }) });
  const res = response(); await adminAISettings(request('PUT', { provider: 'groq', free_account_confirmed: true, api_key: syntheticKey }), res); assert.equal(res.statusCode, 503); assert.equal(JSON.stringify(res.body).includes(syntheticKey), false);
});

test('generic settings defensively exclude private provider row even if a database mock returns unexpected data', async t => {
  const previous = supabase.from; t.after(() => { supabase.from = previous; }); const rows = [{ key: 'general', value: { site_name: 'DrMan' } }, { key: 'private_ai', value: { api_key: syntheticKey } }];
  supabase.from = () => ({ select() { return this; }, in(_key, values) { assert.deepEqual(values, ['general', 'seo', 'features']); return this; }, order: async () => ({ data: rows, error: null }) });
  const res = response(); await adminSettings(request('GET'), res); assert.equal(res.statusCode, 200); assert.equal(res.body.settings.private_ai, undefined); assert.equal(JSON.stringify(res.body).includes(syntheticKey), false);
});
