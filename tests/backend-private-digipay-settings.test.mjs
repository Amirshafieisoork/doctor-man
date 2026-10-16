import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createToken } from '../server/api/_lib/session.js';
import { DIGIPAY_BASES, encryptDigiPayCredentials, decryptDigiPayCredentials, savePrivateDigiPaySettings, readEffectiveDigiPaySettings, readPublicDigiPaySettings, recordDigiPayAuthCheck } from '../server/api/_lib/private-digipay-settings.js';
import { requestDigiPayToken } from '../server/api/_lib/digipay.js';

process.env.SESSION_SECRET = 'synthetic-digipay-encryption-secret-at-least32';
process.env.SUPABASE_URL = 'https://digipay-boundary-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'synthetic-database-key';
const { createAdminDigiPaySettingsHandler } = await import('../server/api/admin-digipay-settings.js');
const { createAdminDigiPayTestHandler } = await import('../server/api/admin-digipay-test.js');
const { default: router } = await import('../api/router.js');
const { default: genericSettings } = await import('../server/api/admin-settings.js');
const { default: paymentStart } = await import('../server/api/payment-start.js');
const { supabase } = await import('../server/api/_lib/db.js');
const credentials = { client_id: 'synthetic-client-id', client_secret: 'synthetic-client-secret', username: 'synthetic-api-username', password: 'synthetic-api-password' };
const token = 'synthetic-only-access-token-not-real';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture(initial = null, resources) {
  let row = initial; const calls = [];
  const database = createClient('https://digipay-db.invalid', 'synthetic-role-key', { auth: { persistSession: false }, global: { fetch: async (input, options) => {
    const request = new Request(input, options), url = new URL(request.url), body = request.method === 'GET' ? null : await request.json();
    calls.push({ method: request.method, url, body, headers: request.headers });
    if (url.pathname.endsWith('/audit_logs')) return json(null, 201);
    if (!url.pathname.endsWith('/app_settings') && resources) return resources({ request, url, body });
    assert.equal(url.pathname, '/rest/v1/app_settings');
    if (request.method === 'GET') { assert.equal(url.searchParams.get('key'), 'eq.private_digipay'); return json(row ? [row] : []); }
    if (request.method === 'POST') {
      if (row) return json({ code: '23505', message: 'synthetic duplicate' }, 409);
      row = body; return json({ updated_at: row.updated_at }, 201);
    }
    assert.equal(request.method, 'PATCH'); assert.equal(url.searchParams.get('key'), 'eq.private_digipay');
    assert.ok(url.searchParams.get('updated_at')?.startsWith('eq.'));
    const changed = row && url.searchParams.get('updated_at') === 'eq.' + row.updated_at;
    if (changed) row = { ...row, ...body };
    return json(changed ? [{ updated_at: row.updated_at }] : []);
  } } });
  return { database, calls, row: () => row, setRow: value => { row = value; } };
}
function req(method = 'GET', body, role = 'admin') { return { method, body, headers: { host: 'drman.vercel.app', origin: 'https://drman.vercel.app', 'sec-fetch-site': 'same-origin', cookie: role ? `${role === 'admin' ? 'drman_admin' : 'drman_session'}=${createToken({ sub: role, role })}` : '' } }; }
function res() { return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; } }; }
const rateLimit = async (_req, options) => { assert.ok(options.action.startsWith('admin_digipay_')); return { allowed: true }; };
function noSecrets(value) { const serialized = JSON.stringify(value); for (const secret of [...Object.values(credentials), token]) assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('ciphertext'), false); }

test('merchant AES-GCM is randomized, environment-bound and server-purpose separated', () => {
  const a = encryptDigiPayCredentials(credentials, 'production'), b = encryptDigiPayCredentials(credentials, 'production');
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext); assert.deepEqual(decryptDigiPayCredentials(a, 'production'), credentials);
  for (const bad of [{ ...a, tag: 'A'.repeat(22) }, { ...a, iv: a.iv + '=' }, { ...a, version: 2 }]) assert.throws(() => decryptDigiPayCredentials(bad, 'production'));
  assert.throws(() => decryptDigiPayCredentials(a, 'uat')); assert.throws(() => encryptDigiPayCredentials(credentials, 'toString'));
  const previous = process.env.SESSION_SECRET;
  try { process.env.SESSION_SECRET = 'different-server-only-secret-32-characters'; assert.throws(() => decryptDigiPayCredentials(a, 'production')); } finally { process.env.SESSION_SECRET = previous; }
});

