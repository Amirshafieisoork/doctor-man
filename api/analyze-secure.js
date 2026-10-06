import OpenAI from 'openai';
import Busboy from 'busboy';
import { requireUser } from './_lib/session.js';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AVALAI_KEY = process.env.AVALAI_API_KEY;
const MAX_IMAGES = 4;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

if (!SUPABASE_URL || !SUPABASE_KEY || !AVALAI_KEY) throw new Error('Server configuration is missing');

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: MAX_IMAGES, fileSize: MAX_FILE_SIZE, fields: 12 } });
    const fields = {};
    const images = [];
    let invalidFile = false;

    busboy.on('field', (name, value) => { fields[name] = String(value).slice(0, 1000); });
    busboy.on('file', (_name, file, info) => {
      const chunks = [];
      const mimeType = info?.mimeType || '';
      if (!allowedTypes.has(mimeType)) invalidFile = true;
      file.on('limit', () => { invalidFile = true; });
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => {
        if (!invalidFile && images.length < MAX_IMAGES) images.push({ buffer: Buffer.concat(chunks), mimeType });
      });
    });
    busboy.on('finish', () => invalidFile ? reject(new Error('فرمت یا حجم تصویر مجاز نیست')) : resolve({ fields, images }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function extractJson(text) {
  try {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireUser(req, res);
  if (!session) return;

  try {
    const { fields, images } = await parseForm(req);
    if (!images.length) return res.status(400).json({ success: false, error: 'حداقل یک تصویر باید ارسال شود' });

    const age = String(fields.age || '').trim();
    const gender = String(fields.gender || '').trim().slice(0, 20);
    const reason = String(fields.reason || '').trim().slice(0, 500);
    if (age && (!/^\d{1,3}$/.test(age) || Number(age) < 1 || Number(age) > 120)) {
      return res.status(400).json({ success: false, error: 'سن واردشده معتبر نیست' });
    }

    const imageDataUrls = images.map(img => `data:${img.mimeType};base64,${img.buffer.toString('base64')}`);
    const openai = new OpenAI({ apiKey: AVALAI_KEY, baseURL: 'https://api.avalai.ir/v1' });

    const prompt = `تو یک دستیار آموزشی سلامت هستی. تصاویر، برگه آزمایش پزشکی یک کاربر هستند. اطلاعات بیمار: سن ${age || 'نامشخص'}، جنسیت ${gender || 'نامشخص'}، علت آزمایش ${reason || 'ذکر نشده'}.

تمام صفحات را با هم بررسی کن و فقط JSON معتبر با ساختار زیر برگردان:
{"status":"normal|warning|danger","status_reason":"...","full_text":"..."}

قواعد:
- هیچ تشخیص قطعی، نسخه دارویی، تغییر دوز، یا تضمین پزشکی ارائه نکن.
- اگر تصویر ناخوانا یا داده‌ای نامطمئن است، صریحاً بگو و مقدار را حدس نزن.
- محدوده مرجع چاپ‌شده روی خود برگه را بر محدوده عمومی مقدم بدان.
- status=danger فقط وقتی استفاده شود که مقدار یا ترکیبی از مقادیر در خود برگه به شکل واضح بسیار غیرطبیعی است یا متن برگه هشدار جدی دارد؛ در این حالت توصیه به ارزیابی فوری پزشکی بده، نه تشخیص بیماری.
- full_text فارسی، روشن و ساختارمند باشد و این بخش‌ها را داشته باشد: خلاصه، بررسی تک‌تک مقادیر قابل‌خواندن، موارد خارج از محدوده، توصیه‌های عمومی کم‌خطر، زمان مناسب مراجعه به پزشک، و یادآوری اینکه تفسیر آموزشی است و جای پزشک را نمی‌گیرد.
- برای هر آیتم قابل‌خواندن: نام، مقدار، محدوده مرجع درج‌شده، وضعیت، و توضیح کوتاه را ذکر کن.
- از توصیه گیاه دارویی، مکمل یا داروی مشخص خودداری کن مگر صرفاً بگویی قبل از مصرف با پزشک/داروساز مشورت شود.
- اگر داده کافی نیست، همین را در status_reason و full_text منعکس کن.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: [
        ...imageDataUrls.map(url => ({ type: 'image_url', image_url: { url } })),
        { type: 'text', text: prompt }
      ] }],
      max_tokens: 3500,
      temperature: 0.2
    });

    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = extractJson(raw);
    const allowedStatus = new Set(['normal', 'warning', 'danger']);
    const status = allowedStatus.has(parsed?.status) ? parsed.status : 'warning';
    const analysis = String(parsed?.full_text || raw || 'نتیجه قابل پردازش نبود').slice(0, 30000);
    const statusReason = String(parsed?.status_reason || '').slice(0, 1000);

    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/test_results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        user_id: session.sub,
        age: age || null,
        gender: gender || null,
        reason: reason || null,
        analysis,
        status,
        image_url: null,
        images_base64: imageDataUrls
      })
    });

    if (!saveRes.ok) console.error('Failed to save lab result', saveRes.status, await saveRes.text());

    return res.status(200).json({ success: true, analysis, status, status_reason: statusReason });
  } catch (error) {
    console.error('analyze-secure', error);
    return res.status(500).json({ success: false, error: 'تحلیل آزمایش انجام نشد. لطفاً دوباره تلاش کنید.' });
  }
}
