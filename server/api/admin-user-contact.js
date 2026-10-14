import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, max) => String(value ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const userId = String(req.method === 'GET' ? req.query?.user_id || '' : req.body?.user_id || '');
  if (!UUID.test(userId)) return res.status(400).json({ success: false, error: 'شناسه کاربر نامعتبر است' });
  try {
    const { data: user, error: userError } = await supabase.from('users').select('id,name,phone,status').eq('id', userId).maybeSingle();
    if (userError) throw userError;
    if (!user || user.phone?.startsWith('deleted-')) return res.status(404).json({ success: false, error: 'کاربر پیدا نشد' });
    const key = `admin_user_${userId}`;
    if (req.method === 'GET') {
      const [notes, messages] = await Promise.all([
        supabase.from('app_settings').select('value,updated_at').eq('key', key).maybeSingle(),
        supabase.from('notifications').select('id,title,body,read_at,created_at').eq('user_id', userId).eq('type','admin_message').order('created_at',{ascending:false}).limit(30)
      ]);
      if (notes.error) throw notes.error;
      if (messages.error) throw messages.error;
      return res.status(200).json({ success: true, user, note: text(notes.data?.value?.note, 3000), labels: notes.data?.value?.labels || [], messages: messages.data || [] });
    }
    const reason = text(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ success: false, error: 'دلیل ثبت تغییر لازم است' });
    if (req.method === 'PUT') {
      const note = text(req.body?.note, 3000), labels = [...new Set((Array.isArray(req.body?.labels) ? req.body.labels : []).map(label => text(label, 40)).filter(Boolean))].slice(0, 10);
      const { data: saved, error } = await supabase.rpc('admin_update_user_annotation', { p_user_id: userId, p_note: note, p_labels: labels, p_reason: reason });
      if (error) throw error;
      if (saved !== true) throw new Error('ANNOTATION_NOT_CONFIRMED');
      return res.status(200).json({ success: true });
    }
    if (req.method === 'POST') {
      const title = text(req.body?.title, 160), body = text(req.body?.message, 3000);
      if (!title || !body) return res.status(400).json({ success: false, error: 'عنوان و متن پیام لازم است' });
      if (user.status !== 'active') return res.status(409).json({ success: false, error: 'ارسال پیام به حساب غیرفعال ممکن نیست؛ ابتدا حساب را فعال کنید' });
      const { data: message, error } = await supabase.rpc('admin_send_user_message', { p_user_id: userId, p_title: title, p_message: body, p_reason: reason });
      if (error) throw error;
      if (!message?.id) throw new Error('MESSAGE_NOT_CONFIRMED');
      return res.status(201).json({ success: true, message });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin-user-contact', safeErrorMetadata(error));
    return res.status(503).json({ success: false, error: 'مدیریت یادداشت یا پیام انجام نشد؛ دوباره تلاش کنید' });
  }
}
