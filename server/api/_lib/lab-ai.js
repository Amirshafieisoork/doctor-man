import { validateLabResult } from './lab-validation.js';
import { LAB_INTERPRETATION_MODEL } from './ai-models.js';

export const LAB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['normal', 'warning', 'danger'] },
    status_reason: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    read_quality: { type: 'string', enum: ['good', 'partial', 'poor'] },
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          unit: { type: 'string' },
          reference_range: { type: 'string' },
          flag: { type: 'string', enum: ['normal', 'low', 'high', 'critical', 'unknown'] },
          explanation: { type: 'string' }
        },
        required: ['name', 'value', 'unit', 'reference_range', 'flag', 'explanation']
      }
    },
    abnormal_items: { type: 'array', items: { type: 'string' } },
    next_steps: { type: 'array', items: { type: 'string' } },
    when_to_seek_care: { type: 'string' },
    full_text: { type: 'string' }
  },
  required: ['status', 'status_reason', 'confidence', 'read_quality', 'summary', 'items', 'abnormal_items', 'next_steps', 'when_to_seek_care', 'full_text']
};

function normalizeResult(value) {
  if (!value || typeof value !== 'object') return null;
  const status = ['normal', 'warning', 'danger'].includes(value.status) ? value.status : 'warning';
  const confidence = Math.max(0, Math.min(1, Number(value.confidence ?? 0.5)));
  return {
    ...value,
    status,
    confidence,
    status_reason: String(value.status_reason || '').slice(0, 1200),
    summary: String(value.summary || '').slice(0, 4000),
    full_text: String(value.full_text || '').slice(0, 30000),
    items: Array.isArray(value.items) ? value.items.slice(0, 120) : [],
    abnormal_items: Array.isArray(value.abnormal_items) ? value.abnormal_items.slice(0, 60) : [],
    next_steps: Array.isArray(value.next_steps) ? value.next_steps.slice(0, 20) : []
  };
}

export async function callLabModel(client, model = LAB_INTERPRETATION_MODEL, content, safetyIdentifier, options = {}) {
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: `تو موتور تفسیر آموزشی آزمایش DrMan هستی. اول فقط آنچه واقعاً از برگه قابل خواندن است استخراج کن، سپس تفسیر آموزشی و محافظه‌کارانه ارائه بده.\n\nقواعد ایمنی:\n- تشخیص قطعی، نسخه، تغییر دارو یا دوز، یا تضمین پزشکی ممنوع است.\n- هیچ عدد، نام آزمایش، واحد یا محدوده مرجع ناخوانا را حدس نزن.\n- محدوده مرجع چاپ‌شده روی همان برگه بر دانش عمومی مقدم است.\n- status=danger فقط وقتی مجاز است که داده خوانا، به‌طور واضح بسیار غیرطبیعی/بحرانی باشد یا برگه خودش علامت critical داشته باشد؛ صرفاً براساس احتمال یا علائم مبهم danger نده.\n- برای نتیجه‌ای که با علائم شدید، بارداری، کودک، سالمند یا بیماری زمینه‌ای حساس می‌شود، به ارزیابی پزشک ارجاع بده.\n- مکمل، گیاه دارویی یا داروی خاص تجویز نکن.\n- اگر کیفیت تصویر ناکافی است، read_quality را partial/poor بگذار و محدودیت را واضح بنویس.\n- full_text فارسی، ساده، ساختاریافته و شامل خلاصه، موارد مهم، قدم بعدی و زمان مراجعه باشد.\n- نتیجه آموزشی است و جای تشخیص یا درمان پزشک را نمی‌گیرد.`
      },
      { role: 'user', content }
    ],
    max_completion_tokens: 3000,
    reasoning_effort: 'low',
    include_reasoning: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'drman_lab_analysis', strict: true, schema: LAB_SCHEMA }
    },
    user: safetyIdentifier
  };
  return client.chat.completions.create(payload, { timeout: 110000, ...options });
}

