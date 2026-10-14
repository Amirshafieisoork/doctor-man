import test from 'node:test';
import assert from 'node:assert/strict';
import { callLabModel, parseLabCompletion, analyzeLabImages, labErrorResponse } from '../server/api/_lib/lab-ai.js';

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
  return { model: 'openai/gpt-6-astra', _request_id: 'synthetic-request',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], ...extra };
}
function client(create) { return { chat: { completions: { create } } }; }
function providerError(status, message = 'private-provider-content') {
  return Object.assign(new Error(message), { name: 'APIError', status });
}
const content = [{ type: 'text', text: 'سن: ۳۵، جنسیت: زن؛ برگه آزمایشی ساختگی' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj', detail: 'high' } }];

test('lab request keeps the image and patient context together and allows the extended completion deadline', async () => {
  let captured;
  const response = completion();
  const result = await callLabModel(client(async (payload, options) => { captured = { payload, options }; return response; }),
    'openai/gpt-6-astra', content, 'synthetic-safety-id');
  assert.equal(result, response);
  assert.equal(captured.payload.model, 'openai/gpt-6-astra');
  assert.deepEqual(captured.payload.messages[1], { role: 'user', content });
  assert.equal(captured.payload.reasoning_effort, 'low');
  assert.equal(captured.payload.max_completion_tokens, 6000);
  assert.equal(captured.options.timeout, 110000);
  assert.equal(captured.payload.safety_identifier, 'synthetic-safety-id');
  assert.equal(captured.payload.response_format.type, 'json_schema');
  assert.equal(captured.payload.response_format.json_schema.strict, true);
  assert.equal(captured.payload.response_format.json_schema.schema.additionalProperties, false);
  assert.match(captured.payload.messages[0].content, /حدس نزن/);
});

test('request overrides preserve cancellation while legacy vision models receive no unsupported reasoning field', async () => {
  const signal = new AbortController().signal, calls = [];
  const modelClient = client(async (payload, options) => { calls.push({ payload, options }); return completion(); });
  await callLabModel(modelClient, 'gpt-6.1-sol', content, 'synthetic', { timeout: 80000, signal });
  await callLabModel(modelClient, 'openai/gpt-4.1', content, 'synthetic', { timeout: 12000, signal });
  assert.equal(calls[0].payload.reasoning_effort, 'low');
  assert.equal(calls[0].options.timeout, 80000);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(Object.hasOwn(calls[1].payload, 'reasoning_effort'), false);
  assert.equal(calls[1].options.signal, signal);
  assert.equal(calls[1].options.timeout, 12000);
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

test('a successful primary response preserves the actual model and request ID for the saved analysis', async () => {
  const calls = [];
  const result = await analyzeLabImages(client(async (payload, options) => {
    calls.push({ payload, options }); return completion(undefined, { model: 'actual-provider-model' });
  }), content, 'synthetic', ['openai/gpt-6-astra', 'openai/gpt-6.1-sol']);
  assert.equal(calls.length, 1);
  assert.equal(result.model, 'actual-provider-model');
  assert.equal(result.requestId, 'synthetic-request');
  assert.equal(result.parsed.items[0].value, '90');
  assert.equal(calls[0].options.timeout, 110000);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('a provider outage uses the distinct fallback with its shorter deadline', async () => {
  const calls = [];
  const result = await analyzeLabImages(client(async (payload, options) => {
    calls.push({ model: payload.model, options });
    if (calls.length === 1) throw providerError(503);
    return completion(undefined, { model: 'openai/gpt-6.1-sol', _request_id: undefined });
  }), content, 'synthetic', ['openai/gpt-6-astra', 'openai/gpt-6.1-sol']);
  assert.deepEqual(calls.map(call => call.model), ['openai/gpt-6-astra', 'openai/gpt-6.1-sol']);
  assert.equal(calls[0].options.timeout, 110000);
  assert.equal(calls[1].options.timeout, 80000);
  assert.equal(result.model, 'openai/gpt-6.1-sol');
  assert.equal(result.requestId, null);
});

test('an empty or truncated primary response is retried and only a validated fallback report is returned', async () => {
  for (const badResponse of [{ choices: [] }, { choices: [{ finish_reason: 'length', message: { content: '{' } }] }]) {
    let calls = 0;
    const result = await analyzeLabImages(client(async () => ++calls === 1 ? badResponse : completion()),
      content, 'synthetic', ['primary', 'fallback']);
    assert.equal(calls, 2);
    assert.equal(result.parsed.full_text, report().full_text);
  }
});

test('authentication and shared-credit errors stop immediately instead of spending a fallback attempt', async () => {
  for (const status of [401, 402, 403]) {
    let calls = 0;
    const error = providerError(status);
    await assert.rejects(analyzeLabImages(client(async () => { calls++; throw error; }), content, 'synthetic', ['primary', 'fallback']),
      actual => actual === error);
    assert.equal(calls, 1);
  }
});

test('identical model aliases are not retried and no more than two distinct models are attempted', async () => {
  const calls = [], error = providerError(503);
  const fake = client(async payload => { calls.push(payload.model); throw error; });
  await assert.rejects(analyzeLabImages(fake, content, 'synthetic', ['same', 'same']), actual => actual === error);
  assert.deepEqual(calls, ['same']);
  calls.length = 0;
  await assert.rejects(analyzeLabImages(fake, content, 'synthetic', ['first', 'second', 'third']), actual => actual === error);
  assert.deepEqual(calls, ['first', 'second']);
});

test('the shared analysis deadline bounds fallback time after a slow primary', async t => {
  const now = Date.now, calls = [];
  let elapsed = 0;
  Date.now = () => 2000000000000 + elapsed;
  t.after(() => { Date.now = now; });
  await analyzeLabImages(client(async (payload, options) => {
    calls.push(options.timeout);
    if (calls.length === 1) { elapsed = 150000; throw providerError(503); }
    return completion();
  }), content, 'synthetic', ['primary', 'fallback']);
  assert.deepEqual(calls, [110000, 40000]);
});

test('an expired shared deadline never starts an additional model request', async t => {
  const now = Date.now;
  let elapsed = 0, calls = 0;
  Date.now = () => 2000000000000 + elapsed;
  t.after(() => { Date.now = now; });
  await assert.rejects(analyzeLabImages(client(async () => {
    calls++; elapsed = 190001; throw providerError(503);
  }), content, 'synthetic', ['primary', 'fallback']), { code: 'AI_TIMEOUT' });
  assert.equal(calls, 1);
});

test('the last fallback failure remains available for a truthful user-facing error', async () => {
  const finalError = Object.assign(new Error('private-provider-content'), { name: 'APIConnectionTimeoutError' });
  let calls = 0;
  await assert.rejects(analyzeLabImages(client(async () => {
    if (++calls === 1) throw providerError(503);
    throw finalError;
  }), content, 'synthetic', ['primary', 'fallback']), actual => actual === finalError);
  assert.equal(labErrorResponse(finalError).code, 'AI_TIMEOUT');
});

test('provider errors distinguish credentials, credit, traffic and timeout without exposing private provider text', () => {
  for (const [error, expectedStatus, expectedCode] of [
    [providerError(401), 503, 'AI_AUTH_UNAVAILABLE'], [providerError(403), 503, 'AI_AUTH_UNAVAILABLE'],
    [providerError(402), 503, 'AI_CREDIT_UNAVAILABLE'], [providerError(429), 503, 'AI_BUSY'],
    [Object.assign(new Error('private-provider-content'), { name: 'APIConnectionTimeoutError' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { name: 'AbortError' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { code: 'AI_TIMEOUT' }), 504, 'AI_TIMEOUT'],
    [Object.assign(new Error('private-provider-content'), { code: 'AI_REFUSED' }), 422, 'AI_REFUSED'],
    ...['AI_OUTPUT_TRUNCATED', 'AI_RESPONSE_EMPTY', 'AI_RESPONSE_INVALID'].map(code =>
      [Object.assign(new Error('private-provider-content'), { code }), 502, 'AI_RESPONSE_INVALID']),
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
