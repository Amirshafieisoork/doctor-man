import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { allowRate,recordRate } from './_lib/rate-limit.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { ticketId,ticketText,categories,fetchTicket,fetchTicketMessages,appendTicketMessage,createSupportTicket,maybeAnswerTicket } from './_lib/support-tickets.js';

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({success:false,error:'Method not allowed'});
  const user=await requireUser(req,res);if(!user)return;
  try{
    if(req.method==='GET'){
      const id=req.query?.ticket_id;
      if(id){if(!ticketId(id))return res.status(400).json({success:false,error:'شناسه تیکت معتبر نیست'});const ticket=await fetchTicket(id,user.sub);if(!ticket)return res.status(404).json({success:false,error:'تیکت پیدا نشد'});return res.status(200).json({success:true,ticket,messages:await fetchTicketMessages(id)});}
      const {data,error}=await supabase.from('support_tickets').select('id,title,category,status,ai_enabled,tags,created_at,updated_at').eq('user_id',user.sub).order('updated_at',{ascending:false}).limit(100);if(error)throw error;return res.status(200).json({success:true,tickets:data||[]});
    }
    const body=req.body||{},message=ticketText(body.message,2500);
    if(!message)return res.status(400).json({success:false,error:'متن پیام را بنویسید'});
    const rate=await allowRate(req,{action:'support-ticket-message',subject:user.sub,limit:30,windowMinutes:15});
    if(!rate.allowed){if(!rate.unavailable)res.setHeader('Retry-After',String(rate.retry_after_seconds||900));return res.status(rate.unavailable?503:429).json({success:false,error:rate.unavailable?'ثبت پیام موقتاً در دسترس نیست':'تعداد پیام‌ها زیاد است؛ کمی بعد تلاش کنید',retry_after_seconds:rate.retry_after_seconds});}
    let ticket;
    if(body.ticket_id){if(!ticketId(body.ticket_id))return res.status(400).json({success:false,error:'شناسه تیکت معتبر نیست'});ticket=await fetchTicket(body.ticket_id,user.sub);if(!ticket)return res.status(404).json({success:false,error:'تیکت پیدا نشد'});if(ticket.status==='closed')return res.status(409).json({success:false,error:'این تیکت بسته شده است؛ درخواست تازه ثبت کنید'});}
    else{
      const title=ticketText(body.title,160);if(!title)return res.status(400).json({success:false,error:'عنوان تیکت را بنویسید'});
      const category=categories.has(body.category)?body.category:'other';
      ticket=await createSupportTicket(user.sub,title,category,message);
    }
    if(body.ticket_id)await appendTicketMessage(ticket,user.sub,'user',message);
    await recordRate(rate.keyHash,'support-ticket-message',true,rate.eventId);
    const answer=await maybeAnswerTicket(ticket,user.sub);
    if(!(await requireUser(req,res)))return;
    const fresh=await fetchTicket(ticket.id,user.sub);
    return res.status(200).json({success:true,ticket:fresh,messages:await fetchTicketMessages(ticket.id),...answer});
  }catch(e){console.error('support-tickets',safeErrorMetadata(e));return res.status(500).json({success:false,error:'تیکت بارگذاری یا ثبت نشد؛ دوباره تلاش کنید'})}
}
