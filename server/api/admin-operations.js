import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const definitions = {
  task: { table: 'care_tasks', fields: 'id,patient_id,type,title,details,due_at,status,priority,completed_at,created_at,patients(display_name,owner_user_id)', text: { title: 250, details: 3000 }, enums: { status: ['open','done','dismissed'], priority: ['routine','soon','urgent'] }, dates: ['due_at'] },
  order: { table: 'diagnostic_orders', fields: 'id,patient_id,order_type,items,clinical_note,priority,status,ordered_at,completed_at,destination_organization_id,patients(display_name,owner_user_id),doctor_profiles(full_name)', text: { clinical_note: 3000 }, enums: { status: ['ordered','scheduled','in_progress','completed','cancelled'], priority: ['routine','urgent'] }, items: true },
  episode: { table: 'care_episodes', fields: 'id,patient_id,title,kind,summary,goal,status,urgency,preferred_specialty,started_at,updated_at,patients(display_name,owner_user_id)', text: { title: 250, summary: 4000, goal: 1000, preferred_specialty: 160 }, enums: { status: ['open','monitoring','resolved','archived'], urgency: ['routine','soon','urgent'] }, updated: true },
  care_plan: { table: 'personalized_care_plans', fields: 'id,patient_id,user_id,status,plan,generated_at,valid_until,patients(display_name,owner_user_id)', text: {}, enums: { status: ['active','superseded','archived'] } }
};

export function operationPatch(kind, input) {
  const definition = definitions[kind];
  if (!definition || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_OPERATION');
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(definition.text, key)) {
      if (typeof value !== 'string' || value.length > definition.text[key]) throw new Error('INVALID_FIELD');
      patch[key] = value.trim();
      if (key === 'title' && !patch[key]) throw new Error('INVALID_FIELD');
    } else if (Object.hasOwn(definition.enums, key)) {
      if (!definition.enums[key].includes(value)) throw new Error('INVALID_FIELD');
      patch[key] = value;
    } else if (definition.dates?.includes(key)) {
      if (value === null || value === '') patch[key] = null;
      else if (typeof value === 'string' && Number.isFinite(Date.parse(value))) patch[key] = new Date(value).toISOString();
      else throw new Error('INVALID_FIELD');
    } else if (definition.items && key === 'items') {
      if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 250)) throw new Error('INVALID_FIELD');
      patch[key] = value.map(item => item.trim());
    } else throw new Error('INVALID_FIELD');
  }
  if (!Object.keys(patch).length) throw new Error('INVALID_FIELD');
  if (Object.hasOwn(patch, 'status')) {
    if (kind === 'task') patch.completed_at = patch.status === 'done' ? new Date().toISOString() : null;
    if (kind === 'order') patch.completed_at = patch.status === 'completed' ? new Date().toISOString() : null;
  }
  if (definition.updated) patch.updated_at = new Date().toISOString();
  return patch;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      const patientId = req.query?.patient_id;
      if (patientId && !UUID.test(patientId)) return res.status(400).json({ success: false, error: 'شناسه پرونده نامعتبر است' });
      const types = Object.keys(definitions);
      const results = await Promise.all(types.map(kind => {
        const definition = definitions[kind];
        let query = supabase.from(definition.table).select(definition.fields);
        if (patientId) query = query.eq('patient_id', patientId);
        return query.order(kind === 'episode' ? 'updated_at' : kind === 'care_plan' ? 'generated_at' : kind === 'order' ? 'ordered_at' : 'created_at', { ascending: false }).limit(500);
      }));
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      return res.status(200).json({ success: true, tasks: results[0].data || [], orders: results[1].data || [], episodes: results[2].data || [], care_plans: results[3].data || [] });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {}, kind = body.kind, id = String(body.id || ''), reason = String(body.reason || '').trim();
    if (!UUID.test(id) || !definitions[kind] || !reason || reason.length > 500) return res.status(400).json({ success: false, error: 'شناسه، نوع عملیات و دلیل تغییر لازم است' });
    let patch;
    try { patch = operationPatch(kind, body.patch); }
    catch { return res.status(400).json({ success: false, error: 'فیلد یا مقدار تغییر معتبر نیست' }); }
    const definition = definitions[kind];
    const { data: existing, error: lookupError } = await supabase.from(definition.table).select(definition.fields).eq('id', id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ success: false, error: 'مورد پیدا نشد' });
    const { data: item, error } = await supabase.rpc('admin_update_clinical_record', { p_kind: kind, p_id: id, p_patch: patch, p_reason: reason });
    if (error) throw error;
    if (!item) return res.status(409).json({ success: false, error: 'مورد تغییر کرده است؛ صفحه را تازه کنید' });
    // The service-only RPC records the reason and field names in the same
    // transaction. Clinical details stay outside the general audit feed.
    return res.status(200).json({ success: true, item });
  } catch (error) {
    console.error('admin-operations', safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'عملیات درمان در دسترس نیست؛ دوباره تلاش کنید' });
  }
}
