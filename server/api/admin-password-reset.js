import {supabase} from './_lib/db.js';
import {requireAdmin} from './_lib/session.js';
import {allowRate,recordRate} from './_lib/rate-limit.js';
import {createResetToken,hashResetToken,recoveryOrigin,RESET_TOKEN_SECONDS,recoveryUnavailable,recoveryRateDenied} from './_lib/password-reset.js';

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method==='GET'){
    const {data,error}=await supabase.from('password_reset_requests').select('id,user_id,requested_at,status,users(id,name,phone)').eq('status','pending').order('requested_at',{ascending:false}).limit(100);
    if(error)return recoveryUnavailable(res);
    return res.status(200).json({success:true,requests:data||[]});
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const userId=String(req.body?.user_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))return res.status(400).json({success:false,error:'حساب معتبر انتخاب کنید.'});
  const gate=await allowRate(req,{action:'admin-password-reset',subject:userId,limit:5,windowMinutes:30});
  if(gate.unavailable)return recoveryUnavailable(res);
  if(!gate.allowed)return recoveryRateDenied(res,gate);
  const token=createResetToken(),origin=recoveryOrigin(req);
  const {data,error}=await supabase.rpc('issue_password_reset_token',{p_user_id:userId,p_token_hash:hashResetToken(token),p_ttl_seconds:RESET_TOKEN_SECONDS});
  if(error){console.error('password reset issue',error.code||'DATABASE_ERROR');return recoveryUnavailable(res);}
  const issued=Array.isArray(data)?data[0]:data;
  if(!issued?.expires_at)return res.status(404).json({success:false,error:'حساب فعال پیدا نشد.'});
  await recordRate(gate.keyHash,'admin-password-reset',true,gate.eventId);
  return res.status(201).json({success:true,reset_url:`${origin}/auth#reset=${token}`,expires_at:issued.expires_at});
}
