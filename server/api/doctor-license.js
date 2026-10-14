import { getAdminSession, requireAdmin, requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { matchesFileType } from './_lib/uploads.js';
import { LICENSE_BUCKET, LICENSE_FIELDS, LICENSE_MAX_SIZE, LICENSE_MIME_TYPES, licenseView, validDoctorId } from './_lib/doctor-license.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const admin = getAdminSession(req), session = admin ? requireAdmin(req, res) : await requireUser(req, res); if (!session) return;
  const id = String(req.query?.id || '');
  if (id && !validDoctorId(id)) return res.status(400).json({ success: false, error: 'شناسه پزشک معتبر نیست' });
  try {
    let query = supabase.from('doctor_profiles').select('id,user_id');
    if (id) query = query.eq('id', id);
    if (!admin) query = query.eq('user_id', session.sub);
    if (admin && !id) return res.status(400).json({ success: false, error: 'شناسه پزشک لازم است' });
    const { data: doctor, error: doctorError } = await query.maybeSingle(); if (doctorError) throw doctorError;
    if (!doctor) return res.status(404).json({ success: false, error: 'مدرک پیدا نشد یا اجازه دسترسی ندارید' });
    const { data: document, error } = await supabase.from('doctor_license_documents').select(LICENSE_FIELDS).eq('doctor_id', doctor.id).maybeSingle(); if (error) throw error;
    if (req.query?.image !== '1') return res.status(200).json({ success: true, ...licenseView(document, doctor.id) });
    if (!document || !document.storage_path || !LICENSE_MIME_TYPES.has(document.mime_type) || document.file_size > LICENSE_MAX_SIZE) return res.status(404).json({ success: false, error: 'تصویر مجوز پیدا نشد' });
    const { data: blob, error: downloadError } = await supabase.storage.from(LICENSE_BUCKET).download(document.storage_path);
    if (downloadError || !blob || blob.size > LICENSE_MAX_SIZE) throw new Error('LICENSE_IMAGE_UNAVAILABLE');
    const bytes = Buffer.from(await blob.arrayBuffer()); if (!matchesFileType(bytes, document.mime_type)) throw new Error('LICENSE_IMAGE_INVALID');
    if (!admin && !(await requireUser(req, res))) return;
    res.setHeader('Content-Type', document.mime_type); res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', 'inline; filename="professional-license.' + (document.mime_type === 'image/png' ? 'png' : document.mime_type === 'image/webp' ? 'webp' : 'jpg') + '"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); return res.status(200).send(bytes);
  } catch (error) { console.error('doctor-license', safeErrorMetadata(error)); return res.status(503).json({ success: false, error: 'دریافت مدرک حرفه‌ای موقتاً در دسترس نیست' }); }
}
