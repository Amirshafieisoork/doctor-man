import test from 'node:test';
import assert from 'node:assert/strict';
import { callLabModel, parseLabCompletion, labErrorResponse } from '../server/api/_lib/lab-ai.js';

// Complete synthetic reports and in-memory clients: no private image, provider
// request, user quota or production database is used by these tests.
function report(overrides = {}) {
  return {
    status: 'normal', status_reason: 'در محدوده مرجع', confidence: .91,
    read_quality: 'good', summary: 'نتیجه خوانا است',
    items: [{ name: 'Glucose', value: '90', unit: 'mg/dL', reference_range: '70-100', flag: 'normal', explanation: 'در محدوده مرجع چاپ‌شده' }],
    abnormal_items: [], next_steps: ['نتیجه را با پزشک خود مرور کنید.'],
    when_to_seek_care: 'در صورت علائم شدید مراجعه کنید.', full_text: 'خلاصه آموزشی آزمایش: قند خون در محدوده چاپ‌شده است.',
    ...overrides
  };
}
function completion(value = report(), extra = {}) {
  return { model: 'openai/gpt-oss-120b', _request_id: 'synthetic-request',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], ...extra };
}
function client(create) { return { chat: { completions: { create } } }; }
function providerError(status, message = 'private-provider-content') {
  return Object.assign(new Error(message), { name: 'APIError', status });
}
const content = [{ type: 'text', text: 'سن: ۳۵، جنسیت: زن؛ داده خوانده‌شده از برگه آزمایشی: Glucose=90 mg/dL (70-100)' }];

test('lab interpretation keeps verified text and patient context together within the free output budget', async () => {
  let captured;
  const response = completion();
  const result = await callLabModel(client(async (payload, options) => { captured = { payload, options }; return response; }),
    'openai/gpt-oss-120b', content, 'synthetic-safety-id');
  assert.equal(result, response);
  assert.equal(captured.payload.model, 'openai/gpt-oss-120b');
  assert.deepEqual(captured.payload.messages[1], { role: 'user', content });
  assert.equal(captured.payload.reasoning_effort, 'low');
  assert.equal(captured.payload.max_completion_tokens, 3000);
  assert.equal(captured.payload.include_reasoning, false);
  assert.equal(Object.hasOwn(captured.payload, 'reasoning_format'), false);
  assert.equal(captured.options.timeout, 110000);
  assert.equal(captured.payload.user, 'synthetic-safety-id');
  assert.equal(Object.hasOwn(captured.payload, 'safety_identifier'), false);
  assert.equal(captured.payload.response_format.type, 'json_schema');
  assert.equal(captured.payload.response_format.json_schema.strict, true);
  assert.equal(captured.payload.response_format.json_schema.schema.additionalProperties, false);
  assert.match(captured.payload.messages[0].content, /حدس نزن/);
});

test('request overrides preserve the interpretation cancellation signal and deadline', async () => {
  const signal = new AbortController().signal, calls = [];
  const modelClient = client(async (payload, options) => { calls.push({ payload, options }); return completion(); });
  await callLabModel(modelClient, 'openai/gpt-oss-120b', content, 'synthetic', { timeout: 80000, signal });
  assert.equal(calls[0].payload.reasoning_effort, 'low');
  assert.equal(calls[0].options.timeout, 80000);
  assert.equal(calls[0].options.signal, signal);
});

test('complete responses are validated against the printed range without mutating the input report', () => {
  const input = report({ items: [{ ...report().items[0], value: '120', flag: 'normal' }] });
  const result = parseLabCompletion(completion(input));
  assert.equal(result.items[0].flag, 'high');
  assert.equal(input.items[0].flag, 'normal');
  assert.equal(result.full_text, input.full_text);
  assert.match(result.validation_corrections[0], /Glucose/);
});

test('poor quality does not present a high-confidence or unsupported danger result', () => {
  const result = parseLabCompletion(completion(report({ status: 'danger', read_quality: 'poor', confidence: .99 })));
  assert.equal(result.status, 'warning');
  assert.equal(result.confidence, .45);
  assert.match(result.next_steps[0], /واضح/);
});

