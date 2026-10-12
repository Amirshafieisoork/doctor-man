import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

const KINDS=new Set(['symptom','lab','imaging','document','medication','follow_up','checkup','second_opinion','prevention','other']);
const STATUSES=new Set(['open','monitoring','resolved','archived']);
const URGENCY=new Set(['routine','soon','urgent']);
function txt(v,max=3000){return v==null?null:String(v).trim().slice(0,max)}
async function owned(userId,patientId){const {data}=await supabase.from('patients').select('id').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return data}
export default async function handler(req,res){
 const session=await requireUser(req,res);if(!session)return;
 const patientId=String((req.method==='GET'?req.query?.patient_id:req.body?.patient_id)||'').trim();
 if(!patientId||!(await owned(session.sub,patientId)))return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
 try{
   if(req.method==='GET'){
     const {data,error}=await supabase.from('care_episodes').select('*').eq('patient_id',patientId).order('status',{ascending:true}).order('updated_at',{ascending:false}).limit(100);if(error)throw error;
     return res.status(200).json({success:true,episodes:data||[]});
   }
   if(req.method==='POST'){
     const b=req.body||{},title=txt(b.title,180);if(!title)return res.status(400).json({success:false,error:'عنوان موضوع سلامت لازم است'});
     const payload={patient_id:patientId,created_by_user_id:session.sub,title,kind:KINDS.has(b.kind)?b.kind:'other',summary:txt(b.summary,4000),goal:txt(b.goal,2000),urgency:URGENCY.has(b.urgency)?b.urgency:'routine',preferred_specialty:txt(b.preferred_specialty,120),status:'open',updated_at:new Date().toISOString()};
     const {data,error}=await supabase.from('care_episodes').insert(payload).select('*').single();if(error)throw error;
     await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'care_episode.created',resource_type:'care_episode',resource_id:data.id,metadata:{kind:data.kind,urgency:data.urgency}}).catch(()=>null);
     return res.status(201).json({success:true,episode:data});
   }
   if(req.method==='PATCH'){
     const id=String(req.body?.id||'');if(!id)return res.status(400).json({success:false,error:'شناسه لازم است'});
     const b=req.body||{},patch={updated_at:new Date().toISOString()};
     if(b.title!==undefined){patch.title=txt(b.title,180);if(!patch.title)return res.status(400).json({success:false,error:'عنوان لازم است'})}
     if(b.kind!==undefined&&KINDS.has(b.kind))patch.kind=b.kind;
     if(b.summary!==undefined)patch.summary=txt(b.summary,4000);
     if(b.goal!==undefined)patch.goal=txt(b.goal,2000);
     if(b.urgency!==undefined&&URGENCY.has(b.urgency))patch.urgency=b.urgency;
     if(b.preferred_specialty!==undefined)patch.preferred_specialty=txt(b.preferred_specialty,120);
     if(b.status!==undefined){if(!STATUSES.has(b.status))return res.status(400).json({success:false,error:'وضعیت نامعتبر است'});patch.status=b.status}
     const {data,error}=await supabase.from('care_episodes').update(patch).eq('id',id).eq('patient_id',patientId).eq('created_by_user_id',session.sub).select('*').maybeSingle();if(error)throw error;if(!data)return res.status(404).json({success:false,error:'موضوع سلامت پیدا نشد'});
     return res.status(200).json({success:true,episode:data});
   }
   return res.status(405).json({error:'Method not allowed'});
 }catch(error){console.error('care-episodes',safeErrorMetadata(error));return res.status(500).json({success:false,error:'مدیریت موضوع سلامت انجام نشد'})}
}
