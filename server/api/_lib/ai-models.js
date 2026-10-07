import OpenAI from 'openai';

export const AI_BASE_URL = process.env.AVALAI_BASE_URL || 'https://api.avalai.ir/v1';
export const AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

const avalaiKey = process.env.AVALAI_API_KEY || '';
const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
export const AI_PROVIDER = avalaiKey ? 'avalai' : gatewayKey ? 'vercel-ai-gateway' : 'unconfigured';

function selected(avalaiModel, gatewayModel) {
  return AI_PROVIDER === 'vercel-ai-gateway' ? gatewayModel : avalaiModel;
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

// Kept under the existing name so current handlers do not need a risky broad refactor.
export function avalaiClient() {
  if (avalaiKey) return new OpenAI({ apiKey: avalaiKey, baseURL: AI_BASE_URL });
  if (gatewayKey) return new OpenAI({ apiKey: gatewayKey, baseURL: AI_GATEWAY_BASE_URL });
  return null;
}

export function configuredModels() {
  return {
    provider: AI_PROVIDER,
    lab: LAB_PRIMARY_MODEL,
    lab_fallback: LAB_FALLBACK_MODEL,
    navigator: HEALTH_NAVIGATOR_MODEL,
    navigator_fallback: HEALTH_NAVIGATOR_FALLBACK_MODEL,
    support: SUPPORT_MODEL,
    support_fallback: SUPPORT_FALLBACK_MODEL
  };
}
