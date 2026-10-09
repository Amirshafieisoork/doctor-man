import { safeErrorMetadata } from './_lib/errors.js';
import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { createDigiPayTicket } from './_lib/digipay.js';

function sha256(value){return crypto.createHash('sha256').update(String(value)).digest('hex')}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const session=await requireUser(req,res);if(!session)return;
  if(!process.env.DIGIPAY_CLIENT_ID||!process.env.DIGIPAY_CLIENT_SECRET||!process.env.DIGIPAY_USERNAME||!process.env.DIGIPAY_PASSWORD){
    return res.status(503).json({success:false,error:'درگاه دیجی‌پی هنوز توسط مدیر سایت فعال نشده است.',code:'DIGIPAY_NOT_CONFIGURED'});
  }

  try{
    const planId=String(req.body?.plan_id||'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(planId))return res.status(400).json({success:false,error:'پلن انتخاب‌شده معتبر نیست'});

    const [{data:user},{data:plan}]=await Promise.all([
      supabase.from('users').select('id,phone,status,plan_id,plan_expires_at').eq('id',session.sub).single(),
      supabase.from('plans').select('id,name,slug,price,duration_days,active').eq('id',planId).single()
    ]);

    if(!user||user.status!=='active')return res.status(403).json({success:false,error:'حساب کاربری برای پرداخت فعال نیست'});
    if(!plan||!plan.active)return res.status(404).json({success:false,error:'این پلن در دسترس نیست'});

    const amountToman=Number(plan.price),durationDays=Number(plan.duration_days||30);
    if(!Number.isSafeInteger(amountToman)||amountToman<=0)return res.status(400).json({success:false,error:'پلن رایگان نیاز به پرداخت ندارد'});
    if(!Number.isInteger(durationDays)||durationDays<1||durationDays>3650)throw new Error('INVALID_PLAN_DURATION');

    // A new checkout supersedes older unfinished checkouts for this same user/plan.
    await supabase.from('payments').update({status:'cancelled'})
      .eq('user_id',user.id).eq('plan_id',plan.id)
      .in('status',['initiated','redirected','pending']);

    const nonce=crypto.randomBytes(32).toString('base64url');
    const amountRial=amountToman*10;
    const {data:payment,error:insertError}=await supabase.from('payments').insert({
      user_id:user.id,
      plan_id:plan.id,
      amount:amountToman,
      amount_rial:amountRial,
      plan_slug_snapshot:plan.slug,
      plan_name_snapshot:plan.name,
      duration_days_snapshot:durationDays,
      checkout_nonce_hash:sha256(nonce),
      provider:'digipay',
      status:'initiated'
    }).select('id').single();
    if(insertError||!payment)throw insertError||new Error('PAYMENT_CREATE_FAILED');

    const configuredBase=String(process.env.PUBLIC_BASE_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').replace(/\/$/,'');
    const origin=configuredBase?(configuredBase.startsWith('http')?configuredBase:`https://${configuredBase}`):`https://${req.headers.host}`;
    const callbackUrl=`${origin}/api/payment-callback?nonce=${encodeURIComponent(nonce)}`;

    try{
      const ticket=await createDigiPayTicket({amountRial,cellNumber:user.phone,providerId:payment.id,callbackUrl});
      const {error:updateError}=await supabase.from('payments').update({
        ticket:ticket.ticket,
        provider_id:payment.id,
        status:'redirected'
      }).eq('id',payment.id).eq('status','initiated');
      if(updateError)throw updateError;

      await supabase.from('audit_logs').insert({
        actor_user_id:user.id,actor_type:'user',action:'payment.started',
        resource_type:'payment',resource_id:payment.id,
        metadata:{provider:'digipay',plan_slug:plan.slug,amount_rial:amountRial}
      }).catch(()=>null);

      return res.status(200).json({success:true,redirect_url:ticket.redirectUrl,payment_id:payment.id});
    }catch(gatewayError){
      await supabase.from('payments').update({status:'failed'}).eq('id',payment.id).eq('status','initiated');
      if(gatewayError.message==='DIGIPAY_NOT_CONFIGURED'){
        return res.status(503).json({success:false,error:gatewayError.publicMessage||'درگاه دیجی‌پی فعال نشده است',code:'DIGIPAY_NOT_CONFIGURED'});
      }
      throw gatewayError;
    }
  }catch(error){
    console.error('payment-start',safeErrorMetadata(error));
    return res.status(500).json({success:false,error:'شروع پرداخت انجام نشد. لطفاً دوباره تلاش کنید.'});
  }
}
