import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAB_QUOTA_RESERVATION_TTL_SECONDS,
  reserveLabAnalysisQuota,
  releaseLabAnalysisQuota
} from '../server/api/_lib/ai-quota.js';

const userId = '11111111-1111-4111-8111-111111111111';
const reservationId = '22222222-2222-4222-8222-222222222222';
const expiresAt = new Date(Date.now() + 3600000).toISOString();
const reservedAt = new Date().toISOString();
const grant = remaining => ({
  allowed: true, reservation_id: reservationId, remaining, expires_at: expiresAt,
  reserved_at: reservedAt
});

test('last quota slot is reserved before the model request and leaves zero remaining', async () => {
  const calls = [];
  const db = { rpc: async (...args) => {
    calls.push(args);
    return { data: [grant(0)], error: null };
  } };
  assert.deepEqual(await reserveLabAnalysisQuota(db, userId, { limit: 2 }), {
    reservationId, remaining: 0, expiresAt, reservedAt
  });
  assert.deepEqual(calls, [[ 'reserve_lab_analysis_quota', {
    p_user_id: userId, p_limit: 2, p_ttl_seconds: LAB_QUOTA_RESERVATION_TTL_SECONDS
  } ]]);
});

test('atomic RPC quota refusal produces the existing quota-exceeded error', async () => {
  const db = { rpc: async () => ({ data: [{
    allowed: false, reservation_id: null, remaining: 0, expires_at: null,
    reserved_at: null
  }] }) };
  await assert.rejects(reserveLabAnalysisQuota(db, userId, { limit: 2 }),
    { message: 'QUOTA_EXCEEDED' });
});

test('negative limits cannot turn a plan into unlimited paid analysis', async () => {
  const db = { rpc: async () => assert.fail('negative quota must never query the database') };
  await assert.rejects(reserveLabAnalysisQuota(db, userId, { limit: -1 }),
    { message: 'INVALID_QUOTA_INPUT' });
});

test('database and transport failures deny access to paid analysis', async () => {
  const failure = new Error('database unavailable');
  for (const db of [
    { rpc: async () => ({ data: null, error: failure }) },
    { rpc: async () => { throw failure; } }
  ]) {
    await assert.rejects(reserveLabAnalysisQuota(db, userId, { limit: 2 }),
      error => error.message === 'QUOTA_UNAVAILABLE' && error.cause === failure);
  }
});

test('empty, malformed, ambiguous and expired responses fail closed', async () => {
  for (const data of [
    null, [], [grant(0), grant(0)], [{ ...grant(0), allowed: undefined }],
    [{ ...grant(0), reservation_id: null }],
    [{ ...grant(0), expires_at: 'invalid date' }],
    [{ ...grant(0), expires_at: '2000-01-01T00:00:00Z' }],
    [{ ...grant(0), reserved_at: null }],
    [{ ...grant(0), reserved_at: expiresAt }],
    [grant(-1)], [grant(2)], [grant(null)], [grant('0')],
    [{ allowed: false, reservation_id: null, remaining: 1, expires_at: null }]
  ]) {
    const db = { rpc: async () => ({ data }) };
    await assert.rejects(reserveLabAnalysisQuota(db, userId, { limit: 2 }),
      { message: 'QUOTA_UNAVAILABLE' });
  }
});

test('invalid limits, TTLs and user IDs are rejected before contacting the database', async () => {
  let calls = 0;
  const db = { rpc: async () => { calls++; } };
  for (const [id, options] of [
    ['not-a-uuid', { limit: 2 }], [null, { limit: 2 }], [userId, undefined],
    [userId, { limit: -2 }], [userId, { limit: 100001 }],
    [userId, { limit: 1.5 }], [userId, { limit: '2' }],
    [userId, { limit: 2, ttlSeconds: 59 }],
    [userId, { limit: 2, ttlSeconds: 3601 }],
    [userId, { limit: 2, ttlSeconds: 90.5 }]
  ]) {
    await assert.rejects(reserveLabAnalysisQuota(db, id, options),
      { message: 'INVALID_QUOTA_INPUT' });
  }
  assert.equal(calls, 0);
});

test('lease release scopes the delete to both the reservation and owning user', async () => {
  const operations = [];
  const builder = {
    delete() { operations.push(['delete']); return this; },
    eq(...args) { operations.push(['eq', ...args]); return this; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); }
  };
  const db = { from: table => { operations.push(['from', table]); return builder; } };
  await releaseLabAnalysisQuota(db, userId, reservationId);
  assert.deepEqual(operations, [
    ['from', 'ai_analysis_reservations'], ['delete'],
    ['eq', 'user_id', userId], ['eq', 'id', reservationId]
  ]);
});

test('cleanup failures are explicit while the bounded lease remains safe to expire', async () => {
  const failure = new Error('release unavailable');
  const builder = {
    delete() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ error: failure }).then(resolve); }
  };
  await assert.rejects(releaseLabAnalysisQuota({ from: () => builder }, userId, reservationId),
    error => error.message === 'QUOTA_RELEASE_FAILED' && error.cause === failure);
});

test('cleanup rejects invalid ownership identifiers without querying the database', async () => {
  const db = { from: () => assert.fail('invalid input must not reach the database') };
  await assert.rejects(releaseLabAnalysisQuota(db, userId, 'invalid'),
    { message: 'INVALID_QUOTA_INPUT' });
  await assert.rejects(releaseLabAnalysisQuota(db, 'invalid', reservationId),
    { message: 'INVALID_QUOTA_INPUT' });
});
