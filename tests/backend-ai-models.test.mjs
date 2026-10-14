import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { avalaiClient, configuredModels, LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL } from '../server/api/_lib/ai-models.js';
import { encryptPrivateAIKey } from '../server/api/_lib/private-ai-settings.js';

const syntheticKey = 'gsk-synthetic-private-account-key';
const environmentKey = 'gsk-synthetic-environment-account-key';
const configurationKeys = ['SESSION_SECRET', 'FREE_AI_API_KEY', 'GROQ_API_KEY', 'FREE_AI_ACCOUNT_CONFIRMED',
  'AVALAI_API_KEY', 'AVALAI_BASE_URL', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN',
  'LAB_MODEL', 'LAB_FALLBACK_MODEL', 'GATEWAY_LAB_MODEL', 'GATEWAY_LAB_FALLBACK_MODEL',
  'SUPPORT_MODEL', 'HEALTH_NAVIGATOR_MODEL'];
async function withConfiguration(overrides, run) {
  const previous = new Map(configurationKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const key of configurationKeys) delete process.env[key];
  process.env.SESSION_SECRET = 'synthetic-session-encryption-secret-at-least-32-characters';
  Object.assign(process.env, overrides);
  globalThis.fetch = async () => { throw new Error('unexpected external request'); };
  try { await run(); }
  finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
function fixture(row = null, error = null) {
  const operations = [];
  const database = { from(table) {
    assert.equal(table, 'app_settings');
    return {
      select(fields) { operations.push(['select', fields]); return this; },
      eq(key, value) { operations.push(['eq', key, value]); return this; },
      async maybeSingle() { return { data: row, error }; }
    };
  } };
  return { database, operations };
}
function stored(overrides = {}) {
  return { value: { version: 1, provider: 'groq', free_only: true, free_account_confirmed: true,
    encrypted_api_key: encryptPrivateAIKey(syntheticKey, 'groq'), ...overrides }, updated_at: '2026-10-14T00:00:00Z' };
}
const unconfigured = { provider: 'unconfigured', free_only: true };
function json(body) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
async function sdkCalls(modelClient, run) {
  const requests = [];
  modelClient.fetch = async (input, options) => {
    const request = new Request(input, options);
    requests.push({ url: request.url, authorization: request.headers.get('authorization'), body: await request.json() });
    return json({ id: 'synthetic-completion', model: requests.at(-1).body.model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
  };
  await run(requests);
  return requests;
}

test('old AvalAI, Gateway and OIDC credentials never activate a paid-provider connection', async () => {
  await withConfiguration({ AVALAI_API_KEY: 'synthetic-paid-key', AI_GATEWAY_API_KEY: 'synthetic-paid-gateway-key',
    VERCEL_OIDC_TOKEN: 'synthetic-oidc-token', AVALAI_BASE_URL: 'https://other-provider.invalid/v1' }, async () => {
    const f = fixture();
    assert.equal(await avalaiClient(f), null);
    assert.deepEqual(await configuredModels(f), unconfigured);
    assert.ok(f.operations.some(([op, key, value]) => op === 'eq' && key === 'key' && value === 'private_ai'));
  });
});

test('environment keys require explicit confirmation of an account on the free plan', async () => {
  for (const confirmation of [undefined, '', 'false', 'TRUE', '1']) {
    await withConfiguration({ GROQ_API_KEY: environmentKey,
      ...(confirmation === undefined ? {} : { FREE_AI_ACCOUNT_CONFIRMED: confirmation }) }, async () => {
      assert.equal(await avalaiClient(fixture()), null);
      assert.deepEqual(await configuredModels(fixture()), unconfigured);
    });
  }
});

test('a confirmed free environment key uses the fixed Groq endpoint and only the free model inventory', async () => {
  for (const variable of ['FREE_AI_API_KEY', 'GROQ_API_KEY']) {
    await withConfiguration({ [variable]: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true',
      AVALAI_API_KEY: 'synthetic-paid-key', AI_GATEWAY_API_KEY: 'synthetic-paid-gateway-key', LAB_MODEL: 'paid-model' }, async () => {
      const modelClient = await avalaiClient(fixture());
      assert.equal(modelClient.baseURL, 'https://api.groq.com/openai/v1');
      assert.equal(modelClient.maxRetries, 0);
      const metadata = await configuredModels(fixture());
      assert.deepEqual(metadata, {
        provider: 'groq-free', free_only: true, lab: 'qwen/qwen3.8-27b', lab_interpreter: 'openai/gpt-oss-120b',
        lab_fallback: 'qwen/qwen3.8-27b', navigator: 'openai/gpt-oss-120b', navigator_fallback: 'openai/gpt-oss-120b',
        support: 'openai/gpt-oss-120b', support_fallback: 'openai/gpt-oss-120b'
      });
      assert.equal(JSON.stringify(metadata).includes(environmentKey), false);
      await sdkCalls(modelClient, async requests => {
        await modelClient.chat.completions.create({ model: LAB_PRIMARY_MODEL, messages: [] });
        assert.equal(requests[0].authorization, `Bearer ${environmentKey}`);
        assert.equal(requests[0].url, 'https://api.groq.com/openai/v1/chat/completions');
      });
    });
  }
});

test('an encrypted private free key takes precedence over environment keys without exposing it in metadata', async () => {
  await withConfiguration({ FREE_AI_API_KEY: environmentKey, GROQ_API_KEY: environmentKey,
    FREE_AI_ACCOUNT_CONFIRMED: 'true', AVALAI_API_KEY: 'synthetic-paid-key' }, async () => {
    const f = fixture(stored());
    const metadata = await configuredModels(f);
    assert.equal(metadata.provider, 'groq-free');
    assert.equal(JSON.stringify(metadata).includes(syntheticKey), false);
    for (const field of ['api_key', 'encrypted_api_key', 'ciphertext']) assert.equal(Object.hasOwn(metadata, field), false);
    const modelClient = await avalaiClient(f);
    await sdkCalls(modelClient, async requests => {
      await modelClient.chat.completions.create({ model: LAB_INTERPRETATION_MODEL, messages: [] });
      assert.equal(requests[0].authorization, `Bearer ${syntheticKey}`);
    });
  });
});

test('an explicitly cleared private key disables a confirmed environment key', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const f = fixture(stored({ encrypted_api_key: null }));
    assert.equal(await avalaiClient(f), null);
    assert.deepEqual(await configuredModels(f), unconfigured);
  });
});

