import crypto from 'node:crypto';
import { supabase } from './db.js';

function key(req,action,subject=''){
  const ip=String(req.headers?.['x-forwarded-for']||req.headers?.['x-real-ip']||'unknown').split(',')[0].trim().slice(0,120);
  return crypto.createHash('sha256').update([action,ip,String(subject).toLowerCase()].join('|')).digest('hex');
}
export async function allowRate(req,{action,subject='',limit=8,windowMinutes=15}={}){
  const keyHash=key(req,action,subject);
  const windowMs=Math.max(1,windowMinutes)*60000;
  const fullWindowSeconds=Math.ceil(windowMs/1000);
  const since=new Date(Date.now()-windowMs).toISOString();
  const {count,error}=await supabase.from('auth_rate_events').select('id',{count:'exact',head:true}).eq('key_hash',keyHash).eq('action',action).gte('created_at',since);
  if(error){console.error('rate-limit count',error?.code||'DATABASE_ERROR');return {allowed:false,unavailable:true,keyHash}}
  if(Number(count||0)>=limit){
    let retryAfterSeconds=fullWindowSeconds;
    try{
      // Admission resumes when fewer than limit events remain. If concurrent
      // reservations exceeded the limit, the oldest event alone is too early.
      const {data:event,error:expiryError}=await supabase.from('auth_rate_events').select('created_at')
        .eq('key_hash',keyHash).eq('action',action).gte('created_at',since)
        .order('created_at',{ascending:false}).range(limit-1,limit-1).maybeSingle();
      const createdAt=Date.parse(event?.created_at),now=Date.now();
      if(!expiryError&&Number.isFinite(createdAt)&&createdAt>=Date.parse(since)&&createdAt<=now){
        // gte includes an event exactly on the window boundary.
        retryAfterSeconds=Math.max(1,Math.min(fullWindowSeconds,Math.ceil((createdAt+windowMs+1-now)/1000)));
      }
    }catch{/* Keep the denial and conservative wait if expiry lookup fails. */}
    return {allowed:false,keyHash,retry_after_seconds:retryAfterSeconds};
  }
  // Count an allowed attempt before password work, including validation errors
  // and duplicate registrations; otherwise those paths bypass the limiter.
  const {data:event,error:insertError}=await supabase.from('auth_rate_events').insert({key_hash:keyHash,action,success:false}).select('id').single();
  if(insertError||!event){console.error('rate-limit reserve',insertError?.code||'DATABASE_ERROR');return {allowed:false,unavailable:true,keyHash}}
  return {allowed:true,keyHash,eventId:event.id,retry_after_seconds:fullWindowSeconds};
}
export async function recordRate(keyHash,action,success=false,eventId){
  if(!keyHash||!eventId)return;
  // PostgREST builders are thenables, not native Promises with .catch(). The
  // attempt is already reserved, so bookkeeping must not prevent login.
  try{
    const {error}=await supabase.from('auth_rate_events').update({success:Boolean(success)}).eq('id',eventId).eq('key_hash',keyHash).eq('action',action);
    if(error)console.error('rate-limit record',error?.code||'DATABASE_ERROR');
  }catch(error){console.error('rate-limit record',error?.code||'DATABASE_ERROR')}
}
