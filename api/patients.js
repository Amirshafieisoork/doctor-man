import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const RELATIONS = new Set(['self','child','parent','spouse','sibling','other']);
const SEX = new Set(['female','male','other','unknown']);
const BLOOD = new Set(['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown']);

function clean(body = {}) {
  const relation = RELATIONS.has(body.relation) ? body.relation : 'other';
  const sex = body.sex && SEX.has(body.sex) ? body.sex : null;
  const blood = body.blood_type && BLOOD.has(body.blood_type) ? body.blood_type : null;
  return {
    relation,
    display_name: String(body.display_name || '').trim().slice(0, 120),
    birth_date: body.birth_date || null,
    sex,
    blood_type: blood,
    height_cm: body.height_cm ? Math.max(20, Math.min(260, Number(body.height_cm))) : null,
    national_code: body.national_code ? String(body.national_code).replace(/\D/g, '').slice(0, 10) : null,
    emergency_contact_name: body.emergency_contact_name ? String(body.emergency_contact_name).trim().slice(0, 120) : null,
    emergency_contact_phone: body.emergency_contact_phone ? String(body.emergency_contact_phone).trim().slice(0, 30) : null,
    notes: body.notes ? String(body.notes).trim().slice(0, 2000) : null,
    updated_at: new Date().toISOString()
  };
}

async function ownedPatient(userId, id) {
  const { data } = await supabase.from('patients').select('id,relation').eq('id', id).eq('owner_user_id', userId).maybeSingle();
  return data;
}

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('patients')
      .select('id,relation,display_name,birth_date,sex,blood_type,height_cm,emergency_contact_name,emergency_contact_phone,created_at,updated_at')
      .eq('owner_user_id', session.sub)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ success: false, error: 'خطا در دریافت اعضای خانواده' });
    return res.status(200).json({ success: true, patients: data || [] });
  }

  if (req.method === 'POST') {
    const input = clean(req.body);
    if (!input.display_name) return res.status(400).json({ success: false, error: 'نام پرونده الزامی است' });
    if (input.relation === 'self') return res.status(400).json({ success: false, error: 'پرونده اصلی از قبل برای حساب ساخته شده است' });
    const { data, error } = await supabase.from('patients').insert({ ...input, owner_user_id: session.sub }).select('id,relation,display_name,birth_date,sex,blood_type,height_cm').single();
    if (error) return res.status(500).json({ success: false, error: 'ساخت پرونده انجام نشد' });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: data.id, action: 'patient.created', resource_type: 'patient', resource_id: data.id });
    return res.status(201).json({ success: true, patient: data });
  }

  if (req.method === 'PATCH') {
    const id = String(req.body?.id || '');
    const patient = await ownedPatient(session.sub, id);
    if (!patient) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد' });
    const input = clean({ ...req.body, relation: patient.relation });
    if (!input.display_name) return res.status(400).json({ success: false, error: 'نام پرونده الزامی است' });
    const { data, error } = await supabase.from('patients').update(input).eq('id', id).select('id,relation,display_name,birth_date,sex,blood_type,height_cm,emergency_contact_name,emergency_contact_phone').single();
    if (error) return res.status(500).json({ success: false, error: 'ویرایش پرونده انجام نشد' });
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: id, action: 'patient.updated', resource_type: 'patient', resource_id: id });
    return res.status(200).json({ success: true, patient: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
