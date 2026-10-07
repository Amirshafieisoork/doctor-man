import crypto from 'node:crypto';
import { supabase } from './db.js';

function key(req,action,subject=''){
  const ip=String(req.headers?.['x-forwarded-for']||req.headers?.['x-real-ip']||'unknown').split(',')[0].trim().slice(0,120);
  return crypto.createHash('sha256').update([action,ip,String(subject).toLowerCase()].join('|')).digest('hex');
}
export async function allowRate(req,{action,subject='',limit=8,windowMinutes=15}={}){
  const keyHash=key(req,action,subject);
  const since=new Date(Date.now()-Math.max(1,windowMinutes)*60000).toISOString();
  const {count,error}=await supabase.from('auth_rate_events').select('id',{count:'exact',head:true}).eq('key_hash',keyHash).eq('action',action).gte('created_at',since);
  if(error){console.error('rate-limit count',error);return {allowed:true,keyHash}}
  return {allowed:Number(count||0)<limit,keyHash,retry_after_seconds:Math.max(30,windowMinutes*60)};
}
export async function recordRate(keyHash,action,success=false){
  if(!keyHash)return;
  await supabase.from('auth_rate_events').insert({key_hash:keyHash,action,success:Boolean(success)}).catch(()=>null);
}
