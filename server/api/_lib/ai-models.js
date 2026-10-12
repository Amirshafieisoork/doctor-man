import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';

export const AI_BASE_URL = process.env.AVALAI_BASE_URL || 'https://api.avalai.ir/v1';
export const AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

const avalaiKey = process.env.AVALAI_API_KEY || '';
const gatewayKey = process.env.AI_GATEWAY_API_KEY || '';
const useGatewayModels = !avalaiKey;

function selected(avalaiModel, gatewayModel) {
  return useGatewayModels ? gatewayModel : avalaiModel;
}

export const LAB_PRIMARY_MODEL = selected(
  process.env.LAB_MODEL || 'gpt-6.1-sol',
  process.env.GATEWAY_LAB_MODEL || 'openai/gpt-5.6-sol'
);
export const LAB_FALLBACK_MODEL = selected(
  process.env.LAB_FALLBACK_MODEL || 'gpt-5.6-sol',
  process.env.GATEWAY_LAB_FALLBACK_MODEL || 'openai/gpt-5.6-terra'
);

export const HEALTH_NAVIGATOR_MODEL = selected(
  process.env.HEALTH_NAVIGATOR_MODEL || 'gpt-6.1-sol',
  process.env.GATEWAY_HEALTH_NAVIGATOR_MODEL || 'openai/gpt-5.6-sol'
);
export const HEALTH_NAVIGATOR_FALLBACK_MODEL = selected(
  process.env.HEALTH_NAVIGATOR_FALLBACK_MODEL || 'gpt-5.6-terra',
  process.env.GATEWAY_HEALTH_NAVIGATOR_FALLBACK_MODEL || 'openai/gpt-5.6-terra'
);

export const SUPPORT_MODEL = selected(
  process.env.SUPPORT_MODEL || 'gpt-6-luna',
  process.env.GATEWAY_SUPPORT_MODEL || 'openai/gpt-5.6-luna'
);
export const SUPPORT_FALLBACK_MODEL = selected(
  process.env.SUPPORT_FALLBACK_MODEL || 'gpt-5.6-luna',
  process.env.GATEWAY_SUPPORT_FALLBACK_MODEL || 'openai/gpt-5.6-terra'
);

async function runtimeGatewayToken() {
  if (gatewayKey) return gatewayKey;
  try {
    return (await getVercelOidcToken()) || '';
  } catch {
    return '';
  }
}

let catalogCache;
async function gatewayModels(token) {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.ids;
  const response = await fetch(`${AI_GATEWAY_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('AI_MODEL_CATALOG_UNAVAILABLE');
  const body = await response.json();
  const ids = new Set((Array.isArray(body.data) ? body.data : [])
    .map(model => model?.id).filter(id => typeof id === 'string' && id));
  if (!ids.size) throw new Error('AI_MODEL_CATALOG_UNAVAILABLE');
  catalogCache = { ids, expires: Date.now() + 10 * 60 * 1000 };
  return ids;
}
async function resolvedGatewayModels(token) {
  const ids = await gatewayModels(token);
  const choose = (explicit, candidates) => {
    if (explicit) {
      if (!ids.has(explicit)) throw new Error('AI_MODEL_NOT_AVAILABLE');
      return explicit;
    }
    const model = candidates.find(candidate => ids.has(candidate));
    if (!model) throw new Error('AI_MODEL_NOT_AVAILABLE');
    return model;
  };
  // Candidate names are only used after the current model catalog confirms
  // availability. The lab choices support image input and structured output.
  const lab = choose(process.env.GATEWAY_LAB_MODEL, [LAB_PRIMARY_MODEL, 'openai/gpt-5.2', 'openai/gpt-5.1', 'openai/gpt-4.1']);
  // A second model is useful, but its absence must not disable an available
  // primary. Using the primary last also keeps shared legacy model aliases
  // consistent when an administrator explicitly chooses the same model.
  const fallback = choose(process.env.GATEWAY_LAB_FALLBACK_MODEL, [LAB_FALLBACK_MODEL, 'openai/gpt-4.1', 'openai/gpt-5.2', lab]);
  const navigator = choose(process.env.GATEWAY_HEALTH_NAVIGATOR_MODEL, [HEALTH_NAVIGATOR_MODEL, lab]);
  const navigatorFallback = choose(process.env.GATEWAY_HEALTH_NAVIGATOR_FALLBACK_MODEL, [HEALTH_NAVIGATOR_FALLBACK_MODEL, fallback]);
  const support = choose(process.env.GATEWAY_SUPPORT_MODEL, [SUPPORT_MODEL, 'openai/gpt-4.1-mini', 'openai/gpt-5-mini', lab]);
  const supportFallback = choose(process.env.GATEWAY_SUPPORT_FALLBACK_MODEL, [SUPPORT_FALLBACK_MODEL, fallback]);
  return { lab, lab_fallback: fallback, navigator, navigator_fallback: navigatorFallback, support, support_fallback: supportFallback };
}

// Existing name is retained to avoid a broad handler refactor.
// It now resolves Vercel OIDC at request time so Preview/Production can use AI Gateway securely.
export async function avalaiClient() {
  const options = { timeout: 20000, maxRetries: 0 };
  if (avalaiKey) return new OpenAI({ apiKey: avalaiKey, baseURL: AI_BASE_URL, ...options });
  const token = await runtimeGatewayToken();
  if (token) {
    let models;
    try { models = await resolvedGatewayModels(token); }
    catch { return null; }
    const client = new OpenAI({ apiKey: token, baseURL: AI_GATEWAY_BASE_URL, ...options });
    const create = client.chat.completions.create.bind(client.chat.completions);
    const mapping = new Map([
      [LAB_PRIMARY_MODEL, models.lab], [LAB_FALLBACK_MODEL, models.lab_fallback],
      [HEALTH_NAVIGATOR_MODEL, models.navigator], [HEALTH_NAVIGATOR_FALLBACK_MODEL, models.navigator_fallback],
      [SUPPORT_MODEL, models.support], [SUPPORT_FALLBACK_MODEL, models.support_fallback]
    ]);
    client.chat.completions.create = (body, requestOptions) => create({ ...body, model: mapping.get(body.model) || body.model }, requestOptions);
    return client;
  }
  return null;
}

export async function configuredModels() {
  if (!avalaiKey) {
    const token = await runtimeGatewayToken();
    if (token) {
      try { return { provider: 'vercel-ai-gateway', ...(await resolvedGatewayModels(token)) }; }
      catch { return { provider: 'unconfigured' }; }
    }
    return { provider: 'unconfigured' };
  }
  const provider = 'avalai';
  return {
    provider,
    lab: LAB_PRIMARY_MODEL,
    lab_fallback: LAB_FALLBACK_MODEL,
    navigator: HEALTH_NAVIGATOR_MODEL,
    navigator_fallback: HEALTH_NAVIGATOR_FALLBACK_MODEL,
    support: SUPPORT_MODEL,
    support_fallback: SUPPORT_FALLBACK_MODEL
  };
}
