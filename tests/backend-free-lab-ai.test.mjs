import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { analyzeFreeLabImages, FREE_LAB_OCR_MODEL, FREE_LAB_TEXT_MODEL } from '../server/api/_lib/free-lab-ai.js';
import { syntheticLabSections } from './fixtures/nine-section-report.mjs';

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
    items: rows.map((row, index) => ({ row_id: index + 1, flag: row.f, explanation: 'تفسیر آموزشی ساختگی' })),
    next_steps: ['با پزشک مرور کنید.'], when_to_seek_care: 'در صورت علائم شدید مراجعه کنید.', sections: syntheticLabSections(),
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
function interpreterSourceRows(payload) {
  const source = payload.messages[1].content;
  const start = source.lastIndexOf('\n{"pages":');
  assert.ok(start >= 0, 'the interpreter receives the complete serialized source pages');
  return JSON.parse(source.slice(start + 1)).pages.flatMap(page => page.rows);
}
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
test('a normal summary cannot hide a readable value outside its printed range when no abnormal marker was copied', async () => {
  const source = row(1, { v: '120', f: 'unknown' });
  const interpreted = report([source]); interpreted.items[0].flag = 'normal';
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : interpreted));
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
  assert.ok(text.max_completion_tokens >= 3500 && text.max_completion_tokens <= 4500, 'the nine-section report receives its bounded free-tier output budget');
  assert.equal(typeof text.messages[1].content, 'string');
  for (let p = 1; p <= 4; p++) assert.ok(text.messages[1].content.includes(`Glucose page ${p}`));
  const itemSchema = text.response_format.json_schema.schema.properties.items.items;
  assert.equal(text.response_format.json_schema.name, 'drman_lab_analysis');
  assert.equal(text.response_format.json_schema.strict, true);
  const expectedReportFields = ['status', 'status_reason', 'confidence', 'read_quality', 'summary', 'items', 'next_steps', 'when_to_seek_care', 'sections'].sort();
  assert.deepEqual([...text.response_format.json_schema.schema.required].sort(), expectedReportFields);
  assert.deepEqual(Object.keys(text.response_format.json_schema.schema.properties).sort(), expectedReportFields);
  assert.equal(itemSchema.additionalProperties, false);
  assert.deepEqual(itemSchema.properties.row_id, { type: 'integer', enum: [1, 2, 3, 4] });
  assert.deepEqual([...itemSchema.required].sort(), ['explanation', 'flag', 'row_id']);
  assert.deepEqual(Object.keys(itemSchema.properties).sort(), ['explanation', 'flag', 'row_id']);
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

test('an interpreter cannot supply copied or invented test names, values, units or printed ranges', async () => {
  for (const change of [{ name: row().n }, { value: row().v }, { unit: row().u }, { reference_range: row().r }, { name: 'invented test', value: '999' }]) {
    const interpreted = report(); interpreted.items[0] = { ...interpreted.items[0], ...change };
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('omitting an extracted row ID fails rather than presenting an incomplete report', async () => {
  const rows = [row(1), row(2)], interpreted = report(rows);
  interpreted.items.pop();
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1, 2]) : interpreted));
  await assert.rejects(analyzeFreeLabImages(client, content(2), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
});

test('duplicating a row ID cannot replace another extracted row even when item count matches', async () => {
  const rows = [row(1), row(2)], interpreted = report(rows);
  interpreted.items[1].row_id = 1;
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1, 2]) : interpreted));
  await assert.rejects(analyzeFreeLabImages(client, content(2), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
});

test('invented row IDs cannot attach an interpretation to an unextracted test', async () => {
  for (const id of [0, -1, 2, 999]) {
    const interpreted = report(); interpreted.items[0].row_id = id;
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('row IDs must be actual integers and are never coerced from strings, booleans or fractions', async () => {
  for (const id of ['1', true, null, 1.5]) {
    const interpreted = report(); interpreted.items[0].row_id = id;
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
  const interpreted = report(); delete interpreted.items[0].row_id;
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
});

test('reordered interpreter IDs preserve the source order and attach each explanation to its own row', async () => {
  const rows = [row(1), row(2, { n: 'Creatinine', v: '2.4', u: 'mg/dL', r: '0.6-1.2', f: 'high' })];
  const interpreted = report(rows, { status: 'warning' });
  interpreted.items[0].explanation = 'توضیح قند ساختگی';
  interpreted.items[1].explanation = 'توضیح کراتینین ساختگی';
  interpreted.items.reverse();
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows }] } : interpreted));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(result.parsed.items.map(item => [item.name, item.value, item.unit, item.reference_range, item.flag, item.explanation]), [
    [rows[0].n, rows[0].v, rows[0].u, rows[0].r, 'normal', 'توضیح قند ساختگی'],
    [rows[1].n, rows[1].v, rows[1].u, rows[1].r, 'high', 'توضیح کراتینین ساختگی']
  ]);
});

