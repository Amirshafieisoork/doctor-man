import {supabase} from './_lib/db.js';
import {allowRate,recordRate} from './_lib/rate-limit.js';
import {normalizeIranianMobile} from './_lib/phone.js';
import {RESET_REQUEST_MESSAGE,recoveryUnavailable,recoveryRateDenied} from './_lib/password-reset.js';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const phone=normalizeIranianMobile(req.body?.phone);
  const gate=await allowRate(req,{action:'password-reset-request',limit:5,windowMinutes:30});
  if(gate.unavailable)return recoveryUnavailable(res);
  if(!gate.allowed)return recoveryRateDenied(res,gate);
  if(!/^09\d{9}$/.test(phone))return res.status(400).json({success:false,error:'شماره موبایل معتبر وارد کنید.'});
  // The same database call and response serve active, blocked and missing
  // accounts. Do not reveal existence through an extra remote write/read.
  const {error}=await supabase.rpc('request_password_reset',{p_phone:phone});
  if(error)return recoveryUnavailable(res);
  await recordRate(gate.keyHash,'password-reset-request',true,gate.eventId);
  return res.status(202).json({success:true,message:RESET_REQUEST_MESSAGE,delivery:'support'});
}
