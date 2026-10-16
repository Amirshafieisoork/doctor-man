import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { readPublicDigiPaySettings, savePrivateDigiPaySettings } from './_lib/private-digipay-settings.js';
import { allowDigiPayAdminAction } from './_lib/digipay-admin-security.js';

const MESSAGES = {
  DIGIPAY_INVALID_CONFIGURATION: 'محیط اتصال یا گزینه‌های واردشده معتبر نیست.',
  DIGIPAY_INVALID_CREDENTIALS: 'اطلاعات اتصال باید متن معتبر و بدون فاصله یا خط جدید باشد.',
  DIGIPAY_CREDENTIALS_REQUIRED: 'هر چهار اطلاعات فنی دیجی‌پی لازم است: شناسه و سکرت، نام کاربری و رمز API.',
  DIGIPAY_ENVIRONMENT_CREDENTIALS_REQUIRED: 'برای تغییر محیط، هر چهار اطلاعات مخصوص همان محیط را دوباره وارد کنید.',
  DIGIPAY_SETTINGS_CHANGED: 'تنظیمات هم‌زمان تغییر کرده است؛ وضعیت را دریافت و دوباره ذخیره کنید.',
  DIGIPAY_ENCRYPTION_UNAVAILABLE: 'ذخیره امن اطلاعات در سرور آماده نیست؛ تنظیمات رمزگذاری باید بررسی شود.'
};
export function createAdminDigiPaySettingsHandler({ database = supabase, rateLimit } = {}) {
  return async function handler(req, res) {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (req.method === 'GET') return res.status(200).json({ success: true, settings: await readPublicDigiPaySettings(database) });
      if (req.method !== 'PUT') return res.status(405).json({ success: false, error: 'Method not allowed' });
      if (!await allowDigiPayAdminAction(req, res, 'admin_digipay_settings', 8, rateLimit)) return;
      const settings = await savePrivateDigiPaySettings(req.body, database);
      const { error } = await database.from('audit_logs').insert({ actor_type: 'admin', action: 'digipay.settings.updated', resource_type: 'app_settings', metadata: { key: 'private_digipay', environment: settings.environment, configured: settings.configured } });
      if (error) console.error('admin-digipay-audit', safeErrorMetadata(error));
      return res.status(200).json({ success: true, settings });
    } catch (error) {
      console.error('admin-digipay-settings', safeErrorMetadata(error));
      return res.status([400, 409].includes(error?.status) ? error.status : 503).json({ success: false, error: MESSAGES[error?.code] || 'دریافت یا ذخیره امن اطلاعات دیجی‌پی انجام نشد؛ دوباره تلاش کنید.' });
    }
  };
}
export default createAdminDigiPaySettingsHandler();
