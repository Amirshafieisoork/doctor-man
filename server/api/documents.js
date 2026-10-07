import Busboy from 'busboy';
import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';

export const config={api:{bodyParser:false}};
const ALLOWED=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const MAX=20*1024*1024;

async function owned(userId,patientId){const {data}=await supabase.from('patients').select('id').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return !!data;}
function parse(req){return new Promise((resolve,reject)=>{const bb=Busboy({headers:req.headers,limits:{files:1,fileSize:MAX,fields:10}});const fields={};let fileData=null,bad=false;bb.on('field',(n,v)=>fields[n]=String(v).slice(0,2000));bb.on('file',(_n,file,info)=>{const chunks=[];if(!ALLOWED.has(info.mimeType))bad=true;file.on('limit',()=>bad=true);file.on('data',c=>chunks.push(c));file.on('end',()=>{if(!bad)fileData={buffer:Buffer.concat(chunks),mimeType:info.mimeType,filename:info.filename||'document'}})});bb.on('finish',()=>bad?reject(new Error('نوع یا حجم فایل مجاز نیست')):resolve({fields,file:fileData}));bb.on('error',reject);req.pipe(bb);});}
function ext(m){return m==='application/pdf'?'pdf':m==='image/png'?'png':m==='image/webp'?'webp':'jpg'}

export default async function handler(req,res){
 const session=requireUser(req,res);if(!session)return;
 if(req.method==='GET'){
  const id=String(req.query?.id||'');
  const {data:doc}=await supabase.from('medical_documents').select('id,patient_id,storage_path,title,mime_type').eq('id',id).maybeSingle();
  if(!doc||!doc.storage_path||!(await owned(session.sub,doc.patient_id)))return res.status(404).json({success:false,error:'سند پیدا نشد'});
  const {data,error}=await supabase.storage.from('medical-documents').createSignedUrl(doc.storage_path,300);
  if(error)return res.status(500).json({success:false,error:'لینک سند ساخته نشد'});
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:doc.patient_id,action:'document.opened',resource_type:'medical_document',resource_id:id});
  return res.status(200).json({success:true,url:data.signedUrl,title:doc.title,mime_type:doc.mime_type,expires_in:300});
 }
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const {fields,file}=await parse(req);const patientId=String(fields.patient_id||'');if(!file||!patientId||!(await owned(session.sub,patientId)))return res.status(400).json({success:false,error:'فایل یا پرونده معتبر نیست'});
  const type=['lab','prescription','imaging','discharge','visit_note','insurance','vaccine','other'].includes(fields.document_type)?fields.document_type:'other';
  const path=`${patientId}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext(file.mimeType)}`;
  const {error:uploadError}=await supabase.storage.from('medical-documents').upload(path,file.buffer,{contentType:file.mimeType,upsert:false});if(uploadError)throw uploadError;
  const {data,error}=await supabase.from('medical_documents').insert({patient_id:patientId,uploaded_by_user_id:session.sub,document_type:type,title:String(fields.title||fields.filename||'سند پزشکی').trim().slice(0,180),storage_path:path,mime_type:file.mimeType,document_date:fields.document_date||null}).select('id,document_type,title,document_date,created_at').single();
  if(error){await supabase.storage.from('medical-documents').remove([path]);throw error;}
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'document.uploaded',resource_type:'medical_document',resource_id:data.id});
  return res.status(201).json({success:true,document:data});
 }catch(e){console.error('documents',e);return res.status(500).json({success:false,error:e.message==='نوع یا حجم فایل مجاز نیست'?e.message:'آپلود سند انجام نشد'});}
}
