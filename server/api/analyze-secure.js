import { safeErrorMetadata } from './_lib/errors.js';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { avalaiClient } from './_lib/ai-models.js';
import { analyzeLabImages, labErrorResponse } from './_lib/lab-ai.js';
import { saveBiomarkers } from './_lib/biomarkers.js';
import { readEntitlement, planLimit } from './_lib/entitlements.js';
import { reserveLabAnalysisQuota, releaseLabAnalysisQuota } from './_lib/ai-quota.js';
import { matchesFileType } from './_lib/uploads.js';

export const config = { api: { bodyParser: false } };

const MAX_IMAGES = 4;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AI_VERSION = 'lab-v6-nine-sections-grounded-2026-10';


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

async function removePrivateImages(paths) {
  if (!paths.length) return;
  try {
    const { error } = await supabase.storage.from('lab-images').remove(paths);
    if (error) throw error;
  } catch (error) {
    console.error('lab image cleanup', safeErrorMetadata(error));
  }
}

async function uploadPrivateImages(userId, images, verifyActive) {
  const uploaded = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${i + 1}.${ext}`;
      const { error } = await supabase.storage.from('lab-images').upload(path, img.buffer, { contentType: img.mimeType, upsert: false, cacheControl: '3600' });
      if (error) throw error;
      uploaded.push(path);
      if (!(await verifyActive())) {
        await removePrivateImages(uploaded);
        return null;
      }
    }
    return uploaded;
  } catch (error) {
    await removePrivateImages(uploaded);
    throw error;
  }
}


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req, res);
  if (!session) return;
  if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('multipart/form-data;'))return res.status(415).json({success:false,error:'تصاویر باید به شکل فایل ارسال شوند'});
  const client = await avalaiClient();
  if (!client) return res.status(503).json({ success: false, code:'FREE_AI_NOT_CONFIGURED', error: 'کلید سرویس هوش مصنوعی رایگان هنوز در تنظیمات مدیر ثبت نشده است.' });

  let storedPaths = [];
  let resultSaved = false;
  let reservation=null;
  let selectedPlan=null;
  let stage='input';
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
    const gender = ['female','male'].includes(patient?.sex) ? patient.sex : String(fields.gender || '').trim();
    if(!['female','male'].includes(gender))return res.status(400).json({success:false,error:'برای تحلیل، جنسیت را انتخاب کنید: زن یا مرد'});
    const reason = String(fields.reason || '').trim().slice(0, 500);

    if (!(await requireUser(req, res))) return;
    const {error:consentError}=await supabase.from('consent_records').insert({patient_id:patient.id,user_id:session.sub,consent_type:'ai_processing',version:'lab-upload-v1',granted:true,metadata:{source:'lab_upload'}});
    if(consentError)throw consentError;
    reservation=await reserveLabAnalysisQuota(supabase,session.sub,{limit:entitlement.limit});

    const contextText = `پرونده: ${patient?.display_name || 'پرونده اصلی کاربر'}\nسن: ${age ?? 'نامشخص'}\nجنس/sex: ${gender}\nگروه خونی ثبت‌شده: ${patient?.blood_type || 'نامشخص'}\nعلت آزمایش: ${reason || 'ذکر نشده'}\n\nاین تصاویر صفحات یک مجموعه آزمایش هستند. همه صفحات را با هم در نظر بگیر.`;
    const content = [
      { type: 'text', text: contextText },
      ...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`, detail: 'high' } }))
    ];
    const safetyIdentifier = crypto.createHash('sha256').update(`drman:${session.sub}`).digest('hex').slice(0, 32);
    stage='provider';
    const { parsed, model, requestId } = await analyzeLabImages(client, content, safetyIdentifier);

    if (!(await requireUser(req, res))) return;
    stage='storage';
    const uploaded = await uploadPrivateImages(session.sub, images, () => requireUser(req, res));
    if (!uploaded) return;
    storedPaths = uploaded;
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
    stage='persist';
    const { data: saved, error: saveError } = await supabase.from('test_results').insert(insert).select('id').single();
    if (saveError) throw saveError;
    resultSaved = true;
    if (!(await requireUser(req, res))) return;
    await saveBiomarkers(supabase,{testResultId:saved?.id,patientId:patient?.id||null,userId:session.sub,items:parsed.items,confidence:parsed.confidence,observedAt:new Date().toISOString()}).catch(e=>console.error('biomarker save',safeErrorMetadata(e)));

    if (!(await requireUser(req, res))) return;
    await Promise.resolve(supabase.from('audit_logs').insert({
      actor_user_id: session.sub,
      actor_type: 'user',
      patient_id: patient?.id || null,
      action: 'lab.ai_analyzed',
      resource_type: 'test_result',
      resource_id: saved?.id || null,
      metadata: { model, version: AI_VERSION, request_id: requestId, read_quality: parsed.read_quality, confidence: parsed.confidence }
    })).catch(() => null);

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
    console.error('analyze-secure',{...safeErrorMetadata(error),stage,classification:labErrorResponse(error,stage).code});
    if (error.message === 'INVALID_IMAGE') return res.status(400).json({ success: false, error: 'حداکثر ۴ تصویر معتبر JPG، PNG یا WebP با حجم مجموع تا ۴ مگابایت مجاز است' });
    if (error.message === 'PATIENT_NOT_FOUND') return res.status(404).json({ success: false, error: 'پرونده انتخاب‌شده معتبر نیست' });
    if (error.message === 'QUOTA_EXCEEDED') return res.status(402).json({ success: false, error: 'سهمیه تحلیل این ماه شما تمام شده است. برای ادامه پلن خود را ارتقا دهید.', code: 'QUOTA_EXCEEDED', plan: selectedPlan?.name });
    if (error.message === 'QUOTA_UNAVAILABLE') return res.status(503).json({success:false,error:'بررسی سهمیه تحلیل موقتاً در دسترس نیست. دوباره تلاش کنید.'});
    if (error.message === 'USER_BLOCKED') return res.status(403).json({ success: false, error: 'حساب کاربری شما غیرفعال شده است' });
    const failure=labErrorResponse(error,stage);
    return res.status(failure.status).json({success:false,code:failure.code,error:failure.message});
  }finally{
    if (!resultSaved) await removePrivateImages(storedPaths);
    if(reservation)await releaseLabAnalysisQuota(supabase,session.sub,reservation.reservationId).catch(error=>console.error('lab quota release',safeErrorMetadata(error)));
  }
}
