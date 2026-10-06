import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

async function getDoctorForUser(userId) {
  const { data } = await supabase.from('doctor_profiles').select('id,verification_status').eq('user_id', userId).maybeSingle();
  return data;
}

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const role = String(req.query?.role || 'patient');
    if (role === 'doctor') {
      const doctor = await getDoctorForUser(session.sub);
      if (!doctor) return res.status(403).json({ success: false, error: 'حساب پزشک فعال نیست' });
      const { data, error } = await supabase
        .from('appointments')
        .select('id,starts_at,ends_at,mode,status,reason,patient_note,doctor_note,patients(id,display_name,birth_date,sex),organizations(name,city,address)')
        .eq('doctor_id', doctor.id).order('starts_at', { ascending: true }).limit(200);
      if (error) return res.status(500).json({ success: false, error: 'دریافت نوبت‌ها انجام نشد' });
      return res.status(200).json({ success: true, appointments: data || [] });
    }

    const { data: patients } = await supabase.from('patients').select('id').eq('owner_user_id', session.sub);
    const ids = (patients || []).map(p => p.id);
    if (!ids.length) return res.status(200).json({ success: true, appointments: [] });
    const { data, error } = await supabase
      .from('appointments')
      .select('id,patient_id,starts_at,ends_at,mode,status,reason,patient_note,doctor_note,doctor_profiles(id,full_name,specialty,slug,avatar_url),organizations(name,city,address)')
      .in('patient_id', ids).order('starts_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ success: false, error: 'دریافت نوبت‌ها انجام نشد' });
    return res.status(200).json({ success: true, appointments: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const patientId = String(body.patient_id || '');
    const doctorId = String(body.doctor_id || '');
    const { data: patient } = await supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', session.sub).maybeSingle();
    const { data: doctor } = await supabase.from('doctor_profiles').select('id,verification_status,public_profile').eq('id', doctorId).maybeSingle();
    if (!patient || !doctor || doctor.verification_status !== 'verified' || !doctor.public_profile) return res.status(400).json({ success: false, error: 'پزشک یا پرونده معتبر نیست' });
    const starts = new Date(body.starts_at);
    if (!Number.isFinite(starts.getTime()) || starts.getTime() < Date.now() - 60000) return res.status(400).json({ success: false, error: 'زمان نوبت معتبر نیست' });
    const mode = ['in_person','video','phone'].includes(body.mode) ? body.mode : 'in_person';
    const { data, error } = await supabase.from('appointments').insert({
      patient_id: patientId,
      doctor_id: doctorId,
      organization_id: body.organization_id || null,
      starts_at: starts.toISOString(),
      ends_at: body.ends_at || null,
      mode,
      reason: body.reason ? String(body.reason).trim().slice(0, 1200) : null,
      patient_note: body.patient_note ? String(body.patient_note).trim().slice(0, 2000) : null
    }).select('id,starts_at,mode,status').single();
    if (error) return res.status(500).json({ success: false, error: 'رزرو نوبت انجام نشد' });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: 'appointment.requested', resource_type: 'appointment', resource_id: data.id });
    return res.status(201).json({ success: true, appointment: data });
  }

  if (req.method === 'PATCH') {
    const doctor = await getDoctorForUser(session.sub);
    if (!doctor) return res.status(403).json({ success: false, error: 'حساب پزشک فعال نیست' });
    const id = String(req.body?.id || '');
    const status = String(req.body?.status || '');
    if (!['confirmed','completed','cancelled','no_show'].includes(status)) return res.status(400).json({ success: false, error: 'وضعیت معتبر نیست' });
    const { data: appt } = await supabase.from('appointments').select('id,patient_id').eq('id', id).eq('doctor_id', doctor.id).maybeSingle();
    if (!appt) return res.status(404).json({ success: false, error: 'نوبت پیدا نشد' });
    const { data, error } = await supabase.from('appointments').update({ status, doctor_note: req.body?.doctor_note ? String(req.body.doctor_note).trim().slice(0, 3000) : null, updated_at: new Date().toISOString() }).eq('id', id).select('id,status').single();
    if (error) return res.status(500).json({ success: false, error: 'بروزرسانی نوبت انجام نشد' });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'doctor', patient_id: appt.patient_id, action: `appointment.${status}`, resource_type: 'appointment', resource_id: id });
    return res.status(200).json({ success: true, appointment: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
