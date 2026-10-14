import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { safeErrorMetadata } from './_lib/errors.js';
import { ticketId,ticketText,ticketTags,categories,statuses,fetchTicket,fetchTicketMessages,appendTicketMessage,createSupportTicket,notifyTicketUser } from './_lib/support-tickets.js';

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(!['GET','POST','PATCH'].includes(req.method))return res.status(405).json({success:false,error:'Method not allowed'});
  try{
    if(req.method==='GET'){
      if(req.query?.ticket_id){const id=req.query.ticket_id;if(!ticketId(id))return res.status(400).json({success:false,error:'شناسه تیکت معتبر نیست'});const ticket=await fetchTicket(id);if(!ticket)return res.status(404).json({success:false,error:'تیکت پیدا نشد'});return res.status(200).json({success:true,ticket,messages:await fetchTicketMessages(id)});}
      const {data,error}=await supabase.from('support_tickets').select('id,user_id,title,category,status,ai_enabled,tags,created_at,updated_at,users(name,phone,status)').order('updated_at',{ascending:false}).limit(300);if(error)throw error;return res.status(200).json({success:true,tickets:data||[]});
    }
    const body=req.body||{};let ticket,notificationSent;
    if(req.method==='POST'&&body.action==='create'){
      if(!ticketId(body.user_id))return res.status(400).json({success:false,error:'کاربر معتبر نیست'});
      const title=ticketText(body.title,160),message=ticketText(body.message,2500);if(!title||!message)return res.status(400).json({success:false,error:'عنوان و متن پیام لازم است'});
      const {data:user,error:userError}=await supabase.from('users').select('id,status').eq('id',body.user_id).maybeSingle();if(userError)throw userError;if(user?.status!=='active')return res.status(409).json({success:false,error:'کاربر فعال در دسترس نیست'});
      ticket=await createSupportTicket(user.id,title,categories.has(body.category)?body.category:'other',message,'admin',body.tags);
      notificationSent=await notifyTicketUser(ticket,title,message);
    }else{
      if(!ticketId(body.ticket_id))return res.status(400).json({success:false,error:'شناسه تیکت معتبر نیست'});ticket=await fetchTicket(body.ticket_id);if(!ticket)return res.status(404).json({success:false,error:'تیکت پیدا نشد'});
      if(req.method==='POST'){const message=ticketText(body.message,2500);if(!message)return res.status(400).json({success:false,error:'متن پاسخ را بنویسید'});await appendTicketMessage(ticket,null,'admin',message);notificationSent=await notifyTicketUser(ticket,'پاسخ پشتیبانی دکتر من',message);}
      else{const patch={updated_at:new Date().toISOString()};if(Object.hasOwn(body,'status')){if(!statuses.has(body.status))return res.status(400).json({success:false,error:'وضعیت معتبر نیست'});patch.status=body.status;}if(Object.hasOwn(body,'ai_enabled')){if(typeof body.ai_enabled!=='boolean')return res.status(400).json({success:false,error:'وضعیت پاسخ هوشمند معتبر نیست'});patch.ai_enabled=body.ai_enabled;}if(Object.hasOwn(body,'tags'))patch.tags=ticketTags(body.tags);if(Object.keys(patch).length===1)return res.status(400).json({success:false,error:'تغییری مشخص نشده است'});const {error}=await supabase.from('support_tickets').update(patch).eq('id',ticket.id);if(error)throw error;}
    }
    await Promise.resolve(supabase.from('audit_logs').insert({actor_type:'admin',action:req.method==='PATCH'?'support.ticket_updated':'support.admin_replied',resource_type:'support_ticket',resource_id:ticket.id,metadata:{ai_enabled:body.ai_enabled,status:body.status}})).catch(()=>null);
    return res.status(200).json({success:true,ticket:await fetchTicket(ticket.id),messages:await fetchTicketMessages(ticket.id),...(notificationSent===undefined?{}:{notification_sent:notificationSent})});
  }catch(e){console.error('admin-support-tickets',safeErrorMetadata(e));return res.status(500).json({success:false,error:'عملیات تیکت انجام نشد'})}
}