test('actual PostgREST save stores ciphertext and returns booleans without credentials or ciphertext', async () => {
  const f = fixture(); const saved = await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
  assert.equal(saved.configured, true); assert.equal(saved.source, 'private'); noSecrets(saved);
  for (const secret of Object.values(credentials)) assert.equal(JSON.stringify(f.row()).includes(secret), false);
  assert.deepEqual((await readEffectiveDigiPaySettings(f.database)).credentials, credentials);
  const publicSettings = await readPublicDigiPaySettings(f.database); noSecrets(publicSettings);
  assert.deepEqual(publicSettings.fields, { client_id: true, client_secret: true, username: true, password: true });
  const call = f.calls.find(call => call.method === 'POST'); assert.equal(call.body.key, 'private_digipay'); assert.equal(call.url.searchParams.get('select'), 'updated_at');
});

test('first private entry requires all four fresh values even if legacy env is fully configured', async () => {
  const names = { DIGIPAY_CLIENT_ID: credentials.client_id, DIGIPAY_CLIENT_SECRET: credentials.client_secret, DIGIPAY_USERNAME: credentials.username, DIGIPAY_PASSWORD: credentials.password, DIGIPAY_BASE_URL: DIGIPAY_BASES.production };
  const previous = Object.fromEntries(Object.keys(names).map(name => [name, process.env[name]])); Object.assign(process.env, names);
  try {
    const f = fixture(); const old = await readPublicDigiPaySettings(f.database); assert.equal(old.source, 'environment'); assert.equal(old.configured, true);
    await assert.rejects(savePrivateDigiPaySettings({ environment: 'production', client_id: credentials.client_id, client_secret: credentials.client_secret }, f.database), { code: 'DIGIPAY_CREDENTIALS_REQUIRED' });
    assert.equal(f.row(), null);
  } finally { for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

test('subsequent blank fields preserve existing credentials; rotating one field uses compare-and-swap and clears auth result', async () => {
  const f = fixture(); await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
  const first = f.row(); await savePrivateDigiPaySettings({ environment: 'production', client_secret: '' }, f.database); assert.equal(f.row(), first);
  await recordDigiPayAuthCheck(await readEffectiveDigiPaySettings(f.database), 'OK', f.database);
  assert.equal((await readPublicDigiPaySettings(f.database)).last_auth_check.authenticated, true);
  await savePrivateDigiPaySettings({ environment: 'production', client_secret: 'new-synthetic-secret' }, f.database);
  const stored = await readEffectiveDigiPaySettings(f.database); assert.deepEqual(stored.credentials, { ...credentials, client_secret: 'new-synthetic-secret' }); assert.equal(stored.last_auth_check, null);
  await assert.rejects(savePrivateDigiPaySettings({ environment: 'uat' }, f.database), { code: 'DIGIPAY_ENVIRONMENT_CREDENTIALS_REQUIRED' });
});

test('a late auth result cannot overwrite newly rotated credentials', async () => {
  const f = fixture(); await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
  const before = await readEffectiveDigiPaySettings(f.database);
  await savePrivateDigiPaySettings({ environment: 'production', password: 'rotated-synthetic-password' }, f.database);
  await recordDigiPayAuthCheck(before, 'OK', f.database);
  const latest = await readEffectiveDigiPaySettings(f.database); assert.equal(latest.credentials.password, 'rotated-synthetic-password'); assert.equal(latest.last_auth_check, null);
});

test('invalid input, arbitrary URLs and missing encryption fail closed without writes', async () => {
  const f = fixture();
  for (const invalid of [{ ...credentials, environment: 'custom' }, { ...credentials, environment: 'toString' }, { ...credentials, environment: 'production', base_url: 'https://attacker.invalid' }, { ...credentials, environment: 'production', password: ['array'] }, { ...credentials, environment: 'production', username: 'line\nbreak' }]) await assert.rejects(savePrivateDigiPaySettings(invalid, f.database), { status: 400 });
  assert.equal(f.row(), null);
  const previous = process.env.SESSION_SECRET; try { delete process.env.SESSION_SECRET; await assert.rejects(savePrivateDigiPaySettings({ ...credentials, environment: 'production' }, f.database), { code: 'DIGIPAY_ENCRYPTION_UNAVAILABLE' }); assert.equal(f.row(), null); } finally { process.env.SESSION_SECRET = previous; }
});

test('no admin cookie or ordinary user cookie is denied before DB, limiter or network', async () => {
  const db = { from() { throw new Error('unauthorized database call'); } }, limit = () => { throw new Error('unauthorized limiter'); };
  const settings = createAdminDigiPaySettingsHandler({ database: db, rateLimit: limit }), check = createAdminDigiPayTestHandler({ database: db, rateLimit: limit });
  for (const role of [null, 'user']) for (const method of ['GET', 'PUT']) { const result = res(); await settings(req(method, credentials, role), result); assert.equal(result.statusCode, 401); }
  for (const role of [null, 'user']) { const result = res(); await check(req('POST', {}, role), result); assert.equal(result.statusCode, 401); }
});

test('owner credential save/get and audit never return plaintext or stored encrypted envelope', async () => {
  const f = fixture(), handler = createAdminDigiPaySettingsHandler({ database: f.database, rateLimit });
  let result = res(); await handler(req('PUT', { environment: 'production', ...credentials }), result);
  assert.equal(result.statusCode, 200); noSecrets(result.body);
  const audit = f.calls.find(call => call.url.pathname.endsWith('/audit_logs')); noSecrets(audit.body); assert.equal(audit.body.metadata.environment, 'production');
  result = res(); await handler(req('GET'), result); assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store'); noSecrets(result.body);
});

test('mutations reject cross-origin, missing-origin and rate denials before secret reads', async () => {
  let reads = 0; const database = { from() { reads++; throw Error('unexpected database read'); } };
  for (const makeHandler of [createAdminDigiPaySettingsHandler, createAdminDigiPayTestHandler]) {
    const handler = makeHandler({ database, rateLimit });
    for (const origin of [null, 'https://attacker.invalid']) { const request = req(makeHandler === createAdminDigiPaySettingsHandler ? 'PUT' : 'POST', {}); if (origin) request.headers.origin = origin; else delete request.headers.origin; const result = res(); await handler(request, result); assert.equal(result.statusCode, 403); }
    const denied = makeHandler({ database, rateLimit: async () => ({ allowed: false, retry_after_seconds: 300 }) }), result = res();
    await denied(req(makeHandler === createAdminDigiPaySettingsHandler ? 'PUT' : 'POST', {}), result); assert.equal(result.statusCode, 429); assert.equal(result.headers['Retry-After'], '300');
  }
  assert.equal(reads, 0);
});

test('explicit connection test calls only OAuth and never exposes token or accepts client-provided endpoint/credentials', async t => {
  const f = fixture(); await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options }); assert.equal(input, DIGIPAY_BASES.production + '/oauth/token'); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(credentials.client_id + ':' + credentials.client_secret).toString('base64'));
    assert.deepEqual(Object.fromEntries(options.body), { username: credentials.username, password: credentials.password, grant_type: 'password' });
    return json({ access_token: token });
  };
  const handler = createAdminDigiPayTestHandler({ database: f.database, rateLimit });
  const result = res(); await handler(req('POST', { baseUrl: 'https://attacker.invalid', credentials: { password: 'wrong' } }), result);
  assert.equal(result.statusCode, 200); assert.equal(result.body.authenticated, true); assert.equal(calls.length, 1); noSecrets(result.body);
  assert.equal((await readPublicDigiPaySettings(f.database)).last_auth_check.authenticated, true);
  noSecrets(f.calls.find(call => call.url.pathname.endsWith('/audit_logs')).body);
});

