import OpenAI from 'openai';
import Busboy from 'busboy';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export const config = { api: { bodyParser: false } };

const AVALAI_KEY = process.env.AVALAI_API_KEY;
const MAX_IMAGES = 4;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
if (!AVALAI_KEY) throw new Error('AVALAI_API_KEY is missing');

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

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function getEntitlement(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('status,plan_expires_at,plans(id,name,slug,test_limit)')
    .eq('id', userId)
    .single();
  if (error || !user) throw new Error('USER_NOT_FOUND');
  if (user.status === 'blocked') throw new Error('USER_BLOCKED');

  let plan = user.plans;
  if (!plan || (user.plan_expires_at && new Date(user.plan_expires_at) < new Date())) {
    const { data: freePlan } = await supabase.from('plans').select('id,name,slug,test_limit').eq('slug', 'free').single();
    plan = freePlan;
    if (freePlan) {
      await supabase.from('users').update({ plan_id: freePlan.id, plan_started_at: new Date().toISOString(), plan_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).eq('id', userId);
    }
  }

  const { count } = await supabase.from('test_results').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', monthStart());
  const used = Number(count || 0);
  const limit = Number(plan?.test_limit ?? 2);
  if (limit >= 0 && used >= limit) {
    const error = new Error('QUOTA_EXCEEDED');
    error.plan = plan;
    error.used = used;
    throw error;
  }
  return { plan, used, remaining: limit < 0 ? null : Math.max(0, limit - used) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireUser(req, res);
  if (!session) return;

  try {
    const entitlement = await getEntitlement(session.sub);
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
    const prompt = `تو دستیار آموزشی سلامت DrMan هستی. تصاویر، برگه آزمایش پزشکی کاربر هستند. اطلاعات: سن ${age || 'نامشخص'}، جنسیت ${gender || 'نامشخص'}، علت آزمایش ${reason || 'ذکر نشده'}.
فقط JSON معتبر برگردان: {"status":"normal|warning|danger","status_reason":"...","full_text":"..."}
قواعد: تشخیص قطعی، نسخه، تغییر دوز یا تضمین پزشکی نده. مقدار ناخوانا را حدس نزن. محدوده مرجع خود برگه مقدم است. status=danger فقط برای وضعیت واضحاً بسیار غیرطبیعی/هشداردهنده استفاده شود. متن فارسی و شامل خلاصه، بررسی آیتم‌های قابل‌خواندن، موارد خارج محدوده، توصیه‌های عمومی کم‌خطر، زمان مراجعه به پزشک و یادآوری آموزشی بودن تفسیر باشد.`;

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

    const { error: saveError } = await supabase.from('test_results').insert({
      user_id: session.sub,
      age: age || null,
      gender: gender || null,
      reason: reason || null,
      analysis,
      status,
      image_url: null,
      images_base64: imageDataUrls
    });
    if (saveError) console.error('Failed to save lab result', saveError);

    const remainingAfter = entitlement.remaining == null ? null : Math.max(0, entitlement.remaining - 1);
    return res.status(200).json({ success: true, analysis, status, status_reason: statusReason, plan: entitlement.plan?.name, remaining: remainingAfter });
  } catch (error) {
    console.error('analyze-secure', error);
    if (error.message === 'QUOTA_EXCEEDED') return res.status(402).json({ success: false, error: 'سهمیه تحلیل این ماه شما تمام شده است. برای ادامه پلن خود را ارتقا دهید.', code: 'QUOTA_EXCEEDED', plan: error.plan?.name });
    if (error.message === 'USER_BLOCKED') return res.status(403).json({ success: false, error: 'حساب کاربری شما غیرفعال شده است' });
    return res.status(500).json({ success: false, error: 'تحلیل آزمایش انجام نشد. لطفاً دوباره تلاش کنید.' });
  }
}
