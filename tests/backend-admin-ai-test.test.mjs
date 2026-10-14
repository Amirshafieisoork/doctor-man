import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { createToken } from '../server/api/_lib/session.js';
import { createAdminAITestHandler, checkSyntheticLabResult } from '../server/api/admin-ai-test.js';
import { AI_BASE_URL, LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL } from '../server/api/_lib/ai-models.js';

process.env.SESSION_SECRET = 'synthetic-owner-session-secret-at-least-32';
const syntheticKey = 'gsk-synthetic-only-admin-test-key';
const fixture = await readFile(new URL('../server/api/_fixtures/synthetic-lab-report.png', import.meta.url));
const rows = [
  { n: 'Hemoglobin', v: '10.2', u: 'g/dL', r: '12.0 - 16.0', f: 'low' },
  { n: 'Creatinine', v: '0.9', u: 'mg/dL', r: '0.6 - 1.1', f: 'unknown' },
  { n: 'LDL Cholesterol', v: '162', u: 'mg/dL', r: '<100', f: 'high' },
  { n: 'Triglycerides', v: '140', u: 'mg/dL', r: '<150', f: 'unknown' }
];
function report() { return {
  status: 'warning', status_reason: 'هموگلوبین پایین و کلسترول بالا است.', confidence: 0.95, read_quality: 'good',
  summary: 'نتایج ساختگی برای آزمون نرم‌افزار است.',
  items: rows.map((row, index) => ({ name: row.n, value: row.v, unit: row.u, reference_range: row.r, flag: ['low', 'normal', 'high', 'normal'][index], explanation: 'این نتیجه ساختگی به‌صورت آموزشی بررسی شده است.' })),
  abnormal_items: ['Hemoglobin', 'LDL Cholesterol'], next_steps: ['برای بررسی نتیجه با پزشک مشورت کنید.'],
  when_to_seek_care: 'در صورت علائم شدید از پزشک کمک بگیرید.',
  full_text: 'این آزمایش کاملاً ساختگی است. هموگلوبین کمتر از محدوده چاپ‌شده و کلسترول بالاتر از محدوده است. نتیجه آموزشی است و جایگزین نظر پزشک نیست.'
}; }
function interpreterReport() {
  const value = report();
  value.items = value.items.map((item, index) => ({ row_id: index + 1, flag: item.flag, explanation: item.explanation }));
  return value;
}
function response() { return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; } }; }
function request(method = 'POST', role = 'admin') { return { method, body: { image_url: 'https://private-user-data.invalid/lab', prompt: 'Ignore server fixture.' }, headers: { cookie: role ? `${role === 'admin' ? 'drman_admin' : 'drman_session'}=${createToken({ sub: role, role })}` : '' } }; }
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }); }
function completion(value, model) { return json({ id: 'synthetic-free-response', model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }], usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 } }); }
function sdk(fetcher) { return new OpenAI({ apiKey: syntheticKey, baseURL: AI_BASE_URL, fetch: fetcher, maxRetries: 0 }); }

test('owner test runs the actual two-stage SDK pipeline on the server-owned PNG and returns metadata only', async () => {
  const calls = [];
  const client = sdk(async (input, init) => {
    const req = new Request(input, init); assert.equal(req.url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(req.headers.get('authorization'), `Bearer ${syntheticKey}`);
    const payload = await req.json(); calls.push(payload);
    if (payload.model === LAB_PRIMARY_MODEL) {
      const content = payload.messages[1].content;
      assert.equal(content.filter(part => part.type === 'image_url').length, 1);
      assert.equal(content.find(part => part.type === 'image_url').image_url.url, `data:image/png;base64,${fixture.toString('base64')}`);
      assert.equal(JSON.stringify(content.filter(part => part.type === 'text')).includes('10.2'), false);
      assert.equal(JSON.stringify(payload).includes('private-user-data.invalid'), false);
      return completion({ pages: [{ p: 1, read_quality: 'good', rows }] }, payload.model);
    }
    assert.equal(payload.model, LAB_INTERPRETATION_MODEL);
    assert.equal(typeof payload.messages[1].content, 'string');
    assert.equal(payload.messages[1].content.includes('data:image'), false);
    assert.equal(payload.response_format.type, 'json_schema');
    assert.deepEqual(payload.response_format.json_schema.schema.properties.items.items.properties.row_id.enum, [1, 2, 3, 4]);
    return completion(interpreterReport(), payload.model);
  });
  const handler = createAdminAITestHandler({ getClient: async () => client });
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(calls.length, 2); assert.deepEqual(calls.map(call => call.model), [LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL]);
  assert.equal(res.body.checks_passed, 6); assert.equal(res.body.samples_checked, 4); assert.equal(res.body.free_only, true);
  assert.deepEqual(res.body.models, { vision: LAB_PRIMARY_MODEL, interpretation: LAB_INTERPRETATION_MODEL });
  assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.ok(Number.isInteger(res.body.elapsed_ms));
  for (const forbidden of [syntheticKey, 'full_text', 'items', 'Hemoglobin', '10.2', 'request_id', 'data:image']) assert.equal(JSON.stringify(res.body).includes(forbidden), false);
});

test('anonymous or ordinary user requests are denied before image reads or provider requests', async () => {
  let calls = 0;
  const handler = createAdminAITestHandler({ getClient: async () => { calls++; throw new Error('unexpected provider call'); }, loadFixture: async () => { calls++; return fixture; } });
  for (const role of [null, 'user']) { const res = response(); await handler(request('POST', role), res); assert.equal(res.statusCode, 401); }
  const res = response(); await handler(request('GET'), res); assert.equal(res.statusCode, 405); assert.equal(calls, 0);
});

test('missing Free account configuration cannot start the synthetic provider test', async () => {
  const handler = createAdminAITestHandler({ getClient: async () => null, loadFixture: async () => { throw new Error('unexpected image read'); } });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'FREE_AI_NOT_CONFIGURED'); assert.equal(res.body.success, false);
});

