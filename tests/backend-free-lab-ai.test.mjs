import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { analyzeFreeLabImages, FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL } from '../server/api/_lib/free-lab-ai.js';

// Exercise the actual OpenAI-compatible SDK boundary with a fully local fetch.
// No provider request, production account or health image is used.
function content(count = 1) {
  return [{ type: 'text', text: 'سن: ۳۵، جنسیت: زن؛ داده آزمایشی' }, ...Array.from({ length: count }, (_, i) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,cGFnZS0${i + 1}`, detail: 'high' } }))];
}
function row(page = 1, overrides = {}) { return { n: `Glucose page ${page}`, v: `${89 + page}`, u: 'mg/dL', r: '70-100', f: 'normal', ...overrides }; }
function extraction(ids, changes = {}) {
  return { pages: ids.map(p => ({ p, read_quality: 'good', rows: [row(p)] })), ...changes };
}
function report(rows = [row()], changes = {}) {
  return {
    status: 'normal', status_reason: 'در محدوده چاپ‌شده', confidence: .9, read_quality: 'good', summary: 'نتیجه ساختگی خوانا است',
    items: rows.map(row => ({ name: row.n, value: row.v, unit: row.u, reference_range: row.r, flag: row.f, explanation: 'تفسیر آموزشی ساختگی' })),
    abnormal_items: [], next_steps: ['با پزشک مرور کنید.'], when_to_seek_care: 'در صورت علائم شدید مراجعه کنید.', full_text: 'تفسیر آموزشی برگه آزمایشی ساختگی.',
    ...changes
  };
}
function answer(payload, value, extra = {}, headers = {}) {
  return new Response(JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion', model: payload.model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }, ...extra }),
  { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-request', ...headers } });
}
function sdk(respond) {
  const calls = [];
  const client = new OpenAI({ apiKey: 'synthetic-free-test-key', baseURL: 'https://api.groq.com/openai/v1', maxRetries: 0,
    fetch: async (input, options) => {
      const request = new Request(input, options);
      assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
      const payload = await request.json();
      assert.ok([FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL].includes(payload.model), 'a paid provider or model must never be requested');
      calls.push({ payload, signal: request.signal });
      return respond(payload, calls.length, request);
    } });
  return { client, calls };
}
function pageIds(payload) { return payload.response_format.json_schema.schema.properties.pages.items.properties.p.enum; }
function normalResponse(payload) { return payload.model === FREE_LAB_OCR_MODEL ? extraction(pageIds(payload)) : report(); }
test('a printed critical marker must survive interpretation and cannot be silently repaired into ordinary high', async () => {
  const source = row(1, { n: 'Potassium', v: '7.1', r: '3.5-5.1', f: 'critical' });
  for (const flag of ['normal', 'high', 'unknown']) {
    const text = report([source], { status: 'warning' }); text.items[0].flag = flag;
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : text));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
  }
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : report([source], { status: 'danger' })));
  assert.equal((await analyzeFreeLabImages(client, content(), 'synthetic')).parsed.items[0].flag, 'critical');
});
test('an invented critical alert cannot be accepted by silently changing its flag while retaining the prose', async () => {
  const source = row(); const text = report([source], { status: 'danger' }); text.items[0].flag = 'critical';
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : text));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
});
test('a normal summary that contradicts a printed abnormal row fails instead of being silently rewritten', async () => {
  const source = row(1, { v: '120', f: 'high' });
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : report([source])));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
});
function busy(seconds = '2') {
  return new Response(JSON.stringify({ error: { message: 'synthetic traffic limit', type: 'rate_limit_error' } }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': seconds } });
}

test('four pages are extracted in two complete batches and only grounded text is sent to the free interpreter', async () => {
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction(pageIds(payload)) : report([1, 2, 3, 4].map(p => row(p)))));
  const result = await analyzeFreeLabImages(client, content(4), 'synthetic-safety-id');
  assert.deepEqual(calls.map(call => call.payload.model), [FREE_LAB_OCR_MODEL, FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL]);
  assert.deepEqual(calls.slice(0, 2).map(call => pageIds(call.payload)), [[1, 2], [3, 4]]);
  for (const { payload, signal } of calls.slice(0, 2)) {
    assert.equal(payload.messages[1].content.filter(part => part.type === 'image_url').length, 2);
    assert.equal(payload.max_completion_tokens, 2000);
    assert.equal(payload.reasoning_effort, 'none');
    assert.equal(payload.reasoning_format, 'hidden');
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.ok(signal instanceof AbortSignal);
    assert.equal(Object.hasOwn(payload, 'safety_identifier'), false);
  }
  const text = calls[2].payload;
  assert.equal(text.reasoning_effort, 'low');
  assert.equal(text.include_reasoning, false);
  assert.equal(Object.hasOwn(text, 'reasoning_format'), false);
  assert.equal(Object.hasOwn(text, 'safety_identifier'), false);
  assert.ok(text.max_completion_tokens <= 3000);
  assert.equal(text.messages[1].content.filter(part => part.type === 'image_url').length, 0);
  for (let p = 1; p <= 4; p++) assert.ok(text.messages[1].content[0].text.includes(`Glucose page ${p}`));
  assert.equal(result.parsed.items.length, 4);
  assert.equal(result.model, FREE_LAB_TEXT_MODEL);
  assert.equal(result.ocr_model, FREE_LAB_OCR_MODEL);
  assert.equal(result.requestId, 'synthetic-request');
  assert.deepEqual(result.usage, { prompt_tokens: 300, completion_tokens: 90, total_tokens: 390 });
});

test('an odd page count preserves the last page and never sends more than two images per request', async () => {
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction(pageIds(payload)) : report([1, 2, 3].map(p => row(p)))));
  await analyzeFreeLabImages(client, content(3), 'synthetic');
  assert.deepEqual(calls.slice(0, 2).map(call => pageIds(call.payload)), [[1, 2], [3]]);
  assert.equal(calls[1].payload.messages[1].content.filter(part => part.type === 'image_url').length, 1);
});

test('missing, duplicated and invented OCR page IDs prevent interpretation instead of discarding a page', async () => {
  for (const pages of [extraction([1]).pages, extraction([1, 1]).pages, extraction([1, 3]).pages]) {
    const { client, calls } = sdk(payload => answer(payload, { pages }));
    await assert.rejects(analyzeFreeLabImages(client, content(2), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(calls.length, 1);
  }
});

test('every OCR row is validated before a clinical model can receive it', async () => {
  for (const bad of [row(1, { n: '' }), row(1, { v: 90 }), row(1, { u: null }), row(1, { r: 100 }), row(1, { f: 'invented' }), { ...row(), extra: 'untrusted' }]) {
    const { client, calls } = sdk(payload => answer(payload, { pages: [{ p: 1, read_quality: 'good', rows: [bad] }] }));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(calls.length, 1);
  }
});

test('malformed extraction bodies, invalid qualities and nonarray rows are rejected', async () => {
  for (const bad of [{}, [], null, { pages: 'invented' }, { pages: [{ p: 1, read_quality: 'invented', rows: [] }] }, { pages: [{ p: 1, read_quality: 'good', rows: {} }] }]) {
    const { client, calls } = sdk(payload => answer(payload, bad));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(calls.length, 1);
  }
});

test('an interpreter cannot add, omit or alter an extracted test name, value, unit or printed range', async () => {
  for (const change of [{ name: 'invented test' }, { value: '999' }, { unit: 'mmol/L' }, { reference_range: '1-999' }]) {
    const interpreted = report(); interpreted.items[0] = { ...interpreted.items[0], ...change };
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
  for (const items of [[], [...report().items, { ...report().items[0], name: 'invented additional test' }]]) {
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : report([row()], { items })));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('duplicate extracted rows are preserved one for one rather than silently deduplicated', async () => {
  const original = row(1);
  for (const interpretedRows of [[original], [original, original]]) {
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
      ? { pages: [{ p: 1, read_quality: 'good', rows: [original, original] }] } : report(interpretedRows)));
    if (interpretedRows.length === 1) await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    else assert.equal((await analyzeFreeLabImages(client, content(), 'synthetic')).parsed.items.length, 2);
  }
});

test('whitespace normalization cannot change the authoritative stored OCR fields', async () => {
  const original = row(1, { n: ' Glucose  page 1 ', v: ' 90 ', u: ' mg/dL ', r: ' 70-100 ' });
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows: [original] }] } : report([row()])));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.equal(result.parsed.items[0].name, original.n);
  assert.equal(result.parsed.items[0].value, original.v);
  assert.equal(result.parsed.items[0].unit, original.u);
  assert.equal(result.parsed.items[0].reference_range, original.r);
});

test('all unreadable or missing values produce a local poor result without invoking clinical interpretation', async () => {
  for (const rows of [[], [row(1, { v: '', f: 'unknown' })], [row(1, { v: 'ناخوانا', f: 'unknown' })]]) {
    const { client, calls } = sdk(payload => answer(payload, { pages: [{ p: 1, read_quality: 'poor', rows }] }));
    const result = await analyzeFreeLabImages(client, content(), 'synthetic');
    assert.equal(calls.length, 1);
    assert.equal(result.parsed.read_quality, 'poor');
    assert.equal(result.parsed.confidence, 0);
    assert.equal(result.parsed.items.length, rows.length);
    assert.ok(result.parsed.items.every(item => item.flag === 'unknown'));
    assert.equal(result.model, FREE_LAB_OCR_MODEL);
  }
});

test('partially unreadable rows remain present and OCR quality limits the interpretation confidence', async () => {
  const rows = [row(), row(2, { v: '', f: 'unknown' })];
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'partial', rows }] } : report(rows)));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.equal(result.parsed.items.length, 2);
  assert.equal(result.parsed.items[1].flag, 'unknown');
  assert.equal(result.parsed.read_quality, 'partial');
  assert.equal(result.parsed.confidence, .78);
});

test('OCR refusal and token exhaustion never proceed to a clinical model', async () => {
  for (const [choice, code] of [
    [{ finish_reason: 'stop', message: { refusal: 'synthetic refusal', content: '{}' } }, 'AI_REFUSED'],
    [{ finish_reason: 'content_filter', message: { content: '{}' } }, 'AI_REFUSED'],
    [{ finish_reason: 'length', message: { content: '{' } }, 'AI_OUTPUT_TRUNCATED']
  ]) {
    const { client, calls } = sdk(payload => answer(payload, null, { choices: [choice] }));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code });
    assert.equal(calls.length, 1);
  }
});

test('text-model refusal, malformed JSON and truncation are preserved as truthful errors', async () => {
  for (const [choice, code] of [
    [{ finish_reason: 'stop', message: { refusal: 'synthetic refusal', content: '{}' } }, 'AI_REFUSED'],
    [{ finish_reason: 'stop', message: { content: 'invalid JSON' } }, 'AI_RESPONSE_INVALID'],
    [{ finish_reason: 'length', message: { content: JSON.stringify(report()) } }, 'AI_OUTPUT_TRUNCATED']
  ]) {
    const { client, calls } = sdk(payload => payload.model === FREE_LAB_OCR_MODEL ? answer(payload, extraction([1])) : answer(payload, null, { choices: [choice] }));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code });
    assert.equal(calls.length, 2);
  }
});

test('429 Retry-After waits in abortable short slices and makes one retry of the same free model', async () => {
  let elapsed = 0, ocrAttempts = 0;
  const waits = [];
  const { client, calls } = sdk(payload => payload.model === FREE_LAB_OCR_MODEL && ++ocrAttempts === 1 ? busy('2.5') : answer(payload, normalResponse(payload)));
  await analyzeFreeLabImages(client, content(), 'synthetic', { now: () => 2000000000000 + elapsed, sleep: async ms => { waits.push(ms); elapsed += ms; } });
  assert.deepEqual(waits, [1000, 1000, 500]);
  assert.deepEqual(calls.map(call => call.payload.model), [FREE_LAB_OCR_MODEL, FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL]);
});

test('text-model 429 uses the same bounded retry without rerunning or losing successful OCR', async () => {
  let elapsed = 0, textAttempts = 0;
  const { client, calls } = sdk(payload => payload.model === FREE_LAB_TEXT_MODEL && ++textAttempts === 1 ? busy('1') : answer(payload, normalResponse(payload)));
  await analyzeFreeLabImages(client, content(), 'synthetic', { now: () => 2000000000000 + elapsed, sleep: async ms => { elapsed += ms; } });
  assert.deepEqual(calls.map(call => call.payload.model), [FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL, FREE_LAB_TEXT_MODEL]);
});

test('repeat traffic limits and Retry-After beyond sixty seconds stop without paid fallback', async () => {
  for (const delay of ['0', '61']) {
    const { client, calls } = sdk(() => busy(delay));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), error => error.status === 429);
    assert.equal(calls.length, delay === '0' ? 2 : 1);
  }
});

test('a shared expired deadline never starts the next batch or interpreter', async () => {
  let elapsed = 0;
  const { client, calls } = sdk(payload => { elapsed = 220001; return answer(payload, extraction(pageIds(payload))); });
  await assert.rejects(analyzeFreeLabImages(client, content(4), 'synthetic', { now: () => 2000000000000 + elapsed }), { code: 'AI_TIMEOUT' });
  assert.equal(calls.length, 1);
});

test('a retry that cannot fit the remaining shared deadline does not make another request', async () => {
  let elapsed = 0;
  const { client, calls } = sdk(() => { elapsed = 219000; return busy('2'); });
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic', { now: () => 2000000000000 + elapsed }), { code: 'AI_TIMEOUT' });
  assert.equal(calls.length, 1);
});

test('cancellation interrupts a retry wait and does not invoke any additional provider', async () => {
  const controller = new AbortController();
  const { client, calls } = sdk(() => busy('2'));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic', { signal: controller.signal, sleep: async () => { controller.abort(); } }), { code: 'AI_TIMEOUT' });
  assert.equal(calls.length, 1);
});

test('oversized but validated OCR input is rejected before interpretation instead of truncating tests', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => row(1, { n: `Synthetic marker ${i} ${'x'.repeat(120)}`, r: 'Printed reference interval '.repeat(5) }));
  const { client, calls } = sdk(payload => answer(payload, { pages: [{ p: 1, read_quality: 'good', rows }] }));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'FREE_INPUT_LIMIT' });
  assert.equal(calls.length, 1);
});

test('more than 120 valid rows across pages are rejected without silently dropping later rows', async () => {
  const { client, calls } = sdk(payload => answer(payload, { pages: pageIds(payload).map(p => ({ p, read_quality: 'good', rows: Array.from({ length: 61 }, (_, i) => row(p, { n: `Marker ${p}-${i}` })) })) }));
  await assert.rejects(analyzeFreeLabImages(client, content(2), 'synthetic'), { code: 'FREE_INPUT_LIMIT' });
  assert.equal(calls.length, 1);
});

test('invalid image inputs and an already cancelled request never reach the SDK', async () => {
  for (const input of [[], null, content(5), [{ type: 'image_url', image_url: {} }]]) {
    const { client, calls } = sdk(() => { throw new Error('must not call'); });
    await assert.rejects(analyzeFreeLabImages(client, input, 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(calls.length, 0);
  }
  const controller = new AbortController(); controller.abort();
  const { client, calls } = sdk(() => { throw new Error('must not call'); });
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic', { signal: controller.signal }), { code: 'AI_TIMEOUT' });
  assert.equal(calls.length, 0);
});