test('the abnormal list is never requested from the model and is derived from authoritative rows after flag validation', async () => {
  const rows = [
    row(1, { n: 'Hemoglobin', v: '10.2', u: 'g/dL', r: '12-16', f: 'low' }),
    row(2, { n: 'Glucose', v: '120', f: 'unknown' }),
    row(3, { n: 'Unreadable marker', v: 'ناخوانا', f: 'unknown' }),
    row(4, { n: 'Normal marker', v: '90', f: 'unknown' }),
    row(5, { n: 'Potassium', v: '7.1', u: 'mmol/L', r: '3.5-5.1', f: 'critical' })
  ];
  const interpreted = report(rows, { status: 'danger' });
  interpreted.items[1].flag = 'high'; // Honor the prepared printed-range classification.
  interpreted.items[2].flag = 'high'; // An unreadable value must stay unknown.
  interpreted.items[3].flag = 'normal'; // Honor the prepared printed-range classification.
  const before = structuredClone(interpreted);
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'partial', rows }] } : interpreted));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(result.parsed.items.map(item => item.flag), ['low', 'high', 'unknown', 'normal', 'critical']);
  assert.deepEqual(result.parsed.abnormal_items, ['Hemoglobin', 'Glucose', 'Potassium']);
  assert.equal(result.parsed.abnormal_items.includes('1'), false);
  assert.equal(result.parsed.abnormal_items.includes('inventedlabel'), false);
  assert.equal(Object.hasOwn(interpreted, 'abnormal_items'), false);
  assert.deepEqual(interpreted, before, 'the synthetic provider response is not mutated');
  assert.equal(Object.hasOwn(calls[1].payload.response_format.json_schema.schema.properties, 'abnormal_items'), false);
  assert.equal(calls[1].payload.response_format.json_schema.schema.required.includes('abnormal_items'), false);
});

test('an interpreter cannot return an abnormal list of any type in place of the server-derived labels', async () => {
  for (const abnormal_items of [[], ['1', 'invented label'], { Hemoglobin: 'low' }, null, 'Hemoglobin', 1]) {
    const interpreted = report([row()], { abnormal_items });
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('readable numeric results without printed markers receive prepared flags while preserving the original fields', async () => {
  const rows = [
    row(1, { n: 'LDL Cholesterol', v: '162', r: '<100', f: 'unknown' }),
    row(2, { n: 'Triglycerides', v: '140', r: '<150', f: 'unknown' }),
    row(3, { n: 'Creatinine', v: '0.9', r: '0.6 - 1.1', f: 'unknown' })
  ];
  const interpreted = report(rows, { status: 'warning' });
  interpreted.items[0].flag = 'high'; interpreted.items[1].flag = 'normal'; interpreted.items[2].flag = 'normal';
  const original = structuredClone(rows);
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows }] } : interpreted));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(result.parsed.items.map(item => item.flag), ['high', 'normal', 'normal']);
  assert.deepEqual(result.parsed.abnormal_items, ['LDL Cholesterol']);
  const prepared = interpreterSourceRows(calls[1].payload);
  assert.deepEqual(prepared.map(row => row.f), ['high', 'normal', 'normal']);
  assert.deepEqual(prepared.map(({ n, v, u, r }) => ({ n, v, u, r })), rows.map(({ n, v, u, r }) => ({ n, v, u, r })));
  assert.deepEqual(rows, original, 'preparing absent flags never mutates the original OCR output');
});

test('source preparation leaves comparator values and qualified reference ranges unknown', async () => {
  const rows = [
    row(1, { n: 'Qualified demographic', v: '13', r: 'Male 14-18; Female 12-16', f: 'unknown' }),
    row(2, { n: 'Comparator result', v: '<5', r: '5-10', f: 'unknown' }),
    row(3, { n: 'Multiple references', v: '12', r: '10-15; 20-30', f: 'unknown' }),
    row(4, { n: 'Unit-qualified range', v: '90', r: '70-100 mg/dL', f: 'unknown' }),
    row(5, { n: 'Age-qualified range', v: '90', r: 'Age 18-65: 70-100', f: 'unknown' })
  ];
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows }] } : report(rows)));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(interpreterSourceRows(calls[1].payload).map(row => row.f), rows.map(() => 'unknown'));
  assert.deepEqual(result.parsed.items.map(item => item.flag), rows.map(() => 'unknown'));
  assert.deepEqual(result.parsed.abnormal_items, []);
});

