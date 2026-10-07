import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const ALLOWED_SCOPES = new Set(['summary','labs','medications','allergies','conditions','vitals','vaccinations','documents','appointments','messages','clinical_history','clinical_write']);

async function ownedPatient(userId, patientId) {
  const { data } = await supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', userId).maybeSingle();
  return data;
}

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const patientId = String(req.query?.patient_id || '');
    if (!patientId || !(await ownedPatient(session.sub, patientId))) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد' });
    const { data, error } = await supabase.from('patient_access_grants')
      .select('id,scope,status,expires_at,created_at,revoked_at,doctor_profiles(id,full_name,specialty,slug,avatar_url,verification_status)')
      .eq('patient_id', patientId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: 'دریافت دسترسی‌ها انجام نشد' });
    return res.status(200).json({ success: true, grants: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const patientId = String(body.patient_id || '');
    const doctorId = String(body.doctor_id || '');
    if (!(await ownedPatient(session.sub, patientId))) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد' });
    const { data: doctor } = await supabase.from('doctor_profiles').select('id,verification_status').eq('id', doctorId).maybeSingle();
    if (!doctor || doctor.verification_status !== 'verified') return res.status(400).json({ success: false, error: 'پزشک تأییدشده نیست' });

    const requested = Array.isArray(body.scope) ? body.scope : ['summary','labs','medications'];
    const scope = [...new Set(requested.filter(s => ALLOWED_SCOPES.has(s)))].slice(0, 13);
    if (!scope.length) return res.status(400).json({ success: false, error: 'حداقل یک سطح دسترسی انتخاب کنید' });
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) return res.status(400).json({ success: false, error: 'تاریخ پایان دسترسی معتبر نیست' });

    await supabase.from('patient_access_grants').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('patient_id', patientId).eq('doctor_id', doctorId).eq('status', 'active');
    const { data, error } = await supabase.from('patient_access_grants').insert({ patient_id: patientId, doctor_id: doctorId, granted_by_user_id: session.sub, scope, expires_at: expiresAt?.toISOString() || null }).select('id,scope,status,expires_at,created_at').single();
    if (error) return res.status(500).json({ success: false, error: 'ثبت دسترسی انجام نشد' });
    await supabase.from('consent_records').insert({ patient_id: patientId, user_id: session.sub, consent_type: 'doctor_share', version: '2', granted: true, metadata: { doctor_id: doctorId, scope, grant_id: data.id } });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: 'doctor_access.granted', resource_type: 'access_grant', resource_id: data.id, metadata: { doctor_id: doctorId, scope } });
    return res.status(201).json({ success: true, grant: data });
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id || '');
    const { data: grant } = await supabase.from('patient_access_grants').select('id,patient_id,doctor_id').eq('id', id).maybeSingle();
    if (!grant || !(await ownedPatient(session.sub, grant.patient_id))) return res.status(404).json({ success: false, error: 'دسترسی پیدا نشد' });
    await supabase.from('patient_access_grants').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', id);
    await supabase.from('consent_records').insert({ patient_id: grant.patient_id, user_id: session.sub, consent_type: 'doctor_share', version: '2', granted: false, revoked_at: new Date().toISOString(), metadata: { doctor_id: grant.doctor_id, grant_id: id } });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: grant.patient_id, action: 'doctor_access.revoked', resource_type: 'access_grant', resource_id: id, metadata: { doctor_id: grant.doctor_id } });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
