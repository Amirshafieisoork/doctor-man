import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const TYPE_MAP = {
  condition: 'patient_conditions',
  allergy: 'patient_allergies',
  medication: 'patient_medications',
  vaccination: 'patient_vaccinations',
  vital: 'patient_vitals',
  task: 'care_tasks',
  insurance: 'patient_insurances'
};

async function ensureOwned(userId, patientId) {
  const { data } = await supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', userId).maybeSingle();
  return Boolean(data);
}

function text(v, max = 500) { return v == null ? null : String(v).trim().slice(0, max); }

function build(type, body) {
  if (type === 'condition') return { name: text(body.name, 160), status: ['active','resolved','inactive'].includes(body.status) ? body.status : 'active', diagnosed_at: body.diagnosed_at || null, notes: text(body.notes, 2000) };
  if (type === 'allergy') return { allergen: text(body.allergen, 160), allergy_type: ['drug','food','environmental','other'].includes(body.allergy_type) ? body.allergy_type : 'other', severity: ['mild','moderate','severe','unknown'].includes(body.severity) ? body.severity : 'unknown', reaction: text(body.reaction, 500), notes: text(body.notes, 1500) };
  if (type === 'medication') return { name: text(body.name, 160), dose: text(body.dose, 120), route: text(body.route, 80), frequency: text(body.frequency, 120), instructions: text(body.instructions, 1000), started_at: body.started_at || null, ended_at: body.ended_at || null, status: ['active','paused','stopped','completed'].includes(body.status) ? body.status : 'active' };
  if (type === 'vaccination') return { vaccine_name: text(body.vaccine_name, 160), dose_number: text(body.dose_number, 80), administered_at: body.administered_at || null, next_due_at: body.next_due_at || null, provider: text(body.provider, 160), notes: text(body.notes, 1000) };
  if (type === 'vital') return { measured_at: body.measured_at || new Date().toISOString(), weight_kg: body.weight_kg || null, systolic: body.systolic || null, diastolic: body.diastolic || null, heart_rate: body.heart_rate || null, oxygen_saturation: body.oxygen_saturation || null, temperature_c: body.temperature_c || null, glucose_mg_dl: body.glucose_mg_dl || null, source: 'manual', notes: text(body.notes, 500) };
  if (type === 'task') return { type: ['medication','lab','appointment','measurement','follow_up','vaccine','general'].includes(body.task_type) ? body.task_type : 'general', title: text(body.title, 180), details: text(body.details, 1500), due_at: body.due_at || null, recurrence_rule: text(body.recurrence_rule, 300), status: 'open' };
  if (type === 'insurance') return { provider_name: text(body.provider_name, 160), policy_number: text(body.policy_number, 120), plan_name: text(body.plan_name, 120), valid_from: body.valid_from || null, valid_until: body.valid_until || null, is_primary: body.is_primary !== false };
  return null;
}

export default async function handler(req, res) {
  const session = requireUser(req, res);
  if (!session) return;
  if (!['POST','PATCH','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const type = String(body.type || '');
  const table = TYPE_MAP[type];
  const patientId = String(body.patient_id || '');
  if (!table || !patientId || !(await ensureOwned(session.sub, patientId))) return res.status(400).json({ success: false, error: 'درخواست معتبر نیست' });

  try {
    if (req.method === 'POST') {
      const payload = build(type, body);
      if (!payload) return res.status(400).json({ success: false, error: 'نوع اطلاعات پشتیبانی نمی‌شود' });
      const required = type === 'condition' ? payload.name : type === 'allergy' ? payload.allergen : type === 'medication' ? payload.name : type === 'vaccination' ? payload.vaccine_name : type === 'task' ? payload.title : type === 'insurance' ? payload.provider_name : true;
      if (!required) return res.status(400).json({ success: false, error: 'اطلاعات ضروری کامل نیست' });
      const { data, error } = await supabase.from(table).insert({ patient_id: patientId, ...payload }).select('*').single();
      if (error) throw error;
      await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.created`, resource_type: type, resource_id: data.id });
      return res.status(201).json({ success: true, item: data });
    }

    const id = String(body.id || '');
    if (!id) return res.status(400).json({ success: false, error: 'شناسه لازم است' });
    const { data: existing } = await supabase.from(table).select('id').eq('id', id).eq('patient_id', patientId).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'آیتم پیدا نشد' });

    if (req.method === 'DELETE') {
      await supabase.from(table).delete().eq('id', id).eq('patient_id', patientId);
      await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.deleted`, resource_type: type, resource_id: id });
      return res.status(200).json({ success: true });
    }

    const payload = build(type, body);
    delete payload.patient_id;
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).eq('patient_id', patientId).select('*').single();
    if (error) throw error;
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.updated`, resource_type: type, resource_id: id });
    return res.status(200).json({ success: true, item: data });
  } catch (error) {
    console.error('health-entry', error);
    return res.status(500).json({ success: false, error: 'ثبت اطلاعات سلامت انجام نشد' });
  }
}