function failure(code) { const error = new Error(code); error.code = code; return error; }
export function parseLabCompletion(response) {
  const choice = response?.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw failure('AI_REFUSED');
  if (choice?.finish_reason === 'length') throw failure('AI_OUTPUT_TRUNCATED');
  const raw = choice?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw failure('AI_RESPONSE_EMPTY');
  let value;
  try { value = JSON.parse(raw); } catch { throw failure('AI_RESPONSE_INVALID'); }
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || !['normal', 'warning', 'danger'].includes(value.status)
    || !['good', 'partial', 'poor'].includes(value.read_quality)
    || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || !Array.isArray(value.items) || !Array.isArray(value.next_steps)
    || typeof value.full_text !== 'string' || !value.full_text.trim()
    || value.items.some(item => !item || !['normal','low','high','critical','unknown'].includes(item.flag)
      || ['name','value','unit','reference_range','explanation'].some(key => typeof item[key] !== 'string'))) {
    throw failure('AI_RESPONSE_INVALID');
  }
  return validateLabResult(normalizeResult(value));
}

export function labErrorResponse(error, stage = 'provider') {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return { status: 503, code: 'AI_AUTH_UNAVAILABLE', message: 'اتصال سرویس هوش مصنوعی نیاز به بررسی مدیر دارد. تصویر ذخیره‌شده را در پرونده سلامت می‌توانید ببینید.' };
  if (status === 402) return { status: 503, code: 'FREE_ACCOUNT_UNAVAILABLE', message: 'تنظیمات حساب رایگان سرویس نیاز به بررسی مدیر دارد. تصویر ذخیره‌شده در پرونده سلامت در دسترس است.' };
  if (status === 429) return { status: 503, code: 'FREE_RATE_LIMIT', message: 'سهمیه دقیقه‌ای یا روزانه سرویس رایگان پر شده است. بعداً دوباره تلاش کنید؛ تصویر ذخیره‌شده در پرونده سلامت باقی می‌ماند.' };
  if (error?.code === 'FREE_INPUT_LIMIT') return { status: 413, code: 'FREE_INPUT_LIMIT', message: 'این مجموعه برای تحلیل با سهمیه رایگان بزرگ است. برگه‌ها را در چند نوبت با صفحات کمتر تحلیل کنید؛ اصل تصاویر در پرونده سلامت ذخیره شده است.' };
  if (['APIConnectionTimeoutError', 'TimeoutError', 'AbortError'].includes(error?.name) || error?.code === 'AI_TIMEOUT') return { status: 504, code: 'AI_TIMEOUT', message: 'تفسیر بیشتر از زمان مجاز طول کشید. کمی بعد دوباره تلاش کنید؛ تصویر ذخیره‌شده در پرونده سلامت در دسترس است.' };
  if (error?.code === 'AI_REFUSED') return { status: 422, code: 'AI_REFUSED', message: 'این تصویر توسط سرویس قابل تفسیر نبود. یک برگه آزمایش خوانا انتخاب کنید.' };
  if (['AI_OUTPUT_TRUNCATED','AI_RESPONSE_EMPTY','AI_RESPONSE_INVALID','AI_GROUNDING_FAILED'].includes(error?.code)) return { status: 502, code: 'AI_RESPONSE_INVALID', message: 'پاسخ کامل و قابل‌اعتماد از هوش مصنوعی دریافت نشد. دوباره تلاش کنید؛ تصویر ذخیره‌شده در پرونده سلامت باقی می‌ماند.' };
  if (stage === 'persist' || stage === 'storage') return { status: 503, code: 'ANALYSIS_SAVE_FAILED', message: 'ثبت نتیجه تحلیل انجام نشد. دوباره تلاش کنید؛ اصل تصویر ذخیره‌شده را در پرونده سلامت بررسی کنید.' };
  return { status: 503, code: 'AI_UNAVAILABLE', message: 'سرویس تحلیل موقتاً پاسخ نداد. کمی بعد دوباره تلاش کنید؛ اصل تصویر ذخیره‌شده در پرونده سلامت در دسترس است.' };
}

export async function analyzeLabImages(client, content, safetyIdentifier) {
  const { analyzeFreeLabImages } = await import('./free-lab-ai.js');
  return analyzeFreeLabImages(client, content, safetyIdentifier);
}
