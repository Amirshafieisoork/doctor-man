import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { verifyDigiPayPayment } from './_lib/digipay.js';

async function tryFinalize(payment){
  if(!payment?.tracking_code||!['pending','redirected'].includes(payment.status))return payment;
  try{
    const verified=await verifyDigiPayPayment({trackingCode:payment.tracking_code,providerId:payment.id});
    const amount=Number(verified.amount||0),providerId=String(verified.providerId||payment.id);
    if(amount!==Number(payment.amount_rial)||providerId!==String(payment.id))throw new Error('VERIFY_MISMATCH');
    const {error}=await supabase.rpc('finalize_digipay_payment',{
      p_payment_id:payment.id,p_tracking_code:payment.tracking_code,
      p_verified_amount_rial:amount,p_verified_provider_id:providerId,p_verify_payload:verified
    });
    if(error)throw error;
    return {...payment,status:'paid'};
  }catch(error){
    console.error('payment-status verify',error);
    return payment;
  }
}

export default async function handler(req,res){
  const session=requireUser(req,res);if(!session)return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const id=String(req.query?.payment_id||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({success:false,error:'شناسه پرداخت معتبر نیست'});

  let {data:payment}=await supabase.from('payments')
    .select('id,status,amount,amount_rial,tracking_code,created_at,paid_at,verified_at,plan_slug_snapshot,plan_name_snapshot')
    .eq('id',id).eq('user_id',session.sub).maybeSingle();
  if(!payment)return res.status(404).json({success:false,error:'پرداخت پیدا نشد'});

  payment=await tryFinalize(payment);
  if(payment.status==='paid'){
    const {data:fresh}=await supabase.from('payments')
      .select('id,status,amount,amount_rial,created_at,paid_at,verified_at,plan_slug_snapshot,plan_name_snapshot')
      .eq('id',id).eq('user_id',session.sub).single();
    payment=fresh||payment;
  }
  return res.status(200).json({success:true,payment});
}
