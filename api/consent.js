import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const TYPES = new Set(['privacy','terms','ai_processing','doctor_share','research','marketing']);

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const patientId = String(body.patient_id || '');
  const type = String(body.consent_type || '');
  if (!TYPES.has(type)) return res.status(400).json({ success: false, error: 'نوع رضایت معتبر نیست' });
  const { data: patient } = await supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', session.sub).maybeSingle();
  if (!patient) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد' });
  const granted = body.granted === true;
  const { data, error } = await supabase.from('consent_records').insert({
    patient_id: patientId,
    user_id: session.sub,
    consent_type: type,
    version: String(body.version || '1').slice(0, 30),
    granted,
    revoked_at: granted ? null : new Date().toISOString(),
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
  }).select('id,consent_type,version,granted,granted_at,revoked_at').single();
  if (error) return res.status(500).json({ success: false, error: 'ثبت رضایت انجام نشد' });
  await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: granted ? `consent.${type}.granted` : `consent.${type}.revoked`, resource_type: 'consent', resource_id: data.id });
  return res.status(201).json({ success: true, consent: data });
}