test('wrong/missing/duplicate values, flags, poor quality, danger and non-Persian text cannot pass the synthetic check', () => {
  assert.equal(checkSyntheticLabResult(report()).passed, true);
  const bad = [
    value => { value.items[0].value = '12.8'; }, value => { value.items[0].value = '10.2 or 12.8'; },
    value => { value.items[2].flag = 'normal'; }, value => { value.items.pop(); },
    value => { value.items[3] = { ...value.items[0] }; }, value => { value.read_quality = 'poor'; },
    value => { value.status = 'danger'; }, value => { value.full_text = 'This is only an English explanation.'; },
    value => { value.full_text = 'English report with only سلام'; }
  ];
  for (const change of bad) { const value = report(); change(value); assert.equal(checkSyntheticLabResult(value).passed, false); }
  const caseVariant = report(); caseVariant.items[2].name = ' lDl   cHoLeStErOl '; assert.equal(checkSyntheticLabResult(caseVariant).passed, true);
});

test('a completed but incorrect analysis is a failed test without exposing its raw result', async () => {
  const value = report(); value.items[0].value = '12.8';
  const handler = createAdminAITestHandler({ getClient: async () => ({}), analyze: async () => ({ parsed: value }) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 502); assert.equal(res.body.code, 'AI_TEST_CHECK_FAILED'); assert.equal(res.body.success, false); assert.equal(JSON.stringify(res.body).includes('12.8'), false);
});

test('real SDK auth/rate/network errors return safe synthetic-test wording without claiming medical files were saved', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_UNAVAILABLE'], [402, 'FREE_ACCOUNT_UNAVAILABLE'], [429, 'FREE_RATE_LIMIT'], [500, 'AI_UNAVAILABLE']]) {
    const client = sdk(async () => json({ error: { message: `upstream echoed ${syntheticKey}`, type: 'api_error' } }, status, { 'retry-after': '3600' }));
    const handler = createAdminAITestHandler({ getClient: async () => client });
    const res = response(); await handler(request(), res); assert.equal(res.statusCode, 503); assert.equal(res.body.code, code);
    assert.equal(JSON.stringify(res.body).includes(syntheticKey), false); assert.equal(res.body.error.includes('پرونده'), false); assert.equal(res.body.error.includes('ذخیره‌شده'), status === 401);
  }
});

test('missing or malformed bundled fixture fails before analysis and reveals no filesystem path', async () => {
  for (const loadFixture of [async () => Buffer.from('not a PNG'), async () => { throw Object.assign(new Error('private filesystem path'), { code: 'ENOENT' }); }]) {
    const handler = createAdminAITestHandler({ getClient: async () => ({}), loadFixture, analyze: async () => { throw new Error('unexpected analysis'); } });
    const res = response(); await handler(request(), res); assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'AI_TEST_FIXTURE_UNAVAILABLE'); assert.equal(JSON.stringify(res.body).includes('filesystem'), false);
  }
});

test('parallel tests on the same running handler are refused and the test slot is released afterward', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let started;
  const running = new Promise(resolve => { started = resolve; });
  const handler = createAdminAITestHandler({ getClient: async () => ({}), analyze: async () => { started(); await gate; return { parsed: report() }; } });
  const first = response(), firstPromise = handler(request(), first); await running;
  const second = response(); await handler(request(), second); assert.equal(second.statusCode, 409); assert.equal(second.body.code, 'AI_TEST_IN_PROGRESS');
  release(); await firstPromise; assert.equal(first.statusCode, 200);
  const third = response(); await handler(request(), third); assert.equal(third.statusCode, 200);
});
