import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

async function doctorForUser(userId) {
  const { data } = await supabase.from('doctor_profiles').select('id,full_name,specialty,verification_status').eq('user_id', userId).maybeSingle();
  return data;
}

function has(scope, key) { return Array.isArray(scope) && (scope.includes(key) || scope.includes('summary')); }

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const doctor = await doctorForUser(session.sub);
  if (!doctor || doctor.verification_status !== 'verified') return res.status(403).json({ success: false, error: 'دسترسی پزشک معتبر نیست' });

  const patientId = String(req.query?.patient_id || '');
  const { data: grant } = await supabase.from('patient_access_grants').select('id,scope,status,expires_at').eq('patient_id', patientId).eq('doctor_id', doctor.id).eq('status', 'active').maybeSingle();
  if (!grant || (grant.expires_at && new Date(grant.expires_at).getTime() < Date.now())) return res.status(403).json({ success: false, error: 'بیمار اجازه دسترسی فعال نداده است' });

  const { data: patient } = await supabase.from('patients').select('id,display_name,birth_date,sex,blood_type,height_cm,notes').eq('id', patientId).single();
  if (!patient) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد' });

  const output = { patient, scope: grant.scope };
  const jobs = [];
  if (has(grant.scope, 'conditions')) jobs.push(supabase.from('patient_conditions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).then(r => { output.conditions = r.data || []; }));
  if (has(grant.scope, 'allergies')) jobs.push(supabase.from('patient_allergies').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).then(r => { output.allergies = r.data || []; }));
  if (has(grant.scope, 'medications')) jobs.push(supabase.from('patient_medications').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).then(r => { output.medications = r.data || []; }));
  if (has(grant.scope, 'vaccinations')) jobs.push(supabase.from('patient_vaccinations').select('*').eq('patient_id', patientId).order('administered_at', { ascending: false }).then(r => { output.vaccinations = r.data || []; }));
  if (has(grant.scope, 'vitals')) jobs.push(supabase.from('patient_vitals').select('*').eq('patient_id', patientId).order('measured_at', { ascending: false }).limit(100).then(r => { output.vitals = r.data || []; }));
  if (has(grant.scope, 'labs')) jobs.push(supabase.from('test_results').select('id,reason,analysis,status,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(100).then(r => { output.tests = r.data || []; }));
  if (has(grant.scope, 'appointments')) jobs.push(supabase.from('appointments').select('id,starts_at,mode,status,reason,doctor_note').eq('patient_id', patientId).eq('doctor_id', doctor.id).order('starts_at', { ascending: false }).then(r => { output.appointments = r.data || []; }));
  if (has(grant.scope, 'documents')) jobs.push(supabase.from('medical_documents').select('id,document_type,title,document_date,ai_summary,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(100).then(r => { output.documents = r.data || []; }));

  await Promise.all(jobs);
  await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'doctor', patient_id: patientId, action: 'doctor.record_viewed', resource_type: 'patient', resource_id: patientId, metadata: { grant_id: grant.id, scope: grant.scope } });
  return res.status(200).json({ success: true, record: output });
}
