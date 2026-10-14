import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { readPublicPrivateAISettings, savePrivateAISettings } from './_lib/private-ai-settings.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      const settings = await readPublicPrivateAISettings(supabase);
      return res.status(200).json({ success: true, settings });
    }
    if (req.method !== 'PUT') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const settings = await savePrivateAISettings(req.body, supabase);
    // The audit contains configuration metadata only, never the key or ciphertext.
    const { error: auditError } = await supabase.from('audit_logs').insert({
      actor_type: 'admin', action: 'ai.settings.updated', resource_type: 'app_settings',
      metadata: { key: 'private_ai', provider: settings.provider, free_only: true, key_configured: settings.key_configured }
    });
    if (auditError) console.error('admin-ai-settings-audit', safeErrorMetadata(auditError));
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error('admin-ai-settings', safeErrorMetadata(error));
    const messages = {
      AI_SETTINGS_INVALID_CONFIGURATION: 'سرویس هوش مصنوعی یا تنظیمات واردشده معتبر نیست.',
      AI_SETTINGS_INVALID_KEY: 'کلید API معتبر وارد کنید. هنگام حذف کلید، کلید جدید وارد نکنید.',
      AI_SETTINGS_KEY_REQUIRED: 'برای این سرویس، کلید API را وارد کنید.',
      AI_SETTINGS_ENCRYPTION_UNAVAILABLE: 'ذخیره امن کلید آماده نیست؛ تنظیمات رمزگذاری سرور باید بررسی شود.'
    };
    return res.status(error?.status === 400 ? 400 : 503).json({ success: false, error: messages[error?.message] || 'تنظیمات هوش مصنوعی دریافت یا ذخیره نشد؛ دوباره تلاش کنید.' });
  }
}
