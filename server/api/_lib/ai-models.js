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
  } catch (error) {
    console.error('vercel oidc token unavailable', error?.message || error);
    return '';
  }
}

// Existing name is retained to avoid a broad handler refactor.
// It now resolves Vercel OIDC at request time so Preview/Production can use AI Gateway securely.
export async function avalaiClient() {
  if (avalaiKey) return new OpenAI({ apiKey: avalaiKey, baseURL: AI_BASE_URL });
  const token = await runtimeGatewayToken();
  if (token) return new OpenAI({ apiKey: token, baseURL: AI_GATEWAY_BASE_URL });
  return null;
}

export async function configuredModels() {
  const provider = avalaiKey ? 'avalai' : (await runtimeGatewayToken()) ? 'vercel-ai-gateway' : 'unconfigured';
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
