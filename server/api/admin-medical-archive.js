import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { archiveRequest, archiveOffset, resolveArchiveFile, signArchiveFile, activeArchiveOwner, activeArchiveOwnerIds, listArchive } from './_lib/medical-archive.js';
import { InputValidationError } from './_lib/validate.js';
import { safeErrorMetadata } from './_lib/errors.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req,res)) return;
  try {
    if (req.query?.source || req.query?.id) {
      const input = archiveRequest(req.query), file = await resolveArchiveFile(supabase,input);
      if (!file) return res.status(404).json({ success: false, error: 'فایل پیدا نشد یا حساب صاحب پرونده غیرفعال است' });
      const signed = await signArchiveFile(supabase,file,input.download);
      if (!requireAdmin(req,res)) return;
      if (!(await activeArchiveOwner(supabase,file.user_id))) return res.status(404).json({ success: false, error: 'فایل در دسترس نیست' });
      await supabase.from('audit_logs').insert({ actor_type: 'admin', patient_id: file.patient_id, action: input.download ? 'admin.medical_file_downloaded' : 'admin.medical_file_opened', resource_type: input.source === 'lab' ? 'test_result' : 'medical_document', resource_id: input.id });
      return res.status(200).json(signed);
    }
    const offset = archiveOffset(req.query?.offset);
    let query = supabase.from('patients').select('id,owner_user_id,display_name,relation').order('created_at',{ascending:false}).limit(500);
    if (req.query?.user_id) query = query.eq('owner_user_id',String(req.query.user_id));
    if (req.query?.patient_id) query = query.eq('id',String(req.query.patient_id));
    const { data: patients, error } = await query;
    if (error) throw error;
    const ownerIds = [...new Set((patients || []).map(patient => patient.owner_user_id))];
    const activeIds = await activeArchiveOwnerIds(supabase,ownerIds);
    const visible = (patients || []).filter(patient => activeIds.has(patient.owner_user_id));
    const archive = await listArchive(supabase,{ patients: visible, offset, admin: true });
    const stillActive = await activeArchiveOwnerIds(supabase,ownerIds);
    archive.files = archive.files.filter(file => stillActive.has(file.user_id));
    if (!requireAdmin(req,res)) return;
    return res.status(200).json({ success: true, ...archive });
  } catch (error) {
    if (error instanceof InputValidationError) return res.status(400).json({ success: false, error: error.message });
    console.error('admin medical archive',safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'دریافت فایل‌های پزشکی موقتاً انجام نشد' });
  }
}
