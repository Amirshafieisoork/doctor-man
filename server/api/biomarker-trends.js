import { safeErrorMetadata } from './_lib/errors.js';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
async function owned(userId,patientId){const {data}=await supabase.from('patients').select('id').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return Boolean(data)}
export default async function handler(req,res){
  const session=await requireUser(req,res);if(!session)return;if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const patientId=String(req.query?.patient_id||'');if(!patientId||!(await owned(session.sub,patientId)))return res.status(404).json({success:false,error:'پرونده پیدا نشد'});
  const {data,error}=await supabase.from('lab_biomarkers').select('name_key,name_raw,value_text,value_numeric,unit,reference_range,flag,observed_at,confidence,test_result_id').eq('patient_id',patientId).order('observed_at',{ascending:true}).limit(1500);
  if(error){console.error('biomarker-trends',safeErrorMetadata(error));return res.status(500).json({success:false,error:'دریافت روند آزمایش انجام نشد'})}
  const map=new Map();for(const x of data||[]){if(!map.has(x.name_key))map.set(x.name_key,{key:x.name_key,name:x.name_raw,unit:x.unit||'',points:[]});const g=map.get(x.name_key);g.name=x.name_raw||g.name;if(x.unit)g.unit=x.unit;g.points.push({value:x.value_numeric==null?null:Number(x.value_numeric),value_text:x.value_text,flag:x.flag,reference_range:x.reference_range,observed_at:x.observed_at,test_result_id:x.test_result_id,confidence:x.confidence})}
  const biomarkers=[...map.values()].map(g=>({...g,latest:g.points[g.points.length-1]||null,count:g.points.length})).sort((a,b)=>new Date(b.latest?.observed_at||0)-new Date(a.latest?.observed_at||0));
  return res.status(200).json({success:true,biomarkers});
}
