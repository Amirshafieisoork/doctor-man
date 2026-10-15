import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const publicFields = 'id,enabled,show_blood_type,show_allergies,show_conditions,show_medications,show_emergency_contact,updated_at';
const scopes = ['show_blood_type', 'show_allergies', 'show_conditions', 'show_medications', 'show_emergency_contact'];
const hash = token => crypto.createHash('sha256').update(token).digest('hex');

export function createEmergencyCardHandler({ database = supabase, authenticate = requireUser } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const session = await authenticate(req, res);
    if (!session) return;
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'روش درخواست مجاز نیست.' });
    const body = req.body || {}, patientId = String((req.method === 'GET' ? req.query?.patient_id : body.patient_id) || '').trim();
    if (!patientId || patientId.length > 100) return res.status(400).json({ success: false, error: 'پرونده را انتخاب کنید.' });
    if (req.method === 'POST' && (typeof body.enabled !== 'boolean' || scopes.some(key => body[key] !== undefined && typeof body[key] !== 'boolean'))) {
      return res.status(400).json({ success: false, error: 'تنظیمات نمایش کارت معتبر نیست.' });
    }
    try {
      const owned = await database.from('patients').select('id').eq('id', patientId).eq('owner_user_id', session.sub).maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return res.status(404).json({ success: false, error: 'پرونده پیدا نشد.' });
      if (req.method === 'GET') {
        const result = await database.from('emergency_cards').select(publicFields).eq('patient_id', patientId).maybeSingle();
        if (result.error) throw result.error;
        return res.status(200).json({ success: true, card: result.data || null });
      }
      // Only the SHA-256 digest is persisted. Making a new card revokes the previous QR immediately.
      const token = body.enabled ? crypto.randomBytes(24).toString('base64url') : null;
      const payload = { patient_id: patientId, enabled: body.enabled, token_hash: token ? hash(token) : null, updated_at: new Date().toISOString() };
      for (const key of scopes) payload[key] = body[key] !== false;
      const result = await database.from('emergency_cards').upsert(payload, { onConflict: 'patient_id' }).select(publicFields).single();
      if (result.error || !result.data) throw result.error || new Error('EMERGENCY_CARD_SAVE_FAILED');
      await database.from('audit_logs').insert({ actor_user_id: session.sub, actor_type: 'user', patient_id: patientId, action: body.enabled ? 'emergency_card.enabled' : 'emergency_card.disabled', resource_type: 'emergency_card', resource_id: result.data.id });
      return res.status(200).json({ success: true, card: result.data, url: token ? `/emergency/${token}` : null, notice: token ? 'کارت قبلی باطل شد. این کارت را اکنون ذخیره یا چاپ کنید؛ لینک فقط در همین نوبت در دسترس شماست.' : 'کارت و کد QR قبلی غیرفعال شدند.' });
    } catch {
      return res.status(503).json({ success: false, error: 'دریافت یا ذخیره کارت اضطراری انجام نشد؛ دوباره تلاش کنید.' });
    }
  };
}
export default createEmergencyCardHandler();
