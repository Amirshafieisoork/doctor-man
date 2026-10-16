import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { readEffectiveDigiPaySettings, recordDigiPayAuthCheck } from './_lib/private-digipay-settings.js';
import { requestDigiPayToken } from './_lib/digipay.js';
import { allowDigiPayAdminAction } from './_lib/digipay-admin-security.js';

const MESSAGES = {
  DIGIPAY_NOT_CONFIGURED: 'هر چهار اطلاعات فنی اتصال را ابتدا ذخیره کنید.',
  DIGIPAY_AUTH_FAILED: 'دیجی‌پی اطلاعات اتصال را نپذیرفت. شناسه و سکرت و نام کاربری و رمز API باید از دیجی‌پی و مربوط به همین محیط باشند؛ رمز حساب شخصی یا مقدار دلخواه را وارد نکنید.',
  DIGIPAY_RATE_LIMIT: 'دیجی‌پی موقتاً تعداد درخواست‌ها را محدود کرده است؛ کمی بعد دوباره تلاش کنید.',
  DIGIPAY_UNAVAILABLE: 'سرویس دیجی‌پی موقتاً پاسخ‌گو نیست؛ کمی بعد دوباره تلاش کنید.',
  DIGIPAY_TIMEOUT: 'آزمون دیجی‌پی در زمان مجاز پاسخ نداد؛ دوباره تلاش کنید.',
  DIGIPAY_NETWORK_ERROR: 'ارتباط امن با دیجی‌پی برقرار نشد؛ دوباره تلاش کنید.'
};
export function createAdminDigiPayTestHandler({ database = supabase, rateLimit, authenticate = requestDigiPayToken } = {}) {
  let running = false;
  return async function handler(req, res) {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    if (!await allowDigiPayAdminAction(req, res, 'admin_digipay_test', 4, rateLimit)) return;
    if (running) return res.status(409).json({ success: false, error: 'آزمون اتصال در حال اجرا است؛ منتظر نتیجه بمانید.' });
    running = true;
    let settings, code = 'DIGIPAY_NETWORK_ERROR';
    try {
      settings = await readEffectiveDigiPaySettings(database);
      // Only OAuth authentication: no ticket, order, purchase, charge or callback.
      await authenticate(settings);
      code = 'OK';
      return res.status(200).json({ success: true, authenticated: true, environment: settings.environment, code, message: 'اتصال فنی دیجی‌پی تأیید شد. آزمون هیچ سفارش یا پرداختی ایجاد نکرد.' });
    } catch (error) {
      code = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'DIGIPAY_TIMEOUT' : Object.hasOwn(MESSAGES, error?.message) ? error.message : 'DIGIPAY_NETWORK_ERROR';
      console.error('admin-digipay-test', { ...safeErrorMetadata(error), classification: code });
      return res.status(code === 'DIGIPAY_NOT_CONFIGURED' ? 503 : 502).json({ success: false, authenticated: false, code, error: MESSAGES[code] });
    } finally {
      try {
        if (settings) await recordDigiPayAuthCheck(settings, code, database);
        const { error } = await database.from('audit_logs').insert({ actor_type: 'admin', action: 'digipay.connection.tested', resource_type: 'app_settings', metadata: { environment: settings?.environment || null, authenticated: code === 'OK', code } });
        if (error) console.error('admin-digipay-test-audit', safeErrorMetadata(error));
      } catch (error) { console.error('admin-digipay-test-status', safeErrorMetadata(error)); }
      running = false;
    }
  };
}
export default createAdminDigiPayTestHandler();
