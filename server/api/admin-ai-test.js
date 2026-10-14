import { readFile } from 'node:fs/promises';
import { requireAdmin } from './_lib/session.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { avalaiClient, LAB_PRIMARY_MODEL, LAB_INTERPRETATION_MODEL } from './_lib/ai-models.js';
import { analyzeLabImages, labErrorResponse } from './_lib/lab-ai.js';

const FIXTURE = new URL('./_fixtures/synthetic-lab-report.png', import.meta.url);
const EXPECTED = [
  { name: 'Hemoglobin', value: 10.2, flag: 'low' },
  { name: 'Creatinine', value: 0.9, flag: 'normal' },
  { name: 'LDL Cholesterol', value: 162, flag: 'high' },
  { name: 'Triglycerides', value: 140, flag: 'normal' }
];
const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
function exactNumber(value) {
  const normalized = String(value || '').normalize('NFKC').trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}

export function checkSyntheticLabResult(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const rows = EXPECTED.map(expected => {
    const matches = items.filter(item => normalizeName(item?.name) === normalizeName(expected.name));
    return matches.length === 1 && exactNumber(matches[0].value) === expected.value && matches[0].flag === expected.flag;
  });
  const readable = ['good', 'partial'].includes(parsed?.read_quality) && ['normal', 'warning'].includes(parsed?.status);
  const persian = typeof parsed?.full_text === 'string' && (parsed.full_text.match(/[\u0621-\u064a\u067e\u0686\u0698\u06a9\u06af\u06cc]/g)?.length || 0) >= 20;
  return {
    passed: items.length === EXPECTED.length && rows.every(Boolean) && readable && persian,
    checks_passed: rows.filter(Boolean).length + Number(readable) + Number(persian),
    checks_total: EXPECTED.length + 2,
    samples_checked: EXPECTED.length
  };
}

const TEST_MESSAGES = {
  AI_AUTH_UNAVAILABLE: 'کلید یا دسترسی حساب رایگان Groq تأیید نشد؛ کلید ذخیره‌شده را بررسی کنید.',
  FREE_ACCOUNT_UNAVAILABLE: 'دسترسی حساب رایگان Groq آماده نیست؛ وضعیت حساب Free را بررسی کنید.',
  FREE_RATE_LIMIT: 'سهمیه سرویس رایگان پر شده است. کمی بعد آزمون را دوباره اجرا کنید.',
  FREE_INPUT_LIMIT: 'تصویر آزمایشی در محدودیت فعلی سرویس رایگان قابل پردازش نبود.',
  AI_TIMEOUT: 'آزمون در زمان مجاز کامل نشد. کمی بعد دوباره تلاش کنید.',
  AI_REFUSED: 'سرویس هوش مصنوعی تصویر آزمایشی را نپذیرفت.',
  AI_RESPONSE_INVALID: 'آزمون پاسخ کامل و قابل‌اعتماد دریافت نکرد. کمی بعد دوباره تلاش کنید.'
};

// Injection is limited to server code for SDK-boundary tests, never request input.
export function createAdminAITestHandler({ getClient = avalaiClient, analyze = analyzeLabImages, loadFixture = () => readFile(FIXTURE) } = {}) {
  let activeTest = false;
  return async function handler(req, res) {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    if (activeTest) return res.status(409).json({ success: false, code: 'AI_TEST_IN_PROGRESS', error: 'آزمون اتصال در حال اجرا است؛ منتظر نتیجه بمانید.' });
    activeTest = true;
    const started = Date.now();
    try {
      const client = await getClient();
      if (!client) return res.status(503).json({ success: false, code: 'FREE_AI_NOT_CONFIGURED', error: 'ابتدا کلید API حساب رایگان Groq را ذخیره و حساب Free را تأیید کنید.' });
      const image = await loadFixture();
      if (!Buffer.isBuffer(image) || image.length < 8 || image.length > 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('AI_TEST_FIXTURE_UNAVAILABLE');
      const result = await analyze(client, [
        { type: 'text', text: 'این برگه کاملاً ساختگی و فقط برای آزمون اتصال است و اطلاعات بیمار واقعی ندارد. مقادیر چاپ‌شده را بخوان و تفسیر آموزشی فارسی ارائه بده.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}`, detail: 'high' } }
      ], 'drman-owner-free-connection-test');
      const checks = checkSyntheticLabResult(result?.parsed);
      if (!checks.passed) return res.status(502).json({ success: false, code: 'AI_TEST_CHECK_FAILED', error: 'آزمون تصویر ساختگی کامل نشد: خواندن دقیق مقادیر، پرچم‌ها و توضیح فارسی تأیید نشد. دوباره تلاش کنید.', ...checks });
      return res.status(200).json({
        success: true, free_only: true, provider: 'groq-free',
        checks_passed: checks.checks_passed, checks_total: checks.checks_total, samples_checked: checks.samples_checked,
        models: { vision: LAB_PRIMARY_MODEL, interpretation: LAB_INTERPRETATION_MODEL },
        elapsed_ms: Math.max(0, Date.now() - started)
      });
    } catch (error) {
      console.error('admin-ai-test', safeErrorMetadata(error));
      if (error?.message === 'AI_TEST_FIXTURE_UNAVAILABLE' || error?.code === 'ENOENT') {
        return res.status(503).json({ success: false, code: 'AI_TEST_FIXTURE_UNAVAILABLE', error: 'تصویر ساختگی آزمون روی سرور آماده نیست؛ تنظیمات انتشار باید بررسی شود.' });
      }
      const failure = labErrorResponse(error);
      return res.status(failure.status).json({ success: false, code: failure.code, error: TEST_MESSAGES[failure.code] || 'آزمون اتصال سرویس رایگان انجام نشد. کمی بعد دوباره تلاش کنید.' });
    } finally { activeTest = false; }
  };
}

export default createAdminAITestHandler();
