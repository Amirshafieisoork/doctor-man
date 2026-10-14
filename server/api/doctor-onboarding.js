import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { InputValidationError, numberField } from './_lib/validate.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { allowRate, recordRate } from './_lib/rate-limit.js';
import { LICENSE_BUCKET, LICENSE_FIELDS, LICENSE_MAX_SIZE, LICENSE_MIME_TYPES, licenseView, parseLicenseForm, screenLicenseImage } from './_lib/doctor-license.js';
import { matchesFileType } from './_lib/uploads.js';

export const config = { api: { bodyParser: false } };
const text = (value, max) => value == null ? '' : String(value).trim().slice(0, max);
const bool = value => value === true || value === 'true';
const slugify = value => text(value, 120).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export default async function handler(req, res) {
  const session = await requireUser(req, res); if (!session) return;
  res.setHeader('Cache-Control', 'no-store, private');
  let uploadedPath = null, saved = false;
  try {
    const { data: existing, error: lookupError } = await supabase.from('doctor_profiles').select('*').eq('user_id', session.sub).maybeSingle();
    if (lookupError) throw lookupError;
    const { data: previousDocument, error: documentError } = existing ? await supabase.from('doctor_license_documents').select(LICENSE_FIELDS).eq('doctor_id', existing.id).maybeSingle() : { data: null };
    if (documentError) throw documentError;
    if (req.method === 'GET') return res.status(200).json({ success: true, doctor: existing || null, license: licenseView(previousDocument, existing?.id || null) });
    if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

    const { data: settings, error: settingsError } = await supabase.from('app_settings').select('value').eq('key', 'general').maybeSingle();
    if (settingsError) throw settingsError;
    if (settings?.value?.doctor_onboarding_enabled === false) return res.status(503).json({ success: false, error: 'ثبت درخواست پزشک جدید موقتاً غیرفعال است' });
    const multipart = String(req.headers?.['content-type'] || '').toLowerCase().startsWith('multipart/form-data;');
    const parsed = multipart ? await parseLicenseForm(req) : { fields: req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, file: null };
    const body = parsed.fields;
    const profile = {
      full_name: text(body.full_name, 120), medical_license_number: text(body.medical_license_number, 80), specialty: text(body.specialty, 120),
      sub_specialty: text(body.sub_specialty, 120) || null, bio: text(body.bio, 4000) || null, city: text(body.city, 100) || null,
      phone: text(body.phone, 30) || null, accepts_online: bool(body.accepts_online), accepts_in_person: body.accepts_in_person !== false && body.accepts_in_person !== 'false',
      consultation_fee: numberField(body.consultation_fee, { label: 'هزینه ویزیت', min: 0, max: 100000000, integer: true }),
      slug: existing?.slug || `${slugify(body.full_name) || 'doctor'}-${crypto.randomUUID().slice(0, 8)}`
    };
    if (!profile.full_name || !profile.specialty || !profile.medical_license_number) throw new InputValidationError('نام، تخصص و شماره نظام پزشکی الزامی است');
    if (!parsed.file && !previousDocument) throw new InputValidationError('تصویر خوانای پروانه کار یا کارت نظام پزشکی را بارگذاری کنید');
    const rate = await allowRate(req, { action: 'doctor-license-screen', subject: session.sub, limit: 6, windowMinutes: 60 });
    if (!rate.allowed) {
      if (rate.unavailable) return res.status(503).json({ success: false, error: 'ثبت درخواست موقتاً در دسترس نیست' });
      res.setHeader('Retry-After', String(rate.retry_after_seconds));
      return res.status(429).json({ success: false, error: 'تعداد درخواست‌های بررسی زیاد است؛ کمی بعد دوباره تلاش کنید' });
    }
    let file = parsed.file;
    if (!file) {
      const { data: blob, error } = await supabase.storage.from(LICENSE_BUCKET).download(previousDocument.storage_path);
      if (error || !blob || blob.size > LICENSE_MAX_SIZE || !LICENSE_MIME_TYPES.has(previousDocument.mime_type)) throw new Error('LICENSE_DOWNLOAD_FAILED');
      file = { buffer: Buffer.from(await blob.arrayBuffer()), mimeType: previousDocument.mime_type, filename: previousDocument.original_name };
      if (!matchesFileType(file.buffer, file.mimeType)) throw new Error('LICENSE_DOWNLOAD_INVALID');
    }
    const report = await screenLicenseImage(file, profile);
    if (!(await requireUser(req, res))) return;
    let document = previousDocument;
    if (parsed.file) {
      const extension = file.mimeType === 'image/png' ? 'png' : file.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${session.sub}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(LICENSE_BUCKET).upload(path, file.buffer, { contentType: file.mimeType, upsert: false });
      if (error) throw error;
      uploadedPath = path;
      document = { storage_path: path, original_name: file.filename, mime_type: file.mimeType, file_size: file.buffer.length, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };
    }
    if (!(await requireUser(req, res))) return;
    const { data, error } = await supabase.rpc('submit_doctor_application', {
      p_user_id: session.sub, p_profile: profile,
      p_document: { storage_path: document.storage_path, original_name: document.original_name, mime_type: document.mime_type, file_size: document.file_size, sha256: document.sha256, ai_report: report, reuse_existing: !parsed.file, expected_document_id: parsed.file ? null : previousDocument.id, expected_document_updated_at: parsed.file ? null : previousDocument.updated_at }
    });
    if (error || !data?.doctor || !data?.document) throw error || new Error('DOCTOR_SUBMIT_NOT_CONFIRMED');
    saved = true;
    await recordRate(rate.keyHash, 'doctor-license-screen', true, rate.eventId);
    if (uploadedPath && data.replaced_storage_path && uploadedPath !== data.replaced_storage_path) {
      try { await supabase.storage.from(LICENSE_BUCKET).remove([data.replaced_storage_path]); } catch { /* Current document remains private and saved. */ }
    }
    try { await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'doctor', action: 'doctor.onboarding_requested', resource_type: 'doctor_profile', resource_id: data.doctor.id, metadata: { license_image_uploaded: Boolean(parsed.file), ai_status: report.status } }); } catch {}
    return res.status(existing ? 200 : 201).json({ success: true, doctor: data.doctor, license: licenseView(data.document, data.doctor.id) });
  } catch (error) {
    if (error instanceof InputValidationError) return res.status(400).json({ success: false, error: error.message });
    if (error?.message === 'LICENSE_CHANGED') return res.status(409).json({ success: false, error: 'مدرک هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و دوباره بررسی کنید' });
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'شماره نظام پزشکی برای درخواست دیگری ثبت شده است' });
    console.error('doctor-onboarding', safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'ثبت یا دریافت درخواست پزشک موقتاً انجام نشد؛ دوباره تلاش کنید' });
  } finally {
    if (uploadedPath && !saved) { try { await supabase.storage.from(LICENSE_BUCKET).remove([uploadedPath]); } catch {} }
  }
}