test('OAuth failures return safe technical wording without echoing provider response and never sign out owner on provider401', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const [status, code] of [[401, 'DIGIPAY_AUTH_FAILED'], [403, 'DIGIPAY_AUTH_FAILED'], [429, 'DIGIPAY_RATE_LIMIT'], [503, 'DIGIPAY_UNAVAILABLE']]) {
    const f = fixture(); await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
    globalThis.fetch = async () => json({ error: credentials.password }, status);
    const handler = createAdminDigiPayTestHandler({ database: f.database, rateLimit }), result = res(); await handler(req('POST', {}), result);
    assert.equal(result.statusCode, 502); assert.equal(result.body.code, code); assert.equal(result.body.authenticated, false); noSecrets(result.body); assert.equal((await readPublicDigiPaySettings(f.database)).last_auth_check.authenticated, false);
  }
});

test('token request refuses unallowlisted host before any network call', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); globalThis.fetch = () => { throw Error('must not call fetch'); };
  for (const baseUrl of ['https://api.mydigipay.com.evil.invalid/digipay/api', DIGIPAY_BASES.production + '?redirect=1', 'http://api.mydigipay.com/digipay/api']) await assert.rejects(requestDigiPayToken({ credentials, baseUrl }), { message: 'DIGIPAY_NOT_CONFIGURED' });
});

