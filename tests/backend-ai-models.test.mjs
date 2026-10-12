import test from 'node:test';
import assert from 'node:assert/strict';

const configurationKeys = [
  'AVALAI_API_KEY', 'AVALAI_BASE_URL', 'AI_GATEWAY_API_KEY',
  'GATEWAY_LAB_MODEL', 'GATEWAY_LAB_FALLBACK_MODEL',
  'GATEWAY_HEALTH_NAVIGATOR_MODEL', 'GATEWAY_HEALTH_NAVIGATOR_FALLBACK_MODEL',
  'GATEWAY_SUPPORT_MODEL', 'GATEWAY_SUPPORT_FALLBACK_MODEL'
];
let moduleNumber = 0;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function withModels(overrides, fetcher, run) {
  const previous = new Map(configurationKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const key of configurationKeys) process.env[key] = '';
  Object.assign(process.env, { AI_GATEWAY_API_KEY: 'test-gateway-token', ...overrides });
  globalThis.fetch = fetcher;
  try {
    const models = await import(`../server/api/_lib/ai-models.js?test=${++moduleNumber}`);
    await run(models);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('catalog outages and malformed responses produce a controlled unconfigured result', async () => {
  for (const fetcher of [
    async () => json({ error: 'unavailable' }, 503),
    async () => json({ data: [] }),
    async () => json({ data: { id: 'openai/gpt-4.1' } }),
    async () => json({ data: [{ id: null }, {}, { id: 123 }] }),
    async () => new Response('invalid JSON'),
    async () => { throw new TypeError('network unavailable'); }
  ]) {
    await withModels({}, fetcher, async models => {
      assert.equal(await models.avalaiClient(), null);
      assert.deepEqual(await models.configuredModels(), { provider: 'unconfigured' });
    });
  }
});

test('one supported vision model keeps all AI features available without a separate fallback', async () => {
  let catalogRequests = 0;
  const completionModels = [];
  await withModels({}, async (input, options) => {
    const request = new Request(input, options);
    if (request.url.endsWith('/models')) {
      catalogRequests++;
      assert.equal(request.headers.get('authorization'), 'Bearer test-gateway-token');
      return json({ data: [{ id: 'openai/gpt-4.1' }] });
    }
    assert.equal(request.url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    completionModels.push((await request.json()).model);
    return json({ id: 'test-completion', model: 'openai/gpt-4.1', choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  }, async models => {
    const configured = await models.configuredModels();
    assert.equal(configured.provider, 'vercel-ai-gateway');
    for (const role of ['lab', 'lab_fallback', 'navigator', 'navigator_fallback', 'support', 'support_fallback']) {
      assert.equal(configured[role], 'openai/gpt-4.1');
    }
    const client = await models.avalaiClient();
    assert.ok(client);
    client.fetch = globalThis.fetch;
    for (const model of [models.LAB_PRIMARY_MODEL, models.LAB_FALLBACK_MODEL, models.HEALTH_NAVIGATOR_MODEL, models.HEALTH_NAVIGATOR_FALLBACK_MODEL, models.SUPPORT_MODEL, models.SUPPORT_FALLBACK_MODEL]) {
      await client.chat.completions.create({ model, messages: [{ role: 'user', content: 'test' }] });
    }
  });
  assert.equal(catalogRequests, 1, 'a validated catalog is cached between configuration and completion calls');
  assert.deepEqual(completionModels, Array(6).fill('openai/gpt-4.1'));
});

test('catalog choices prefer a distinct available fallback and a smaller support model', async () => {
  await withModels({}, async () => json({ data: ['openai/gpt-5.2', 'openai/gpt-4.1', 'openai/gpt-4.1-mini'].map(id => ({ id })) }), async models => {
    assert.deepEqual(await models.configuredModels(), {
      provider: 'vercel-ai-gateway', lab: 'openai/gpt-5.2', lab_fallback: 'openai/gpt-4.1',
      navigator: 'openai/gpt-5.2', navigator_fallback: 'openai/gpt-4.1',
      support: 'openai/gpt-4.1-mini', support_fallback: 'openai/gpt-4.1'
    });
  });
});

test('an unavailable explicit model fails closed instead of silently ignoring configuration', async () => {
  await withModels({ GATEWAY_LAB_FALLBACK_MODEL: 'openai/missing-model' }, async () => json({ data: [{ id: 'openai/gpt-4.1' }] }), async models => {
    assert.equal(await models.avalaiClient(), null);
    assert.deepEqual(await models.configuredModels(), { provider: 'unconfigured' });
  });
});

test('shared primary and fallback aliases resolve to the same actual model', async () => {
  const calls = [];
  await withModels({ GATEWAY_LAB_MODEL: 'openai/gpt-5.6-terra' }, async (input, options) => {
    const request = new Request(input, options);
    if (request.url.endsWith('/models')) return json({ data: [{ id: 'openai/gpt-5.6-terra' }, { id: 'openai/gpt-4.1' }] });
    calls.push((await request.json()).model);
    return json({ id: 'test-completion', choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  }, async models => {
    const configured = await models.configuredModels();
    assert.equal(models.LAB_PRIMARY_MODEL, models.LAB_FALLBACK_MODEL);
    assert.equal(configured.lab, configured.lab_fallback);
    const client = await models.avalaiClient();
    client.fetch = globalThis.fetch;
    await client.chat.completions.create({ model: models.LAB_PRIMARY_MODEL, messages: [] });
  });
  assert.deepEqual(calls, ['openai/gpt-5.6-terra']);
});

test('configured AvalAI credentials use the existing provider without a gateway catalog request', async () => {
  await withModels({ AVALAI_API_KEY: 'test-avalai-token', AVALAI_BASE_URL: 'https://api.avalai.ir/v1' }, async () => { throw new Error('unexpected catalog request'); }, async models => {
    const client = await models.avalaiClient();
    assert.equal(client.baseURL, 'https://api.avalai.ir/v1');
    assert.equal((await models.configuredModels()).provider, 'avalai');
  });
});