test('consistent printed markers are preserved and explicit critical markers are never inferred from their numeric range', async () => {
  const rows = [
    row(1, { n: 'Explicit high', v: '162', r: '<100', f: 'high' }),
    row(2, { n: 'Explicit low', v: '69', r: '70-100', f: 'low' }),
    row(3, { n: 'Explicit critical', v: '90', r: '70-100', f: 'critical' }),
    row(4, { n: 'Explicit normal', v: '90', r: '70-100', f: 'normal' })
  ];
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows }] } : report(rows, { status: 'danger' })));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(interpreterSourceRows(calls[1].payload).map(row => row.f), ['high', 'low', 'critical', 'normal']);
  assert.deepEqual(result.parsed.items.map(item => item.flag), ['high', 'low', 'critical', 'normal']);
});

test('a printed marker that conflicts with its unambiguous numeric reference fails before a narrative can retain contradictory prose', async () => {
  for (const source of [
    row(1, { v: '90', r: '70-100', f: 'high' }),
    row(1, { v: '90', r: '70-100', f: 'low' }),
    row(1, { v: '120', r: '70-100', f: 'normal' }),
    row(1, { v: '100', r: '<100', f: 'normal' }),
    row(1, { v: '100', r: '≤100', f: 'high' })
  ]) {
    const { client, calls } = sdk(payload => answer(payload, { pages: [{ p: 1, read_quality: 'good', rows: [source] }] }));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
    assert.equal(calls.length, 1, 'conflicting source evidence must never reach the interpreter');
  }
});

test('an interpretation that contradicts a readable printed marker is rejected before normalization can retain stale prose', async () => {
  for (const [source, flag] of [
    [row(1, { v: '90', r: '70-100', f: 'normal' }), 'high'],
    [row(1, { v: '120', r: '70-100', f: 'high' }), 'low'],
    [row(1, { v: '120', r: '70-100', f: 'high' }), 'unknown'],
    [row(1, { v: '60', r: '70-100', f: 'low' }), 'normal'],
    [row(1, { v: 'Positive', r: 'See clinical context', f: 'high' }), 'normal']
  ]) {
    const interpreted = report([source], { status: 'warning' });
    interpreted.items[0].flag = flag;
    interpreted.items[0].explanation = 'توضیح ساختگی ناسازگار با علامت چاپ‌شده';
    const before = structuredClone(interpreted);
    const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
      ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
    assert.equal(calls.length, 2, 'the rejected result must not trigger a repair or fallback request');
    assert.deepEqual(interpreted, before, 'conflicting response data must never be silently rewritten');
  }
});

test('a normal narrative cannot hide a numeric abnormality derived from a single printed bound', async () => {
  const source = row(1, { n: 'Synthetic cholesterol', v: '162', r: '<100', f: 'unknown' });
  const interpreted = report([source]); interpreted.items[0].flag = 'unknown';
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows: [source] }] } : interpreted));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_GROUNDING_FAILED' });
});

test('incomplete or mistyped interpreter report fields are rejected before source rows are assembled', async () => {
  const invalidReports = [
    report([], { items: null }), report([], { items: {} }), report([row()], { confidence: '0.9' }),
    report([row()], { confidence: 1.1 }), report([row()], { confidence: -0.1 }),
    report([row()], { status_reason: null }), report([row()], { summary: false }),
    report([row()], { abnormal_items: [null] }), report([row()], { next_steps: [1] }),
    report([row()], { when_to_seek_care: [] }), report([row()], { sections: null }),
    report([row()], { extra: 'unexpected field' }),
    report([row()], { items: [{ row_id: 1, flag: 'normal', explanation: 90 }] }),
    report([row()], { items: [{ row_id: 1, flag: 'invented', explanation: 'ساختگی' }] }),
    report([row()], { items: [null] })
  ];
  for (const field of Object.keys(report())) {
    const value = report(); delete value[field]; invalidReports.push(value);
  }
  for (const interpreted of invalidReports) {
    const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
  }
});

test('the interpreter must provide all nine substantive sections once and cannot substitute an untrusted full_text', async () => {
  const invalidReports = [];
  const changeSections = change => { const value = report(); change(value.sections); invalidReports.push(value); };
  changeSections(sections => sections.pop());
  changeSections(sections => sections.push({ ...sections[0] }));
  changeSections(sections => { sections[8].section_id = 1; });
  changeSections(sections => { sections[8].section_id = 10; });
  changeSections(sections => { sections[0].section_id = '1'; });
  changeSections(sections => { sections[0].content = ''; });
  changeSections(sections => { sections[0].content = ' \n\t '; });
  changeSections(sections => { sections[0].content = 9; });
  changeSections(sections => { sections[0].extra = 'unexpected'; });
  changeSections(sections => { sections.forEach(section => { section.content = 'برای نتیجه با پزشک مشورت کنید.'; }); });
  changeSections(sections => { sections.forEach(section => { section.content = 'English only detailed synthetic report. '.repeat(100); }); });
  const withUntrustedText = report(); withUntrustedText.full_text = 'A replacement report must never be accepted.'; invalidReports.push(withUntrustedText);
  for (const interpreted of invalidReports) {
    const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL ? extraction([1]) : interpreted));
    await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(calls.length, 2);
  }
});

