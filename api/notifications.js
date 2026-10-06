import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export default async function handler(req,res){
  const session=requireUser(req,res); if(!session)return;
  if(req.method==='GET'){
    const {data,error}=await supabase.from('notifications').select('id,patient_id,type,title,body,action_url,read_at,scheduled_for,sent_at,created_at').eq('user_id',session.sub).or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`).order('created_at',{ascending:false}).limit(100);
    if(error)return res.status(500).json({success:false,error:'دریافت اعلان‌ها انجام نشد'});
    return res.status(200).json({success:true,notifications:data||[],unread:(data||[]).filter(x=>!x.read_at).length});
  }
  if(req.method==='PATCH'){
    const id=String(req.body?.id||''); const all=req.body?.all===true; const readAt=new Date().toISOString();
    let q=supabase.from('notifications').update({read_at:readAt}).eq('user_id',session.sub).is('read_at',null); if(!all)q=q.eq('id',id);
    const {error}=await q; if(error)return res.status(500).json({success:false,error:'بروزرسانی اعلان انجام نشد'});
    return res.status(200).json({success:true});
  }
  return res.status(405).json({error:'Method not allowed'});
}
