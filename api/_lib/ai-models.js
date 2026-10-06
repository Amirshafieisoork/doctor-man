import OpenAI from 'openai';

export const AI_BASE_URL = process.env.AVALAI_BASE_URL || 'https://api.avalai.ir/v1';
export const LAB_PRIMARY_MODEL = process.env.LAB_MODEL || 'gpt-5.6-sol';
export const LAB_FALLBACK_MODEL = process.env.LAB_FALLBACK_MODEL || 'gpt-5.6-terra';
export const HEALTH_NAVIGATOR_MODEL = process.env.HEALTH_NAVIGATOR_MODEL || 'gpt-5.6-terra';
export const SUPPORT_MODEL = process.env.SUPPORT_MODEL || 'gpt-5.6-luna';

export function avalaiClient() {
  const apiKey = process.env.AVALAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: AI_BASE_URL });
}

export function configuredModels() {
  return {
    lab: LAB_PRIMARY_MODEL,
    lab_fallback: LAB_FALLBACK_MODEL,
    navigator: HEALTH_NAVIGATOR_MODEL,
    support: SUPPORT_MODEL
  };
}