test('refusal, content filtering and token exhaustion never accept an apparently complete JSON report', () => {
  for (const [choice, expected] of [
    [{ finish_reason: 'stop', message: { content: JSON.stringify(report()), refusal: 'synthetic refusal' } }, 'AI_REFUSED'],
    [{ finish_reason: 'content_filter', message: { content: JSON.stringify(report()) } }, 'AI_REFUSED'],
    [{ finish_reason: 'length', message: { content: JSON.stringify(report()) } }, 'AI_OUTPUT_TRUNCATED']
  ]) assert.throws(() => parseLabCompletion({ choices: [choice] }), { code: expected });
});

test('missing, blank and nontext completions are reported as empty responses', () => {
  for (const response of [undefined, {}, { choices: [] }, ...[undefined, null, '', '  ', [{ text: 'text part' }]].map(value =>
    ({ choices: [{ message: { content: value } }] }))]) {
    assert.throws(() => parseLabCompletion(response), { code: 'AI_RESPONSE_EMPTY' });
  }
});

test('malformed JSON and incomplete or mistyped lab rows cannot become successful interpretations', () => {
  for (const raw of ['not JSON', '<html>provider error</html>', '{}', '[]', 'null']) {
    assert.throws(() => parseLabCompletion({ choices: [{ message: { content: raw } }] }), { code: 'AI_RESPONSE_INVALID' });
  }
  for (const overrides of [
    { status: 'invented' }, { read_quality: 'invented' }, { confidence: null },
    { confidence: '0.9' }, { items: {} }, { next_steps: {} }, { full_text: ' ' },
    { items: [null] }, { items: [{ ...report().items[0], flag: 'invented' }] },
    { items: [{ ...report().items[0], value: 90 }] }, { items: [{ ...report().items[0], reference_range: null }] }
  ]) assert.throws(() => parseLabCompletion(completion(report(overrides))), { code: 'AI_RESPONSE_INVALID' });
});

test('free provider errors distinguish credentials, account, quota and timeout without exposing private provider text', () => {
  for (const [error, expectedStatus, expectedCode] of [
    [providerError(401), 503, 'AI_AUTH_UNAVAILABLE'], [providerError(403), 503, 'AI_AUTH_UNAVAILABLE'],
    [providerError(402), 503, 'FREE_ACCOUNT_UNAVAILABLE'], [providerError(429), 503, 'FREE_RATE_LIMIT'],
    [Object.assign(new Error('private-provider-content'), { name: 'APIConnectionTimeoutError' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { name: 'AbortError' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { code: 'AI_TIMEOUT' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { code: 'AI_REFUSED' }), 422, 'AI_REFUSED'],
    ...['AI_OUTPUT_TRUNCATED', 'AI_RESPONSE_EMPTY', 'AI_RESPONSE_INVALID', 'AI_GROUNDING_FAILED'].map(code =>
      [Object.assign(new Error('private-provider-content'), { code }), 502, 'AI_RESPONSE_INVALID']),
    [Object.assign(new Error('private-provider-content'), { code: 'FREE_INPUT_LIMIT' }), 413, 'FREE_INPUT_LIMIT'],
    [providerError(500), 503, 'AI_UNAVAILABLE']
  ]) {
    const response = labErrorResponse(error);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.code, expectedCode);
    assert.ok(response.message.length > 0);
    assert.doesNotMatch(response.message, /private-provider-content/);
  }
});

test('storage and result persistence failures are distinguished from unavailable AI', () => {
  for (const stage of ['storage', 'persist']) {
    const response = labErrorResponse(new Error('private database or storage details'), stage);
    assert.equal(response.status, 503);
    assert.equal(response.code, 'ANALYSIS_SAVE_FAILED');
    assert.doesNotMatch(response.message, /private database|storage details/);
  }
});
