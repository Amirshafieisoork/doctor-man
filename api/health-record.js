import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

async function getOwnedPatient(userId, patientId) {
  let query = supabase.from('patients').select('*').eq('owner_user_id', userId);
  if (patientId) query = query.eq('id', patientId);
  else query = query.eq('relation', 'self');
  const { data } = await query.maybeSingle();
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireUser(req, res);
  if (!session) return;

  const patientId = String(req.query?.patient_id || '');
  const patient = await getOwnedPatient(session.sub, patientId);
  if (!patient) return res.status(404).json({ success: false, error: 'پرونده سلامت پیدا نشد' });

  const pid = patient.id;
  const [conditions, allergies, medications, vaccinations, vitals, tasks, documents, appointments, encounters, insurances, tests, access] = await Promise.all([
    supabase.from('patient_conditions').select('*').eq('patient_id', pid).order('created_at', { ascending: false }),
    supabase.from('patient_allergies').select('*').eq('patient_id', pid).order('created_at', { ascending: false }),
    supabase.from('patient_medications').select('*,doctor_profiles(full_name,specialty)').eq('patient_id', pid).order('created_at', { ascending: false }),
    supabase.from('patient_vaccinations').select('*').eq('patient_id', pid).order('administered_at', { ascending: false }),
    supabase.from('patient_vitals').select('*').eq('patient_id', pid).order('measured_at', { ascending: false }).limit(100),
    supabase.from('care_tasks').select('*,doctor_profiles(full_name,specialty)').eq('patient_id', pid).order('due_at', { ascending: true, nullsFirst: false }).limit(100),
    supabase.from('medical_documents').select('id,document_type,title,mime_type,document_date,ai_summary,created_at,organizations(name,type)').eq('patient_id', pid).order('created_at', { ascending: false }).limit(100),
    supabase.from('appointments').select('id,starts_at,ends_at,mode,status,reason,doctor_profiles(id,full_name,specialty,slug,avatar_url),organizations(name,city)').eq('patient_id', pid).order('starts_at', { ascending: false }).limit(100),
    supabase.from('encounters').select('id,occurred_at,encounter_type,chief_complaint,summary,assessment,plan,doctor_profiles(full_name,specialty),organizations(name)').eq('patient_id', pid).order('occurred_at', { ascending: false }).limit(100),
    supabase.from('patient_insurances').select('*').eq('patient_id', pid).order('is_primary', { ascending: false }),
    supabase.from('test_results').select('id,age,gender,reason,analysis,status,created_at').eq('patient_id', pid).order('created_at', { ascending: false }).limit(100),
    supabase.from('patient_access_grants').select('id,scope,status,expires_at,created_at,doctor_profiles(id,full_name,specialty,slug)').eq('patient_id', pid).order('created_at', { ascending: false })
  ]);

  await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: pid, action: 'record.viewed', resource_type: 'patient', resource_id: pid });

  return res.status(200).json({
    success: true,
    patient,
    record: {
      conditions: conditions.data || [],
      allergies: allergies.data || [],
      medications: medications.data || [],
      vaccinations: vaccinations.data || [],
      vitals: vitals.data || [],
      tasks: tasks.data || [],
      documents: documents.data || [],
      appointments: appointments.data || [],
      encounters: encounters.data || [],
      insurances: insurances.data || [],
      tests: tests.data || [],
      doctor_access: access.data || []
    }
  });
}