test('unconfirmed, paid and malformed private configurations fail closed despite a usable environment key', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    for (const overrides of [{ free_account_confirmed: false }, { free_only: false }, { provider: 'avalai' },
      { provider: 'custom' }, { version: 2 }, { encrypted_api_key: { version: 1, iv: 'bad', ciphertext: 'bad', tag: 'bad' } }]) {
      const f = fixture(stored(overrides));
      assert.equal(await avalaiClient(f), null);
      assert.deepEqual(await configuredModels(f), unconfigured);
    }
  });
});

test('database lookup errors and encryption-key rotation never fall back to environment credentials', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const brokenDatabase = fixture(null, { message: 'private database details' });
    assert.equal(await avalaiClient(brokenDatabase), null);
    assert.deepEqual(await configuredModels(brokenDatabase), unconfigured);
    const f = fixture(stored());
    process.env.SESSION_SECRET = 'a-different-synthetic-encryption-secret-at-least-32-characters';
    assert.equal(await avalaiClient(f), null);
    assert.deepEqual(await configuredModels(f), unconfigured);
  });
});

test('paid, unknown and absent model IDs are blocked before the SDK can send a request', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const modelClient = await avalaiClient(fixture());
    await sdkCalls(modelClient, async requests => {
      for (const model of ['openai/gpt-6-astra', 'google/gemini-3.8-flash', 'qwen/unknown', '', undefined]) {
        assert.throws(() => modelClient.chat.completions.create({ model, messages: [] }), { code: 'FREE_MODEL_NOT_ALLOWED' });
      }
      assert.throws(() => modelClient.chat.completions.create(null), { code: 'FREE_MODEL_NOT_ALLOWED' });
      assert.equal(requests.length, 0);
    });
  });
});

