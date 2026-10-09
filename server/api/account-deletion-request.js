import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
export default async function handler(req,res){
  const session=await requireUser(req,res);if(!session)return;
  try{
    if(req.method==='GET'){const {data}=await supabase.from('account_deletion_requests').select('id,status,reason,requested_at,cancelled_at,processed_at').eq('user_id',session.sub).order('requested_at',{ascending:false}).limit(1).maybeSingle();return res.status(200).json({success:true,request:data||null})}
    if(req.method==='POST'){
      const reason=String(req.body?.reason||'').trim().slice(0,1000)||null;
      const {data:open}=await supabase.from('account_deletion_requests').select('id,status,requested_at').eq('user_id',session.sub).in('status',['requested','processing']).maybeSingle();
      if(open)return res.status(200).json({success:true,request:open,already_requested:true});
      const {data,error}=await supabase.from('account_deletion_requests').insert({user_id:session.sub,reason,status:'requested'}).select('id,status,reason,requested_at').single();if(error)throw error;
      await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',action:'account.deletion_requested',resource_type:'user',resource_id:session.sub}).catch(()=>null);
      return res.status(201).json({success:true,request:data});
    }
    if(req.method==='DELETE'){
      const {data,error}=await supabase.from('account_deletion_requests').update({status:'cancelled',cancelled_at:new Date().toISOString()}).eq('user_id',session.sub).eq('status','requested').select('id,status,cancelled_at').maybeSingle();if(error)throw error;
      if(!data)return res.status(409).json({success:false,error:'درخواست قابل لغوی وجود ندارد'});
      return res.status(200).json({success:true,request:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('account-deletion-request',safeErrorMetadata(error));return res.status(500).json({success:false,error:'مدیریت درخواست حذف حساب انجام نشد'})}
}
