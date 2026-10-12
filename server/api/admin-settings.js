import { safeErrorMetadata } from './_lib/errors.js';
import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const KEYS = new Set(['general','seo','features']);
const text=(v,max=300)=>String(v??'').trim().slice(0,max);
const bool=v=>v===true||v==='true'||v===1||v==='1';

function clean(key, value={}){
  if(key==='general') return {
    site_name:text(value.site_name||'DrMan',80)||'DrMan',
    support_phone:text(value.support_phone,40),
    support_email:text(value.support_email,160),
    maintenance_mode:bool(value.maintenance_mode),
    registration_enabled:value.registration_enabled!==false&&value.registration_enabled!=='false',
    doctor_onboarding_enabled:value.doctor_onboarding_enabled!==false&&value.doctor_onboarding_enabled!=='false'
  };
  if(key==='seo') return {
    default_title:text(value.default_title,180),
    default_description:text(value.default_description,320)
  };
  if(key==='features') return {
    ai_support:bool(value.ai_support),health_navigator:bool(value.health_navigator),doctor_directory:bool(value.doctor_directory),appointments:bool(value.appointments),digipay:bool(value.digipay),family_profiles:bool(value.family_profiles)
  };
  return null;
}

export default async function handler(req,res){
  if(!requireAdmin(req,res)) return;
  try{
    if(req.method==='GET'){
      const {data,error}=await supabase.from('app_settings').select('key,value,description,updated_at').order('key'); if(error)throw error;
      const settings={}; for(const row of data||[]) settings[row.key]=row.value||{};
      return res.status(200).json({success:true,settings,rows:data||[]});
    }
    if(req.method==='PUT'){
      const key=String(req.body?.key||''); if(!KEYS.has(key))return res.status(400).json({success:false,error:'بخش تنظیمات معتبر نیست'});
      const value=clean(key,req.body?.value||{}); if(!value)return res.status(400).json({success:false,error:'تنظیمات نامعتبر است'});
      const {data,error}=await supabase.from('app_settings').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'}).select('key,value,updated_at').single(); if(error)throw error;
      await supabase.from('audit_logs').insert({actor_type:'admin',action:'settings.updated',resource_type:'app_settings',metadata:{key}});
      return res.status(200).json({success:true,setting:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('admin-settings',safeErrorMetadata(error));return res.status(500).json({success:false,error:'ذخیره تنظیمات انجام نشد'})}
}
