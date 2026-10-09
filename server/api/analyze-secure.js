import { safeErrorMetadata } from './_lib/errors.js';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { avalaiClient, LAB_PRIMARY_MODEL, LAB_FALLBACK_MODEL } from './_lib/ai-models.js';
import { validateLabResult } from './_lib/lab-validation.js';
import { saveBiomarkers } from './_lib/biomarkers.js';
import { readEntitlement, planLimit } from './_lib/entitlements.js';
import { reserveLabAnalysisQuota, releaseLabAnalysisQuota } from './_lib/ai-quota.js';
import { matchesFileType } from './_lib/uploads.js';

export const config = { api: { bodyParser: false } };

const MAX_IMAGES = 4;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AI_VERSION = 'lab-v4-validated-2026-10';

const LAB_SCHEMA = {
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

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: MAX_IMAGES, fileSize: MAX_FILE_SIZE, fields: 16 } });
    const fields = {};
    const images = [];
    let invalidFile = false;
    let totalSize=0;
    busboy.on('field', (name, value) => { fields[name] = String(value).slice(0, 2000); });
    busboy.on('file', (_name, file, info) => {
      const chunks = [];
      const mimeType = info?.mimeType || '';
      let limited = false;
      if (!allowedTypes.has(mimeType)) invalidFile = true;
      file.on('limit', () => { limited = true; invalidFile = true; });
      file.on('data', chunk => {totalSize+=chunk.length;if(totalSize>MAX_TOTAL_SIZE)invalidFile=true;if(!limited&&totalSize<=MAX_TOTAL_SIZE)chunks.push(chunk);});
      file.on('end', () => {
        const buffer=Buffer.concat(chunks);
        if(!matchesFileType(buffer,mimeType))invalidFile=true;
        if (!limited && allowedTypes.has(mimeType) && images.length < MAX_IMAGES) images.push({ buffer, mimeType });
      });
      file.on('error',reject);
    });
    busboy.on('filesLimit', () => { invalidFile = true; });
    busboy.on('fieldsLimit', () => { invalidFile = true; });
    busboy.on('finish', () => invalidFile ? reject(new Error('INVALID_IMAGE')) : resolve({ fields, images }));
    busboy.on('error', reject);
    req.once('aborted',()=>reject(new Error('INVALID_IMAGE')));
    req.pipe(busboy);
  });
}