test('nine sections are assembled in canonical order independently of row ordering and preserve source medical fields', async () => {
  const original = row(1, { n: ' Glucose page 1 ', v: ' 90 ', u: ' mg/dL ', r: ' 70-100 ' });
  const interpreted = report([original]);
  interpreted.sections.reverse();
  const responseBefore = structuredClone(interpreted);
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows: [original] }] } : interpreted));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.deepEqual(interpreted, responseBefore, 'server assembly never mutates the model response');
  assert.deepEqual(result.parsed.items.map(item => [item.name, item.value, item.unit, item.reference_range]), [[original.n, original.v, original.u, original.r]]);
  assert.deepEqual(result.parsed.sections.map(section => section.section_id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(result.parsed.sections.every(section => typeof section.title === 'string' && section.title.trim() && typeof section.content === 'string'));
  assert.equal(result.parsed.sections[0].title, 'خلاصه کلی وضعیت سلامت');
  assert.equal(result.parsed.sections[6].title, 'گزینه‌های گیاهی و طب مکمل (با احتیاط)');
  const headings = [...result.parsed.full_text.matchAll(/^## (\d+)\. /gm)].map(match => Number(match[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ordered = syntheticLabSections();
  for (let index = 0; index < ordered.length; index++) {
    assert.ok(result.parsed.full_text.includes(ordered[index].content));
    if (index > 0) assert.ok(result.parsed.full_text.indexOf(ordered[index - 1].content) < result.parsed.full_text.indexOf(ordered[index].content));
  }
  const schema = calls[1].payload.response_format.json_schema.schema;
  assert.equal(Object.hasOwn(schema.properties, 'full_text'), false);
  assert.ok(schema.required.includes('sections'));
  assert.equal(schema.properties.sections.minItems, 9);
  assert.equal(schema.properties.sections.maxItems, 9);
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

test('server assembly preserves authoritative OCR whitespace without requesting copied fields from the interpreter', async () => {
  const original = row(1, { n: ' Glucose  page 1 ', v: ' 90 ', u: ' mg/dL ', r: ' 70-100 ' });
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows: [original] }] } : report([row()])));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.equal(result.parsed.items[0].name, original.n);
  assert.equal(result.parsed.items[0].value, original.v);
  assert.equal(result.parsed.items[0].unit, original.u);
  assert.equal(result.parsed.items[0].reference_range, original.r);
  assert.equal(Object.hasOwn(result.parsed.items[0], 'row_id'), false);
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

test('an unreadable source value stays unknown even when the interpreter attaches a noncritical abnormal flag', async () => {
  const rows = [row(), row(2, { v: 'ناخوانا', f: 'unknown' })];
  const interpreted = report(rows, { status: 'warning' }); interpreted.items[1].flag = 'high';
  const { client } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'partial', rows }] } : interpreted));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.equal(result.parsed.items[1].value, 'ناخوانا');
  assert.equal(result.parsed.items[1].flag, 'unknown');
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

test('a twenty-row report receives detailed interpretation without dropping ordinary source rows to fit the free budget', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(1, { n: `Synthetic marker ${index + 1}`, v: '90' }));
  const { client, calls } = sdk(payload => answer(payload, payload.model === FREE_LAB_OCR_MODEL
    ? { pages: [{ p: 1, read_quality: 'good', rows }] } : report(rows)));
  const result = await analyzeFreeLabImages(client, content(), 'synthetic');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].payload.max_completion_tokens >= 3500 && calls[1].payload.max_completion_tokens <= 4500);
  assert.deepEqual(result.parsed.items.map(item => [item.name, item.value, item.unit, item.reference_range]), rows.map(row => [row.n, row.v, row.u, row.r]));
  assert.equal(result.parsed.sections.length, 9);
  for (const row of rows) assert.ok(calls[1].payload.messages[1].content.includes(row.n));
});

test('a twenty-row source that leaves too little room for a detailed report is rejected instead of shortening rows or sections', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(1, { n: `Synthetic marker ${index + 1} ${'x'.repeat(170)}`, v: '90' }));
  const { client, calls } = sdk(payload => answer(payload, { pages: [{ p: 1, read_quality: 'good', rows }] }));
  await assert.rejects(analyzeFreeLabImages(client, content(), 'synthetic'), { code: 'FREE_INPUT_LIMIT' });
  assert.equal(calls.length, 1, 'only OCR runs when the complete detailed report cannot fit');
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
