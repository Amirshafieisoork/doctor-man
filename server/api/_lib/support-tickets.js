import crypto from 'node:crypto';
import { supabase } from './db.js';
import { avalaiClient } from './ai-models.js';
import { generateSupportAnswer,supportEvidence,supportStoredAnswer } from './support-evidence.js';
import { safeErrorMetadata } from './errors.js';

export const ticketId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
export const ticketText=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export const categories=new Set(['account','billing','upload','doctor','other']);
export const statuses=new Set(['open','waiting_admin','waiting_user','closed']);
export function ticketTags(value){return Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string').map(v=>v.trim().slice(0,40)).filter(Boolean))].slice(0,8):[];}
export async function fetchTicket(id,userId){
  let query=supabase.from('support_tickets').select('id,user_id,title,category,status,ai_enabled,tags,created_at,updated_at').eq('id',id);
  if(userId)query=query.eq('user_id',userId);
  const {data,error}=await query.maybeSingle();if(error)throw error;return data;
}
export async function fetchTicketMessages(id){const {data,error}=await supabase.from('support_ticket_messages').select('id,sender_type,content,created_at').eq('ticket_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(300);if(error)throw error;return (data||[]).reverse();}
export async function appendTicketMessage(ticket,userId,role,content,reservationId=null){const {data,error}=await supabase.rpc('append_support_ticket_message',{p_ticket_id:ticket.id,p_user_id:userId||null,p_sender_type:role,p_content:content,p_reservation_id:reservationId});if(error)throw error;return data;}
export async function createSupportTicket(userId,title,category,content,role='user',tags=[]){const {data,error}=await supabase.rpc('create_support_ticket',{p_user_id:userId,p_title:title,p_category:category,p_content:content,p_sender_type:role,p_tags:ticketTags(tags)});if(error)throw error;return data;}
export async function notifyTicketUser(ticket,title,body){
  try{const {data,error}=await supabase.rpc('notify_support_ticket_user',{p_ticket_id:ticket.id,p_title:ticketText(title,160),p_body:ticketText(body,300)});if(error)throw error;return data===true;}catch(e){console.error('support notification',safeErrorMetadata(e));return false;}
}
export async function maybeAnswerTicket(ticket,userId,{verifySession=async()=>true}={}){
  if(!ticket.ai_enabled||ticket.status==='closed')return {pending_admin:true};
  let reservation;
  try{
    const {data:settings,error:settingsError}=await supabase.from('app_settings').select('value').eq('key','features').maybeSingle();
    if(settingsError)throw settingsError;
    if(settings?.value?.support_chat===false)return {pending_admin:true,ai_disabled:true};
    const {data,error}=await supabase.rpc('reserve_support_ai_reply',{p_user_id:userId,p_ticket_id:ticket.id});if(error)throw error;
    reservation=data;
    if(!reservation?.reserved)return {pending_admin:true,ai_limit_reached:reservation?.reason==='quota',human_takeover:reservation?.reason==='human'};
    const history=await fetchTicketMessages(ticket.id);
    const question=history.filter(message=>message.sender_type==='user').at(-1)?.content||'';
    const pack=supportEvidence(question);
    if(!(await verifySession()))return {pending_admin:true,access_changed:true};
    const client=pack.local?null:await avalaiClient();if(!pack.local&&!client)return {pending_admin:true,ai_unavailable:true};
    const grounded=await generateSupportAnswer(client,question,crypto.createHash('sha256').update('drman-ticket:'+userId).digest('hex').slice(0,32),pack);
    const answer=grounded.answer;
    if(!(await verifySession()))return {pending_admin:true,access_changed:true};
    const result=await appendTicketMessage(ticket,userId,'assistant',supportStoredAnswer(grounded),reservation.reservation_id);
    if(!result?.saved)return {pending_admin:true,human_takeover:Boolean(result?.human_takeover),ai_unavailable:!result?.human_takeover};
    return {...grounded,remaining_today:reservation.remaining_today};
  }catch(e){console.error('support ticket AI',safeErrorMetadata(e));return {pending_admin:true,ai_unavailable:true};}
  finally{if(reservation?.reservation_id){try{const {error}=await supabase.rpc('release_support_ai_reservation',{p_reservation_id:reservation.reservation_id,p_user_id:userId});if(error)console.error('support quota release',safeErrorMetadata(error));}catch(e){console.error('support quota release',safeErrorMetadata(e));}}}
}
