import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireUser(req, res);
  if (!session) return;

  const { data: doctor } = await supabase.from('doctor_profiles').select('*').eq('user_id', session.sub).maybeSingle();
  if (!doctor) return res.status(403).json({ success: false, error: 'پروفایل پزشک پیدا نشد' });

  const now = new Date().toISOString();
  await supabase.from('patient_access_grants').update({ status: 'expired' }).eq('doctor_id', doctor.id).eq('status', 'active').lt('expires_at', now);

  const [grants, appointments, messages] = await Promise.all([
    supabase.from('patient_access_grants')
      .select('id,scope,status,expires_at,created_at,patients(id,display_name,birth_date,sex,blood_type,owner_user_id)')
      .eq('doctor_id', doctor.id).eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('appointments')
      .select('id,starts_at,ends_at,mode,status,reason,patient_note,doctor_note,patients(id,display_name,birth_date,sex),organizations(name,city,address)')
      .eq('doctor_id', doctor.id).order('starts_at', { ascending: true }).limit(200),
    supabase.from('patient_messages')
      .select('id,patient_id,sender_type,body,created_at,read_at,patients(display_name)')
      .eq('doctor_id', doctor.id).order('created_at', { ascending: false }).limit(100)
  ]);

  return res.status(200).json({
    success: true,
    doctor,
    patients: grants.data || [],
    appointments: appointments.data || [],
    messages: messages.data || []
  });
}
