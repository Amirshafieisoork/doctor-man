import { safeErrorMetadata } from './_lib/errors.js';
import crypto from 'node:crypto';
import { supabase } from './_lib/db.js';
import { verifyDigiPayPayment } from './_lib/digipay.js';

function value(source,key){if(!source)return'';if(typeof source==='string')return new URLSearchParams(source).get(key)||'';return String(source[key]??'')}
function sha256(v){return crypto.createHash('sha256').update(String(v)).digest('hex')}
function safeEqual(a,b){try{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
function redirect(res,status,paymentId=''){const q=new URLSearchParams({status,payment_id:paymentId}).toString();res.statusCode=303;res.setHeader('Location',`/payment-result.html?${q}`);res.end()}
function mergeSource(req){return {...(req.query||{}),...(req.body&&typeof req.body==='object'?req.body:{})}}

export default async function handler(req,res){
  if(!['POST','GET'].includes(req.method))return res.status(405).end('Method not allowed');

  const source=mergeSource(req);
  const providerId=value(source,'providerId')||value(source,'provider_id');
  const trackingCode=value(source,'trackingCode')||value(source,'tracking_code');
  const nonce=value(source,'nonce');
  const callbackAmount=Number(value(source,'amount')||0);

  if(!/^[0-9a-f-]{36}$/i.test(providerId))return redirect(res,'failed');

  const {data:payment}=await supabase.from('payments')
    .select('id,user_id,plan_id,amount,amount_rial,status,provider_id,checkout_nonce_hash,verify_attempts')
    .eq('id',providerId).maybeSingle();

  if(!payment)return redirect(res,'failed',providerId);
  if(payment.status==='paid')return redirect(res,'success',payment.id);
  if(['failed','cancelled'].includes(payment.status))return redirect(res,'failed',payment.id);

  if(!nonce||!payment.checkout_nonce_hash||!safeEqual(sha256(nonce),payment.checkout_nonce_hash)){
    await supabase.from('audit_logs').insert({
      actor_type:'system',action:'payment.callback_nonce_rejected',resource_type:'payment',resource_id:payment.id,
      metadata:{provider:'digipay'}
    }).catch(()=>null);
    return redirect(res,'failed',payment.id);
  }

  const attempts=Math.min(100,Number(payment.verify_attempts||0)+1);
  await supabase.from('payments').update({
    raw_callback:source,
    tracking_code:trackingCode||null,
    verify_attempts:attempts,
    status:trackingCode?'pending':payment.status
  }).eq('id',payment.id);

  if(!trackingCode)return redirect(res,'pending',payment.id);
  if(callbackAmount&&callbackAmount!==Number(payment.amount_rial)){
    return redirect(res,'pending',payment.id);
  }

  try{
    const verified=await verifyDigiPayPayment({trackingCode,providerId:payment.id});
    const verifiedAmount=Number(verified.amount||0);
    const verifiedProviderId=String(verified.providerId||'');

    if(!verifiedAmount||verifiedAmount!==Number(payment.amount_rial))throw new Error('AMOUNT_MISMATCH');
    if(verifiedProviderId!==String(payment.id))throw new Error('PROVIDER_MISMATCH');

    const {data:finalized,error:finalizeError}=await supabase.rpc('finalize_digipay_payment',{
      p_payment_id:payment.id,
      p_tracking_code:trackingCode,
      p_verified_amount_rial:verifiedAmount,
      p_verified_provider_id:verifiedProviderId,
      p_verify_payload:verified
    });
    if(finalizeError)throw finalizeError;
    if(!finalized?.ok)throw new Error('FINALIZE_FAILED');

    return redirect(res,'success',payment.id);
  }catch(error){
    console.error('payment verify/finalize failed',safeErrorMetadata(error));
    await supabase.from('payments').update({status:'pending'}).eq('id',payment.id).neq('status','paid');
    return redirect(res,'pending',payment.id);
  }
}
