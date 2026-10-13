import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getUserSession, getAdminSession } from '../server/api/_lib/session.js';

// Use the installed SDK's query builders and fake HTTP responses. A handmade
// builder with an invented .catch method would miss the authentication bug.
process.env.SUPABASE_URL = 'https://auth-flow-tests.invalid';
process.env.SUPABASE_SECRET_KEY = 'test-only-database-key';
process.env.SESSION_SECRET = 'test-only-session-secret-32-characters';
process.env.ADMIN_PASSWORD = 'test-only-admin-password';
const { supabase } = await import('../server/api/_lib/db.js');
const { default: router } = await import('../api/router.js');
const { allowRate } = await import('../server/api/_lib/rate-limit.js');
const userId = '11111111-1111-4111-8111-111111111111';
const phone = '09123456789', password = 'test-only-user-password';
const salt = 'test-only-salt';
const passwordHash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function response() {
  return { statusCode: 200, headers: {}, sent: 0,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.sent++; assert.equal(this.sent, 1); this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; }, getHeader(key) { return this.headers[key]; }
  };
}
function database(t, { recordingFailure = '', reserveFailure = false, countFailure = false, count = 0, rateEvents, expiryFailure = '', expiryValue } = {}) {
  const calls = [];
  const client = createClient('https://auth-flow-tests.invalid', 'test-only-client-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { async fetch(input, init) {
      const req = new Request(input, init), url = new URL(req.url);
      assert.equal(url.origin, 'https://auth-flow-tests.invalid');
      const table = url.pathname.split('/').at(-1), body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.json();
      calls.push({ table, method: req.method, body, query: url.searchParams });
      if (table === 'auth_rate_events') {
        if (req.method === 'HEAD') return new Response(null, { status: countFailure ? 500 : 200, headers: { 'Content-Range': `*/${count}` } });
        if (req.method === 'GET') {
          if (expiryFailure === 'http') return json({ code: 'TEST_EXPIRY_FAILURE', message: 'private expiry error' }, 500);
          if (expiryFailure === 'transport') throw new TypeError('private expiry transport error');
          if (expiryValue !== undefined) return json(expiryValue);
          const events = rateEvents || Array.from({ length: count }, (_, i) => ({ created_at: new Date(Date.now() - 60000 - i * 1000).toISOString() }));
          const ordered = [...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || ordered.length);
          return json(ordered.slice(offset, offset + limit));
        }
        if (req.method === 'POST') return reserveFailure ? json({ code: 'TEST_RESERVATION_FAILURE', message: 'private reservation error' }, 503) : json({ id: 'reserved-attempt' }, 201);
        if (req.method === 'PATCH') {
          if (recordingFailure === 'http') return json({ code: 'TEST_RECORD_FAILURE', message: 'private recording error' }, 500);
          if (recordingFailure === 'transport') throw new TypeError('private transport error');
          return new Response(null, { status: 204 });
        }
      }
      if (table === 'app_settings') return json([{ value: { registration_enabled: true } }]);
      if (table === 'plans') return json([{ id: 'free-plan', duration_days: 30 }]);
      if (table === 'users') {
        if (req.method === 'GET') return json(url.searchParams.get('select')?.includes('password')
          ? [{ id: userId, phone, name: 'کاربر آزمایشی', status: 'active', password: passwordHash }] : []);
        if (req.method === 'POST') return json({ id: userId, phone, name: 'کاربر آزمایشی' }, 201);
      }
      throw new Error(`Unexpected fake request: ${req.method} ${table}`);
    } }
  });
  const original = supabase.from;
  supabase.from = client.from.bind(client);
  t.after(() => { supabase.from = original; });
  return { calls, client };
}
async function authenticate(route, overrides = {}) {
  const res = response();
  await router({ method: 'POST', query: { route },
    headers: { host: 'drman.vercel.app', origin: 'https://drman.vercel.app' },
    body: { ...(route === 'admin-login' ? { password: process.env.ADMIN_PASSWORD } : { phone, password, name: 'کاربر آزمایشی' }), ...overrides }
  }, res);
  return res;
}
function assertAuthenticated(res, route) {
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true); assert.equal(res.sent, 1);
  const cookie = res.headers['Set-Cookie'];
  assert.match(cookie, /HttpOnly; SameSite=Lax/);
  const req = { headers: { cookie } };
  if (route === 'admin-login') {
    assert.equal(getAdminSession(req)?.role, 'admin'); assert.equal(getUserSession(req), null);
  } else {
    assert.equal(getUserSession(req)?.sub, userId); assert.equal(getAdminSession(req), null);
    assert.equal(res.body.user.password, undefined);
  }
}
function assertAttemptRecorded(calls, action) {
  const reservation = calls.find(call => call.table === 'auth_rate_events' && call.method === 'POST');
  const record = calls.find(call => call.table === 'auth_rate_events' && call.method === 'PATCH');
  assert.equal(reservation.body.action, action); assert.equal(reservation.body.success, false);
  assert.match(reservation.body.key_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.body, { success: true });
  assert.equal(record.query.get('id'), 'eq.reserved-attempt');
  assert.equal(record.query.get('key_hash'), `eq.${reservation.body.key_hash}`);
  assert.equal(record.query.get('action'), `eq.${action}`);
  assert.ok(calls.indexOf(record) > calls.indexOf(reservation));
  assert.equal(calls.some(call => call.table === 'auth_rate_events' && call.method === 'GET'), false, 'allowed attempts do not need an expiry lookup');
}
function freezeTime(t) {
  const now = Date.parse('2026-10-13T11:00:00.000Z'), original = Date.now;
  Date.now = () => now;
  t.after(() => { Date.now = original; });
  return now;
}

