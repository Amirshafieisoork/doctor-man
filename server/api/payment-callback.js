import { supabase } from './_lib/db.js';
import { verifyDigiPayPayment } from './_lib/digipay.js';

function bodyValue(body, key) {
  if (!body) return '';
  if (typeof body === 'string') return new URLSearchParams(body).get(key) || '';
  return String(body[key] ?? '');
}

function redirect(res, status, paymentId = '') {
  const query = new URLSearchParams({ status, payment_id: paymentId }).toString();
  res.statusCode = 303;
  res.setHeader('Location', `/payment-result.html?${query}`);
  res.end();
}

export default async function handler(req, res) {
  if (!['POST', 'GET'].includes(req.method)) return res.status(405).end('Method not allowed');

  const source = req.method === 'GET' ? req.query : req.body;
  const providerId = bodyValue(source, 'providerId') || bodyValue(source, 'provider_id');
  const trackingCode = bodyValue(source, 'trackingCode') || bodyValue(source, 'tracking_code');
  const callbackAmount = Number(bodyValue(source, 'amount') || 0);

  if (!providerId) return redirect(res, 'failed');

  const { data: payment } = await supabase
    .from('payments')
    .select('id,user_id,plan_id,amount,status,plans(id,name,slug,duration_days)')
    .eq('id', providerId)
    .single();

  if (!payment) return redirect(res, 'failed', providerId);
  if (payment.status === 'paid') return redirect(res, 'success', payment.id);

  await supabase.from('payments').update({ raw_callback: source || {}, tracking_code: trackingCode || null }).eq('id', payment.id);

  // Callback fields are not trusted as proof of payment. Without a tracking code
  // there is nothing to verify server-side, so the transaction stays unsuccessful.
  if (!trackingCode) {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    return redirect(res, 'failed', payment.id);
  }

  if (callbackAmount && callbackAmount !== Number(payment.amount) * 10) {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    return redirect(res, 'failed', payment.id);
  }

  try {
    const verified = await verifyDigiPayPayment({ trackingCode, providerId: payment.id });
    const verifiedAmount = Number(verified.amount || 0);
    if (verified.providerId && String(verified.providerId) !== String(payment.id)) throw new Error('PROVIDER_MISMATCH');
    if (!verifiedAmount || verifiedAmount !== Number(payment.amount) * 10) throw new Error('AMOUNT_MISMATCH');

    const now = new Date();
    const duration = Number(payment.plans?.duration_days || 30);
    const expires = new Date(now.getTime() + duration * 86400000);

    const { error: userError } = await supabase.from('users').update({
      plan_id: payment.plan_id,
      plan_started_at: now.toISOString(),
      plan_expires_at: expires.toISOString()
    }).eq('id', payment.user_id);
    if (userError) throw userError;

    await supabase.from('payments').update({
      status: 'paid',
      tracking_code: trackingCode,
      paid_at: now.toISOString(),
      raw_callback: { ...(typeof source === 'object' ? source : {}), verified }
    }).eq('id', payment.id);

    return redirect(res, 'success', payment.id);
  } catch (error) {
    console.error('payment verify failed', error);
    await supabase.from('payments').update({ status: 'pending' }).eq('id', payment.id);
    return redirect(res, 'pending', payment.id);
  }
}
