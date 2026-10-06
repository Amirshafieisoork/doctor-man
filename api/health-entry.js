import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const TYPE_MAP = {
  condition: 'patient_conditions',
  allergy: 'patient_allergies',
  medication: 'patient_medications',
  vaccination: 'patient_vaccinations',
  vital: 'patient_vitals',
  task: 'care_tasks',
  insurance: 'patient_insurances',
  procedure: 'patient_procedures',
  family_history: 'patient_family_history',
  screening: 'preventive_screenings'
};

async function ensureOwned(userId, patientId) {
  const { data } = await supabase.from('patients').select('id').eq('id', patientId).eq('owner_user_id', userId).maybeSingle();
  return Boolean(data);
}
function text(v, max = 500) { return v == null ? null : String(v).trim().slice(0, max); }
function numberOrNull(v,min,max){const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null;}
function build(type, body) {
  if (type === 'condition') return { name: text(body.name, 160), status: ['active','resolved','inactive'].includes(body.status) ? body.status : 'active', diagnosed_at: body.diagnosed_at || null, notes: text(body.notes, 2000) };
  if (type === 'allergy') return { allergen: text(body.allergen, 160), allergy_type: ['drug','food','environmental','other'].includes(body.allergy_type) ? body.allergy_type : 'other', severity: ['mild','moderate','severe','unknown'].includes(body.severity) ? body.severity : 'unknown', reaction: text(body.reaction, 500), notes: text(body.notes, 1500) };
  if (type === 'medication') return { name: text(body.name, 160), dose: text(body.dose, 120), route: text(body.route, 80), frequency: text(body.frequency, 120), instructions: text(body.instructions, 1000), started_at: body.started_at || null, ended_at: body.ended_at || null, status: ['active','paused','stopped','completed'].includes(body.status) ? body.status : 'active' };
  if (type === 'vaccination') return { vaccine_name: text(body.vaccine_name, 160), dose_number: text(body.dose_number, 80), administered_at: body.administered_at || null, next_due_at: body.next_due_at || null, provider: text(body.provider, 160), notes: text(body.notes, 1000) };
  if (type === 'vital') return { measured_at: body.measured_at || new Date().toISOString(), weight_kg: numberOrNull(body.weight_kg,1,500), systolic: numberOrNull(body.systolic,40,300), diastolic: numberOrNull(body.diastolic,20,200), heart_rate: numberOrNull(body.heart_rate,20,300), oxygen_saturation: numberOrNull(body.oxygen_saturation,40,100), temperature_c: numberOrNull(body.temperature_c,30,45), glucose_mg_dl: numberOrNull(body.glucose_mg_dl,20,1000), source: 'manual', notes: text(body.notes, 500) };
  if (type === 'task') return { type: ['medication','lab','appointment','measurement','follow_up','vaccine','general'].includes(body.task_type) ? body.task_type : 'general', title: text(body.title, 180), details: text(body.details, 1500), due_at: body.due_at || null, recurrence_rule: text(body.recurrence_rule, 300), status: ['open','completed','cancelled'].includes(body.status)?body.status:'open', completed_at: body.status==='completed' ? new Date().toISOString() : null };
  if (type === 'insurance') return { provider_name: text(body.provider_name, 160), policy_number: text(body.policy_number, 120), plan_name: text(body.plan_name, 120), valid_from: body.valid_from || null, valid_until: body.valid_until || null, is_primary: body.is_primary !== false };
  if (type === 'procedure') return { name: text(body.name,180), procedure_type: ['surgery','procedure','hospitalization','dental','other'].includes(body.procedure_type)?body.procedure_type:'procedure', performed_at: body.performed_at||null, outcome:text(body.outcome,1000), notes:text(body.notes,2000) };
  if (type === 'family_history') return { relation: text(body.relation,100), condition_name:text(body.condition_name,180), age_at_diagnosis:numberOrNull(body.age_at_diagnosis,0,120), notes:text(body.notes,1500) };
  if (type === 'screening') return { screening_name:text(body.screening_name,180), performed_at:body.performed_at||null, next_due_at:body.next_due_at||null, result_summary:text(body.result_summary,1500), status:['due','scheduled','completed','not_applicable'].includes(body.status)?body.status:'due' };
  return null;
}
function requiredValue(type,p){
  if(type==='condition'||type==='medication'||type==='procedure')return p.name;
  if(type==='allergy')return p.allergen;
  if(type==='vaccination')return p.vaccine_name;
  if(type==='task')return p.title;
  if(type==='insurance')return p.provider_name;
  if(type==='family_history')return p.relation&&p.condition_name;
  if(type==='screening')return p.screening_name;
  return true;
}

export default async function handler(req, res) {
  const session = requireUser(req, res); if (!session) return;
  if (!['POST','PATCH','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const type = String(body.type || ''), table = TYPE_MAP[type], patientId = String(body.patient_id || '');
  if (!table || !patientId || !(await ensureOwned(session.sub, patientId))) return res.status(400).json({ success: false, error: 'درخواست معتبر نیست' });
  try {
    if (req.method === 'POST') {
      const payload = build(type, body); if (!payload) return res.status(400).json({ success: false, error: 'نوع اطلاعات پشتیبانی نمی‌شود' });
      if (!requiredValue(type,payload)) return res.status(400).json({ success: false, error: 'اطلاعات ضروری کامل نیست' });
      const { data, error } = await supabase.from(table).insert({ patient_id: patientId, ...payload }).select('*').single(); if (error) throw error;
      await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.created`, resource_type: type, resource_id: data.id });
      return res.status(201).json({ success: true, item: data });
    }
    const id = String(body.id || ''); if (!id) return res.status(400).json({ success: false, error: 'شناسه لازم است' });
    const { data: existing } = await supabase.from(table).select('id').eq('id', id).eq('patient_id', patientId).maybeSingle(); if (!existing) return res.status(404).json({ success: false, error: 'آیتم پیدا نشد' });
    if (req.method === 'DELETE') {
      const {error}=await supabase.from(table).delete().eq('id', id).eq('patient_id', patientId); if(error)throw error;
      await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.deleted`, resource_type: type, resource_id: id });
      return res.status(200).json({ success: true });
    }
    const payload = build(type, body); const { data, error } = await supabase.from(table).update(payload).eq('id', id).eq('patient_id', patientId).select('*').single(); if (error) throw error;
    await supabase.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: `record.${type}.updated`, resource_type: type, resource_id: id });
    return res.status(200).json({ success: true, item: data });
  } catch (error) { console.error('health-entry', error); return res.status(500).json({ success: false, error: 'ثبت اطلاعات سلامت انجام نشد' }); }
}