test('authentication regression exercises actual Supabase thenables without a catch method', t => {
  const { client } = database(t);
  const builder = client.from('auth_rate_events').update({ success: true }).eq('id', 'attempt');
  assert.equal(typeof builder.then, 'function'); assert.equal(typeof builder.catch, 'undefined');
});

for (const route of ['register', 'login', 'admin-login']) {
  test(`${route} records success and issues a valid session with the real Supabase SDK`, async t => {
    const { calls } = database(t);
    const res = await authenticate(route);
    assertAuthenticated(res, route); assertAttemptRecorded(calls, route);
    if (route === 'register') {
      const insertion = calls.find(call => call.table === 'users' && call.method === 'POST');
      assert.match(insertion.body[0].password, /^scrypt\$/);
      assert.equal(insertion.body[0].phone, phone);
    }
  });

  for (const recordingFailure of ['http', 'transport']) {
    test(`${route} still issues a session if success bookkeeping has a ${recordingFailure} failure`, async t => {
      const { calls } = database(t, { recordingFailure });
      const res = await authenticate(route);
      assertAuthenticated(res, route); assertAttemptRecorded(calls, route);
      assert.doesNotMatch(JSON.stringify(res.body), /private|TEST_RECORD_FAILURE/);
    });
  }

  test(`${route} refuses authentication if the attempt cannot be reserved`, async t => {
    const { calls } = database(t, { reserveFailure: true });
    const res = await authenticate(route);
    assert.equal(res.statusCode, 503); assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(calls.some(call => call.table === 'users'), false);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  });

  test(`${route} preserves rate-limit denial before credentials or session issuance`, async t => {
    const { calls } = database(t, { count: 10 });
    const res = await authenticate(route);
    assert.equal(res.statusCode, 429); assert.equal(res.headers['Set-Cookie'], undefined);
    assert.ok(Number(res.headers['Retry-After']) > 0);
    assert.equal(calls.length, 2); assert.equal(calls[0].method, 'HEAD'); assert.equal(calls[1].method, 'GET');
    const limit = route === 'login' ? 8 : 5;
    assert.equal(calls[1].query.get('offset'), String(limit - 1)); assert.equal(calls[1].query.get('limit'), '1');
    for (const key of ['key_hash', 'action', 'created_at']) assert.equal(calls[1].query.get(key), calls[0].query.get(key));
    assert.equal(calls[1].query.get('order'), 'created_at.desc');
    assert.equal(calls[0].query.has('success'), false); assert.equal(calls[1].query.has('success'), false);
  });

  for (const secret of [undefined, 'short-session-key']) {
    test(`${route} refuses an ${secret === undefined ? 'absent' : 'undersized'} proxy session secret before any database request`, async t => {
      const { calls } = database(t);
      const keys = ['SESSION_SECRET', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
      const previous = new Map(keys.map(key => [key, process.env[key]]));
      t.after(() => {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
      for (const key of keys) delete process.env[key];
      if (secret !== undefined) process.env.SESSION_SECRET = secret;
      const res = await authenticate(route);
      assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'SERVICE_NOT_CONFIGURED');
      assert.equal(res.headers['Set-Cookie'], undefined); assert.equal(res.sent, 1);
      assert.equal(calls.length, 0, 'no account or rate attempt can be written without a usable session');
    });
  }
}

for (const route of ['register', 'login']) {
  for (const input of ['۰۹۱۲۳۴۵۶۷۸۹', '٠٩١٢٣٤٥٦٧٨٩', '+989123456789', '00989123456789', '989123456789', '9123456789', '+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹', '\u200e۰۹۱۲ ۳۴۵ ۶۷۸۹\u200f']) {
    test(`${route} uses the canonical Iranian mobile number for input ${JSON.stringify(input)}`, async t => {
      const { calls } = database(t);
      const res = await authenticate(route, { phone: input });
      assertAuthenticated(res, route); assertAttemptRecorded(calls, route);
      const lookups = calls.filter(call => call.table === 'users' && call.method === 'GET');
      assert.ok(lookups.length > 0); assert.ok(lookups.every(call => call.query.get('phone') === `eq.${phone}`));
      const reservation = calls.find(call => call.table === 'auth_rate_events' && call.method === 'POST');
      const expectedKey = crypto.createHash('sha256').update(`${route}|unknown|${phone}`).digest('hex');
      assert.equal(reservation.body.key_hash, expectedKey, 'alternate formatting must not create a separate rate-limit key');
      if (route === 'register') {
        assert.equal(calls.find(call => call.table === 'users' && call.method === 'POST').body[0].phone, phone);
      }
    });
  }
}

for (const route of ['login', 'admin-login']) {
  test(`${route} reserves an unsuccessful credential attempt without issuing a session or recording success`, async t => {
    const { calls } = database(t);
    const res = await authenticate(route, { password: 'wrong-test-password' });
    assert.equal(res.statusCode, 401); assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(calls.find(call => call.table === 'auth_rate_events' && call.method === 'POST').body.success, false);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  });
}

test('over-limit retry waits for the fifth-newest expiry rather than the oldest event', async t => {
  const now = freezeTime(t);
  const rateEvents = [29, 28, 27, 20, 15, 10, 5].map(minutes => ({ created_at: new Date(now - minutes * 60000).toISOString() }));
  const { calls } = database(t, { count: 7, rateEvents });
  const gate = await allowRate({ headers: {} }, { action: 'admin-login', subject: 'admin', limit: 5, windowMinutes: 30 });
  assert.equal(gate.allowed, false); assert.equal(gate.retry_after_seconds, 181);
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'GET']);
  const query = calls[1].query;
  assert.equal(query.get('offset'), '4'); assert.equal(query.get('limit'), '1');
  assert.equal(query.get('order'), 'created_at.desc');
  for (const key of ['key_hash', 'action', 'created_at']) assert.equal(query.get(key), calls[0].query.get(key));
});

