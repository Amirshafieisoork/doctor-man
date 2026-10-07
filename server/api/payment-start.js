import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { createDigiPayTicket } from './_lib/digipay.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireUser(req, res);
  if (!session) return;

  try {
    const planId = String(req.body?.plan_id || '').trim();
    if (!planId) return res.status(400).json({ success: false, error: 'پلن انتخاب نشده است' });

    const [{ data: user }, { data: plan }] = await Promise.all([
      supabase.from('users').select('id,phone,status').eq('id', session.sub).single(),
      supabase.from('plans').select('id,name,slug,price,duration_days,active').eq('id', planId).single()
    ]);

    if (!user || user.status === 'blocked') return res.status(403).json({ success: false, error: 'حساب کاربری معتبر نیست' });
    if (!plan || !plan.active) return res.status(404).json({ success: false, error: 'این پلن در دسترس نیست' });
    if (Number(plan.price) <= 0) return res.status(400).json({ success: false, error: 'پلن رایگان نیاز به پرداخت ندارد' });

    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert({ user_id: user.id, plan_id: plan.id, amount: Number(plan.price), provider: 'digipay', status: 'initiated' })
      .select('id')
      .single();
    if (insertError || !payment) throw insertError || new Error('PAYMENT_CREATE_FAILED');

    const callbackBase = String(process.env.PUBLIC_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '').replace(/\/$/, '');
    const origin = callbackBase ? (callbackBase.startsWith('http') ? callbackBase : `https://${callbackBase}`) : `https://${req.headers.host}`;
    const callbackUrl = `${origin}/api/payment-callback`;

    try {
      const ticket = await createDigiPayTicket({
        amountRial: Number(plan.price) * 10,
        cellNumber: user.phone,
        providerId: payment.id,
        callbackUrl
      });

      await supabase.from('payments').update({ ticket: ticket.ticket, provider_id: payment.id, status: 'redirected' }).eq('id', payment.id);
      return res.status(200).json({ success: true, redirect_url: ticket.redirectUrl, payment_id: payment.id });
    } catch (gatewayError) {
      await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      if (gatewayError.message === 'DIGIPAY_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, error: gatewayError.publicMessage || 'درگاه دیجی‌پی فعال نشده است', code: 'DIGIPAY_NOT_CONFIGURED' });
      }
      throw gatewayError;
    }
  } catch (error) {
    console.error('payment-start', error);
    return res.status(500).json({ success: false, error: 'شروع پرداخت انجام نشد. لطفاً دوباره تلاش کنید.' });
  }
}