test('vision requests cap output and remove incompatible reasoning fields without modifying the caller payload', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const modelClient = await avalaiClient(fixture());
    await sdkCalls(modelClient, async requests => {
      const original = { model: LAB_PRIMARY_MODEL, messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } }] }],
        max_completion_tokens: 6000, reasoning_effort: 'high', include_reasoning: true, safety_identifier: 'synthetic-user-hash' };
      await modelClient.chat.completions.create(original);
      const sent = requests[0].body;
      assert.equal(sent.model, LAB_PRIMARY_MODEL);
      assert.equal(sent.max_completion_tokens, 2000);
      assert.equal(sent.reasoning_effort, 'none');
      assert.equal(sent.reasoning_format, 'hidden');
      assert.equal(Object.hasOwn(sent, 'include_reasoning'), false);
      assert.equal(Object.hasOwn(sent, 'safety_identifier'), false);
      assert.equal(sent.user, 'synthetic-user-hash');
      assert.deepEqual(sent.messages, original.messages);
      assert.equal(original.max_completion_tokens, 6000);
      assert.equal(original.reasoning_effort, 'high');
      assert.equal(original.include_reasoning, true);
      assert.equal(original.safety_identifier, 'synthetic-user-hash');
      await modelClient.chat.completions.create({ model: LAB_PRIMARY_MODEL, messages: [], max_completion_tokens: 1500 });
      assert.equal(requests[1].body.max_completion_tokens, 1500);
    });
  });
});

test('text requests enforce the free output budget and GPT-OSS compatible reasoning settings', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const modelClient = await avalaiClient(fixture());
    await sdkCalls(modelClient, async requests => {
      const original = { model: LAB_INTERPRETATION_MODEL, messages: [{ role: 'user', content: 'synthetic verified lab values' }],
        max_completion_tokens: 10000, reasoning_format: 'raw', reasoning_effort: 'high', include_reasoning: true, user: 'existing-hash' };
      await modelClient.chat.completions.create(original);
      const sent = requests[0].body;
      assert.equal(sent.max_completion_tokens, 3000);
      assert.equal(sent.reasoning_effort, 'low');
      assert.equal(sent.include_reasoning, false);
      assert.equal(Object.hasOwn(sent, 'reasoning_format'), false);
      assert.equal(sent.user, 'existing-hash');
      assert.equal(original.reasoning_format, 'raw');
      assert.equal(original.include_reasoning, true);
      assert.equal(original.max_completion_tokens, 10000);
      await modelClient.chat.completions.create({ model: LAB_INTERPRETATION_MODEL, messages: [], max_completion_tokens: 1200 });
      assert.equal(requests[1].body.max_completion_tokens, 1200);
    });
  });
});

test('default budgets and nonstring safety identifiers produce documented request fields', async () => {
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const modelClient = await avalaiClient(fixture());
    await sdkCalls(modelClient, async requests => {
      for (const model of [LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL]) {
        await modelClient.chat.completions.create({ model, messages: [], safety_identifier: { private: 'synthetic' } });
      }
      assert.deepEqual(requests.map(request => request.body.max_completion_tokens), [2000, 3000]);
      assert.ok(requests.every(request => !Object.hasOwn(request.body, 'safety_identifier')));
      assert.ok(requests.every(request => !Object.hasOwn(request.body, 'user')));
    });
  });
});

test('extended timeouts, abort signals and request headers reach the SDK unchanged', async t => {
  const previousCreate = OpenAI.Chat.Completions.prototype.create;
  t.after(() => { OpenAI.Chat.Completions.prototype.create = previousCreate; });
  let captured;
  OpenAI.Chat.Completions.prototype.create = async function(payload, options) { captured = { payload, options }; return { choices: [] }; };
  await withConfiguration({ GROQ_API_KEY: environmentKey, FREE_AI_ACCOUNT_CONFIRMED: 'true' }, async () => {
    const modelClient = await avalaiClient(fixture());
    const options = { timeout: 80000, signal: new AbortController().signal, headers: { 'x-lab-test': 'synthetic' } };
    await modelClient.chat.completions.create({ model: LAB_PRIMARY_MODEL, messages: [] }, options);
    assert.equal(captured.options, options);
    assert.equal(captured.payload.model, LAB_PRIMARY_MODEL);
  });
});
