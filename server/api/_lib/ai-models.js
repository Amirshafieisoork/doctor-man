import OpenAI from 'openai';
import { readPrivateAISettings } from './private-ai-settings.js';

export const AI_BASE_URL = 'https://api.groq.com/openai/v1';
export const AI_GATEWAY_BASE_URL = AI_BASE_URL;
export const LAB_PRIMARY_MODEL = 'qwen/qwen3.8-27b';
export const LAB_FALLBACK_MODEL = LAB_PRIMARY_MODEL;
export const LAB_INTERPRETATION_MODEL = 'openai/gpt-oss-120b';
export const HEALTH_NAVIGATOR_MODEL = LAB_INTERPRETATION_MODEL;
export const HEALTH_NAVIGATOR_FALLBACK_MODEL = HEALTH_NAVIGATOR_MODEL;
export const SUPPORT_MODEL = LAB_INTERPRETATION_MODEL;
export const SUPPORT_FALLBACK_MODEL = SUPPORT_MODEL;
const ALLOWED_MODELS = new Set([LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL]);

async function freeConfiguration(database) {
  const stored = await readPrivateAISettings(database);
  // An explicitly cleared private key disables the connection, even if an
  // older environment key exists. No paid-provider credential is consumed.
  if (stored) return stored.free_only === true && stored.free_account_confirmed === true && stored.api_key ? stored : null;
  const key = process.env.FREE_AI_API_KEY || process.env.GROQ_API_KEY || '';
  if (!key || process.env.FREE_AI_ACCOUNT_CONFIRMED !== 'true') return null;
  return { provider: 'groq', free_only: true, free_account_confirmed: true, api_key: key };
}

// Keep the old exported name for existing doctor, support and care handlers.
export async function avalaiClient({ database } = {}) {
  let configuration;
  try { configuration = await freeConfiguration(database); } catch { return null; }
  if (!configuration) return null;
  const client = new OpenAI({ apiKey: configuration.api_key, baseURL: AI_BASE_URL, timeout: 20000, maxRetries: 0 });
  const create = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = (body, requestOptions) => {
    if (!ALLOWED_MODELS.has(body?.model)) {
      const error = new Error('FREE_MODEL_NOT_ALLOWED'); error.code = 'FREE_MODEL_NOT_ALLOWED'; throw error;
    }
    const payload = { ...body };
    if (typeof payload.safety_identifier === 'string') payload.user = payload.safety_identifier;
    delete payload.safety_identifier;
    if (payload.model === LAB_PRIMARY_MODEL) {
      payload.max_completion_tokens = Math.min(Number(payload.max_completion_tokens) || 2000, 2000);
      payload.reasoning_effort = 'none'; payload.reasoning_format = 'hidden'; delete payload.include_reasoning;
    } else {
      payload.max_completion_tokens = Math.min(Number(payload.max_completion_tokens) || 3000, 4500);
      payload.reasoning_effort = 'low'; payload.include_reasoning = false; delete payload.reasoning_format;
    }
    return create(payload, requestOptions);
  };
  return client;
}

export async function configuredModels({ database } = {}) {
  let configuration;
  try { configuration = await freeConfiguration(database); } catch { return { provider: 'unconfigured', free_only: true }; }
  if (!configuration) return { provider: 'unconfigured', free_only: true };
  return {
    provider: 'groq-free', free_only: true,
    lab: LAB_PRIMARY_MODEL, lab_interpreter: LAB_INTERPRETATION_MODEL, lab_fallback: LAB_FALLBACK_MODEL,
    navigator: HEALTH_NAVIGATOR_MODEL, navigator_fallback: HEALTH_NAVIGATOR_FALLBACK_MODEL,
    support: SUPPORT_MODEL, support_fallback: SUPPORT_FALLBACK_MODEL
  };
}
