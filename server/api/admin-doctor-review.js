import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { validDoctorId } from './_lib/doctor-license.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {}, id = body.id, decision = body.decision, reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1200) : '';
  if (!validDoctorId(id) || !validDoctorId(body.document_id) || typeof body.document_updated_at !== 'string' || !Number.isFinite(Date.parse(body.document_updated_at)) || !['verified', 'rejected'].includes(decision) || reason.length < 5) return res.status(400).json({ success: false, error: 'پزشک، نسخه مدرک، تصمیم و توضیح بررسی (حداقل ۵ حرف) لازم است' });
  if (decision === 'verified' && body.registry_checked !== true) return res.status(400).json({ success: false, error: 'پیش از تأیید، نام و شماره نظام پزشکی را در مرجع رسمی بررسی کنید' });
  try {
    const { data, error } = await supabase.rpc('review_doctor_application', { p_doctor_id: id, p_document_id: body.document_id, p_document_updated_at: body.document_updated_at, p_decision: decision, p_reason: reason, p_registry_checked: body.registry_checked === true });
    if (error) throw error;
    if (data?.ok !== true) return res.status(409).json({ success: false, error: data?.code === 'LICENSE_MISSING' ? 'تصویر مدرک حرفه‌ای باید ابتدا بارگذاری شود' : data?.code === 'REGISTRY_REQUIRED' ? 'بررسی مرجع رسمی لازم است' : 'درخواست پزشک قابل بررسی نیست؛ صفحه را تازه کنید' });
    try { await supabase.from('audit_logs').insert({ actor_type: 'admin', action: `doctor.license_${decision}`, resource_type: 'doctor_profile', resource_id: id, metadata: { registry_checked: body.registry_checked === true, reason } }); } catch {}
    return res.status(200).json({ success: true, doctor: data.doctor });
  } catch (error) { console.error('admin-doctor-review', safeErrorMetadata(error)); return res.status(503).json({ success: false, error: 'ثبت نتیجه بررسی پزشک موقتاً انجام نشد' }); }
}
