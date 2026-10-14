import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { archiveRequest, resolveArchiveFile, signArchiveFile } from './_lib/medical-archive.js';
import { InputValidationError } from './_lib/validate.js';
import { safeErrorMetadata } from './_lib/errors.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req,res); if (!session) return;
  try {
    const input = archiveRequest(req.query), file = await resolveArchiveFile(supabase,input,session.sub);
    if (!file) return res.status(404).json({ success: false, error: 'فایل پیدا نشد یا اجازه دسترسی ندارید' });
    if (!(await requireUser(req,res))) return;
    const signed = await signArchiveFile(supabase,file,input.download);
    if (!(await requireUser(req,res))) return;
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: file.patient_id,
      action: input.download ? 'medical_file.downloaded' : 'medical_file.opened', resource_type: input.source === 'lab' ? 'test_result' : 'medical_document', resource_id: input.id });
    return res.status(200).json(signed);
  } catch (error) {
    if (error instanceof InputValidationError) return res.status(400).json({ success: false, error: error.message });
    console.error('medical file',safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'نمایش فایل موقتاً انجام نشد. دوباره تلاش کنید.' });
  }
}
