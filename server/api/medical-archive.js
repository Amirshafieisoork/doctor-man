import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { ownedArchivePatient, listArchive, archiveOffset } from './_lib/medical-archive.js';
import { InputValidationError } from './_lib/validate.js';
import { safeErrorMetadata } from './_lib/errors.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req,res); if (!session) return;
  try {
    const offset = archiveOffset(req.query?.offset), patient = await ownedArchivePatient(supabase,session.sub,String(req.query?.patient_id || ''));
    if (!patient) return res.status(404).json({ success: false, error: 'پرونده سلامت پیدا نشد' });
    const archive = await listArchive(supabase,{ patient, offset });
    if (!(await requireUser(req,res))) return;
    return res.status(200).json({ success: true, patient: { id: patient.id, display_name: patient.display_name }, ...archive });
  } catch (error) {
    if (error instanceof InputValidationError) return res.status(400).json({ success: false, error: error.message });
    console.error('medical archive',safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'دریافت آرشیو فایل‌ها موقتاً انجام نشد' });
  }
}