test('checkout uses encrypted merchant credentials when all legacy credential variables are absent', async t => {
  const id = '11111111-1111-4111-8111-111111111111', planId = '22222222-2222-4222-8222-222222222222', paymentId = '33333333-3333-4333-8333-333333333333';
  const f = fixture(null, ({ request, url }) => {
    const single = request.headers.get('accept')?.includes('vnd.pgrst.object');
    if (url.pathname.endsWith('/users')) { const user = { id, status: 'active', session_version: 0, phone: '09000000000' }; return json(single ? user : [user]); }
    if (url.pathname.endsWith('/plans')) return json({ id: planId, active: true, name: 'Synthetic plan', slug: 'synthetic', price: 1000, duration_days: 30 });
    assert.equal(url.pathname, '/rest/v1/payments');
    return request.method === 'POST' ? json({ id: paymentId }, 201) : json(null);
  });
  await savePrivateDigiPaySettings({ environment: 'production', ...credentials }, f.database);
  const oldFrom = supabase.from, oldFetch = globalThis.fetch;
  const envNames = ['DIGIPAY_CLIENT_ID', 'DIGIPAY_CLIENT_SECRET', 'DIGIPAY_USERNAME', 'DIGIPAY_PASSWORD'];
  const oldEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  t.after(() => { supabase.from = oldFrom; globalThis.fetch = oldFetch; for (const [name, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  for (const name of envNames) delete process.env[name];
  supabase.from = f.database.from.bind(f.database);
  const gateway = [];
  globalThis.fetch = async (url, options) => {
    gateway.push(url); assert.equal(options.redirect, 'error');
    if (url === DIGIPAY_BASES.production + '/oauth/token') { assert.equal(options.body.get('username'), credentials.username); return json({ access_token: token }); }
    assert.equal(url, DIGIPAY_BASES.production + '/tickets/business?type=11');
    assert.equal(options.headers.Authorization, 'Bearer ' + token); const payload = JSON.parse(options.body); assert.equal(payload.providerId, paymentId); assert.equal(payload.amount, 10000);
    return json({ result: { status: 0 }, redirectUrl: 'https://app.mydigipay.com/synthetic-checkout', ticket: 'synthetic-ticket' });
  };
  const request = req('POST', { plan_id: planId }, 'user'); request.headers.cookie = `drman_session=${createToken({ sub: id, role: 'user', ver: 0 })}`;
  const result = res(); await paymentStart(request, result);
  assert.equal(result.statusCode, 200); assert.equal(result.body.payment_id, paymentId); assert.equal(gateway.length, 2); noSecrets(result.body);
});

test('new router registrations enforce same origin before handler or request parsing', async () => {
  for (const route of ['admin-digipay-settings', 'admin-digipay-test']) {
    const request = req(route.endsWith('settings') ? 'PUT' : 'POST', {}); request.query = { route }; request.headers.origin = 'https://attacker.invalid';
    const result = res(); await router(request, result); assert.equal(result.statusCode, 403);
  }
});

test('generic settings defensively exclude private DigiPay row even with unexpected database output', async t => {
  const previous = supabase.from; t.after(() => { supabase.from = previous; });
  supabase.from = () => ({ select() { return this; }, in(_field, keys) { assert.deepEqual(keys, ['general', 'seo', 'features']); return this; }, order: async () => ({ data: [{ key: 'general', value: { site_name: 'DrMan' } }, { key: 'private_digipay', value: credentials }] }) });
  const result = res(); await genericSettings(req(), result); assert.equal(result.statusCode, 200); assert.equal(result.body.settings.private_digipay, undefined); noSecrets(result.body);
});