test('a rate event exactly on the inclusive boundary returns a one-second retry without admission', async t => {
  const now = freezeTime(t);
  const { calls } = database(t, { count: 5, rateEvents: Array.from({ length: 5 }, () => ({ created_at: new Date(now - 1800000).toISOString() })) });
  const gate = await allowRate({ headers: {} }, { action: 'admin-login', subject: 'admin', limit: 5, windowMinutes: 30 });
  assert.equal(gate.allowed, false); assert.equal(gate.retry_after_seconds, 1);
  assert.equal(calls.some(call => call.method === 'POST'), false);
});

test('retry duration is capped at the full window for newly reserved events', async t => {
  const now = freezeTime(t);
  database(t, { count: 5, rateEvents: Array.from({ length: 5 }, () => ({ created_at: new Date(now).toISOString() })) });
  const gate = await allowRate({ headers: {} }, { action: 'admin-login', subject: 'admin', limit: 5, windowMinutes: 30 });
  assert.equal(gate.allowed, false); assert.equal(gate.retry_after_seconds, 1800);
});

for (const scenario of ['http', 'transport', 'missing', 'invalid', 'future', 'outside-window']) {
  test(`an ${scenario} expiry lookup preserves denial with a conservative full-window retry`, async t => {
    const now = freezeTime(t);
    const options = { count: 5 };
    if (scenario === 'http' || scenario === 'transport') options.expiryFailure = scenario;
    else options.expiryValue = scenario === 'missing' ? [] : [{ created_at: scenario === 'invalid'
      ? 'invalid timestamp' : new Date(now + (scenario === 'future' ? 1000 : -1801000)).toISOString() }];
    const { calls } = database(t, options);
    const res = await authenticate('admin-login');
    assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '1800');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(calls[0].method, 'HEAD');
    assert.ok(calls.length >= 2);
    assert.ok(calls.slice(1).every(call => call.table === 'auth_rate_events' && call.method === 'GET'), 'SDK transport retries must not reach credentials or reserve more attempts');
    assert.doesNotMatch(JSON.stringify(res.body), /private|TEST_EXPIRY_FAILURE/);
  });
}

test('an unavailable count remains fail-closed without reserving an attempt or consulting expiry', async t => {
  const { calls } = database(t, { countFailure: true });
  const gate = await allowRate({ headers: {} }, { action: 'admin-login', subject: 'admin', limit: 5, windowMinutes: 30 });
  assert.equal(gate.allowed, false); assert.equal(gate.unavailable, true);
  assert.deepEqual(calls.map(call => call.method), ['HEAD']);
});
