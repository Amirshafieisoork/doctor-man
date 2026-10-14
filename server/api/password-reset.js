import {supabase} from './_lib/db.js';
import {allowRate,recordRate} from './_lib/rate-limit.js';
import {clearUserSession} from './_lib/session.js';
import {isResetToken,hashResetToken,hashNewPassword,recoveryUnavailable,recoveryRateDenied} from './_lib/password-reset.js';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const gate=await allowRate(req,{action:'password-reset-confirm',limit:8,windowMinutes:15});
  if(gate.unavailable)return recoveryUnavailable(res);
  if(!gate.allowed)return recoveryRateDenied(res,gate);
  const token=req.body?.token,password=req.body?.password;
  if(!isResetToken(token)||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({success:false,error:'پیوند معتبر و رمز جدید ۸ تا ۱۲۸ کاراکتری لازم است.'});
  const {data,error}=await supabase.rpc('consume_password_reset_token',{p_token_hash:hashResetToken(token),p_password_hash:hashNewPassword(password)});
  if(error){console.error('password reset consume',error.code||'DATABASE_ERROR');return recoveryUnavailable(res);}
  const changed=Array.isArray(data)?data[0]:data;
  if(!changed?.user_id)return res.status(400).json({success:false,code:'RESET_LINK_INVALID',error:'پیوند بازنشانی استفاده شده یا منقضی شده است. پیوند تازه درخواست کنید.'});
  clearUserSession(res);
  await recordRate(gate.keyHash,'password-reset-confirm',true,gate.eventId);
  return res.status(200).json({success:true,message:'رمز عبور تغییر کرد. با رمز جدید وارد حساب شوید.'});
}