function ageFromBirthDate(value) {
  if (!value) return null;
  const birth = new Date(value);
  if (!Number.isFinite(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 120 ? age : null;
}

async function resolvePatient(userId, requestedId) {
  if (requestedId) {
    const { data } = await supabase.from('patients').select('id,display_name,birth_date,sex,blood_type').eq('id', requestedId).eq('owner_user_id', userId).maybeSingle();
    if (!data) throw new Error('PATIENT_NOT_FOUND');
    return data;
  }
  const { data } = await supabase.from('patients').select('id,display_name,birth_date,sex,blood_type').eq('owner_user_id', userId).eq('relation', 'self').order('created_at', { ascending: true }).limit(1).maybeSingle();
  return data || null;
}

async function getEntitlement(userId) {
  const {plan}=await readEntitlement(supabase,userId);
  return {plan,limit:planLimit(plan,'test_limit')};
}

async function uploadPrivateImages(userId, images) {
  const uploaded = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${i + 1}.${ext}`;
      const { error } = await supabase.storage.from('lab-images').upload(path, img.buffer, { contentType: img.mimeType, upsert: false, cacheControl: '3600' });
      if (error) throw error;
      uploaded.push(path);
    }
    return uploaded;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from('lab-images').remove(uploaded).catch(() => null);
    throw error;
  }
}

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

async function callLabModel(client, model, content, safetyIdentifier) {
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: `تو موتور تفسیر آموزشی آزمایش DrMan هستی. اول فقط آنچه واقعاً از برگه قابل خواندن است استخراج کن، سپس تفسیر آموزشی و محافظه‌کارانه ارائه بده.\n\nقواعد ایمنی:\n- تشخیص قطعی، نسخه، تغییر دارو یا دوز، یا تضمین پزشکی ممنوع است.\n- هیچ عدد، نام آزمایش، واحد یا محدوده مرجع ناخوانا را حدس نزن.\n- محدوده مرجع چاپ‌شده روی همان برگه بر دانش عمومی مقدم است.\n- status=danger فقط وقتی مجاز است که داده خوانا، به‌طور واضح بسیار غیرطبیعی/بحرانی باشد یا برگه خودش علامت critical داشته باشد؛ صرفاً براساس احتمال یا علائم مبهم danger نده.\n- برای نتیجه‌ای که با علائم شدید، بارداری، کودک، سالمند یا بیماری زمینه‌ای حساس می‌شود، به ارزیابی پزشک ارجاع بده.\n- مکمل، گیاه دارویی یا داروی خاص تجویز نکن.\n- اگر کیفیت تصویر ناکافی است، read_quality را partial/poor بگذار و محدودیت را واضح بنویس.\n- full_text فارسی، ساده، ساختاریافته و شامل خلاصه، موارد مهم، قدم بعدی و زمان مراجعه باشد.\n- نتیجه آموزشی است و جای تشخیص یا درمان پزشک را نمی‌گیرد.`
      },
      { role: 'user', content }
    ],
    max_completion_tokens: 4500,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'drman_lab_analysis', strict: true, schema: LAB_SCHEMA }
    },
    safety_identifier: safetyIdentifier
  };
  return client.chat.completions.create(payload);
}

async function analyze(client, content, safetyIdentifier) {
  const attempts = [LAB_PRIMARY_MODEL, LAB_FALLBACK_MODEL].filter((v, i, a) => v && a.indexOf(v) === i);
  let lastError;
  for (const model of attempts) {
    try {
      const response = await callLabModel(client, model, content, safetyIdentifier);
      const raw = response.choices?.[0]?.message?.content || '';
      const parsed = normalizeResult(JSON.parse(raw));
      if (!parsed) throw new Error('INVALID_AI_JSON');
      const validated = validateLabResult(parsed);
      return { parsed: validated, model: response.model || model, requestId: response._request_id || null };
    } catch (error) {
      lastError = error;
      console.error('lab model attempt failed', model, safeErrorMetadata(error));
    }
  }
  throw lastError || new Error('AI_ANALYSIS_FAILED');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req, res);
  if (!session) return;
  if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('multipart/form-data;'))return res.status(415).json({success:false,error:'تصاویر باید به شکل فایل ارسال شوند'});
  const client = await avalaiClient();
  if (!client) return res.status(503).json({ success: false, error: 'سرویس هوش مصنوعی هنوز تنظیم نشده است' });

  let storedPaths = [];
  let reservation=null;
  let selectedPlan=null;
  try {
    const entitlement = await getEntitlement(session.sub);
    selectedPlan=entitlement.plan;
    const { fields, images } = await parseForm(req);
    if (!images.length) return res.status(400).json({ success: false, error: 'حداقل یک تصویر باید ارسال شود' });
    if(fields.ai_consent!=='true')return res.status(428).json({success:false,code:'AI_CONSENT_REQUIRED',error:'برای تحلیل آزمایش، رضایت پردازش هوش مصنوعی لازم است'});

    const patient = await resolvePatient(session.sub, String(fields.patient_id || '').trim());
    if(!patient)throw new Error('PATIENT_NOT_FOUND');
    const enteredAge = String(fields.age || '').trim();
    if (enteredAge && (!/^\d{1,3}$/.test(enteredAge) || Number(enteredAge) < 0 || Number(enteredAge) > 120)) return res.status(400).json({ success: false, error: 'سن واردشده معتبر نیست' });
    const derivedAge = ageFromBirthDate(patient?.birth_date);
    const age = derivedAge ?? (enteredAge ? Number(enteredAge) : null);
    const gender = String(patient?.sex || fields.gender || 'نامشخص').slice(0, 40);
    const reason = String(fields.reason || '').trim().slice(0, 500);

    const {error:consentError}=await supabase.from('consent_records').insert({patient_id:patient.id,user_id:session.sub,consent_type:'ai_processing',version:'lab-upload-v1',granted:true,metadata:{source:'lab_upload'}});
    if(consentError)throw consentError;
    reservation=await reserveLabAnalysisQuota(supabase,session.sub,{limit:entitlement.limit});

    const contextText = `پرونده: ${patient?.display_name || 'پرونده اصلی کاربر'}\nسن: ${age ?? 'نامشخص'}\nجنس/sex: ${gender}\nگروه خونی ثبت‌شده: ${patient?.blood_type || 'نامشخص'}\nعلت آزمایش: ${reason || 'ذکر نشده'}\n\nاین تصاویر صفحات یک مجموعه آزمایش هستند. همه صفحات را با هم در نظر بگیر.`;
    const content = [
      { type: 'text', text: contextText },
      ...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`, detail: 'high' } }))
    ];
    const safetyIdentifier = crypto.createHash('sha256').update(`drman:${session.sub}`).digest('hex').slice(0, 32);
    const { parsed, model, requestId } = await analyze(client, content, safetyIdentifier);

    storedPaths = await uploadPrivateImages(session.sub, images);
    const insert = {
      user_id: session.sub,
      patient_id: patient?.id || null,
      age: age == null ? null : String(age),
      gender,
      reason: reason || null,
      analysis: parsed.full_text,
      status: parsed.status,
      status_reason: parsed.status_reason,
      structured_analysis: parsed,
      ai_model: model,
      ai_version: AI_VERSION,
      ai_confidence: parsed.confidence,
      image_url: null,
      images_base64: null,
      image_paths: storedPaths,
      created_at:reservation.reservedAt
    };
    const { data: saved, error: saveError } = await supabase.from('test_results').insert(insert).select('id').single();
    if (saveError) { await supabase.storage.from('lab-images').remove(storedPaths); throw saveError; }
    await saveBiomarkers(supabase,{testResultId:saved?.id,patientId:patient?.id||null,userId:session.sub,items:parsed.items,confidence:parsed.confidence,observedAt:new Date().toISOString()}).catch(e=>console.error('biomarker save',safeErrorMetadata(e)));

    await supabase.from('audit_logs').insert({
      actor_user_id: session.sub,
      actor_type: 'user',
      patient_id: patient?.id || null,
      action: 'lab.ai_analyzed',
      resource_type: 'test_result',
      resource_id: saved?.id || null,
      metadata: { model, version: AI_VERSION, request_id: requestId, read_quality: parsed.read_quality, confidence: parsed.confidence }
    }).catch(() => null);

    const remainingAfter = reservation.remaining;
    return res.status(200).json({
      success: true,
      analysis: parsed.full_text,
      structured: parsed,
      status: parsed.status,
      status_reason: parsed.status_reason,
      confidence: parsed.confidence,
      read_quality: parsed.read_quality,
      model,
      result_id: saved?.id || null,
      patient_id: patient?.id || null,
      plan: entitlement.plan?.name,
      remaining: remainingAfter
    });
  } catch (error) {
    console.error('analyze-secure',safeErrorMetadata(error));
    if (error.message === 'INVALID_IMAGE') return res.status(400).json({ success: false, error: 'حداکثر ۴ تصویر معتبر JPG، PNG یا WebP با حجم مجموع تا ۴ مگابایت مجاز است' });
    if (error.message === 'PATIENT_NOT_FOUND') return res.status(404).json({ success: false, error: 'پرونده انتخاب‌شده معتبر نیست' });
    if (error.message === 'QUOTA_EXCEEDED') return res.status(402).json({ success: false, error: 'سهمیه تحلیل این ماه شما تمام شده است. برای ادامه پلن خود را ارتقا دهید.', code: 'QUOTA_EXCEEDED', plan: selectedPlan?.name });
    if (error.message === 'QUOTA_UNAVAILABLE') return res.status(503).json({success:false,error:'بررسی سهمیه تحلیل موقتاً در دسترس نیست. دوباره تلاش کنید.'});
    if (error.message === 'USER_BLOCKED') return res.status(403).json({ success: false, error: 'حساب کاربری شما غیرفعال شده است' });
    return res.status(500).json({ success: false, error: 'تحلیل آزمایش انجام نشد. تصویر واضح‌تر ارسال کنید یا دوباره تلاش کنید.' });
  }finally{
    if(reservation)await releaseLabAnalysisQuota(supabase,session.sub,reservation.reservationId).catch(error=>console.error('lab quota release',safeErrorMetadata(error)));
  }
}
