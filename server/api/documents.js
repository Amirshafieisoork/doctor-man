import Busboy from 'busboy';
import crypto from 'node:crypto';
import { requireUser } from './_lib/session.js';
import { supabase } from './_lib/db.js';
import { dateField, InputValidationError } from './_lib/validate.js';
import { matchesFileType } from './_lib/uploads.js';
import { documentAccess } from './_lib/document-access.js';
import { safeErrorMetadata } from './_lib/errors.js';

export const config={api:{bodyParser:false}};
const ALLOWED=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const MAX=4*1024*1024;

async function owned(userId,patientId){const {data}=await supabase.from('patients').select('id').eq('id',patientId).eq('owner_user_id',userId).maybeSingle();return !!data;}
function parse(req){return new Promise((resolve,reject)=>{const bb=Busboy({headers:req.headers,limits:{files:1,fileSize:MAX,fields:10}});const fields={};let fileData=null,bad=false;bb.on('field',(n,v)=>fields[n]=String(v).slice(0,2000));bb.on('file',(_n,file,info)=>{const chunks=[];if(!ALLOWED.has(info.mimeType))bad=true;file.on('limit',()=>bad=true);file.on('data',c=>{if(!bad)chunks.push(c)});file.on('end',()=>{const buffer=Buffer.concat(chunks);if(!matchesFileType(buffer,info.mimeType))bad=true;if(!bad)fileData={buffer,mimeType:info.mimeType,filename:info.filename||'document'}});file.on('error',reject)});bb.on('filesLimit',()=>bad=true);bb.on('fieldsLimit',()=>bad=true);bb.on('finish',()=>bad?reject(new InputValidationError('فقط یک فایل معتبر PDF، JPG، PNG یا WebP تا ۴ مگابایت مجاز است')):resolve({fields,file:fileData}));bb.on('error',reject);req.once('aborted',()=>reject(new InputValidationError('ارسال فایل کامل نشد')));req.pipe(bb);});}
function ext(m){return m==='application/pdf'?'pdf':m==='image/png'?'png':m==='image/webp'?'webp':'jpg'}

export default async function handler(req,res){
 const session=await requireUser(req,res);if(!session)return;
 if(req.method==='GET'){
  res.setHeader('Cache-Control','no-store, private');
  try{
  const id=String(req.query?.id||'');
  const {data:doc,error:docError}=await supabase.from('medical_documents').select('id,patient_id,storage_path,title,mime_type').eq('id',id).maybeSingle();
  if(docError)throw docError;
  if(!doc||!doc.storage_path)return res.status(404).json({success:false,error:'سند پیدا نشد'});
  const access=await documentAccess(supabase,session.sub,doc.patient_id);
  if(!access)return res.status(404).json({success:false,error:'سند پیدا نشد یا اجازه دسترسی فعال نیست'});
  const {data,error}=await supabase.storage.from('medical-documents').createSignedUrl(doc.storage_path,access.expiresIn);
  if(error||!data?.signedUrl)return res.status(500).json({success:false,error:'لینک سند ساخته نشد'});
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:access.actorType,patient_id:doc.patient_id,action:access.actorType==='doctor'?'doctor.document_opened':'document.opened',resource_type:'medical_document',resource_id:id,metadata:access.grantId?{grant_id:access.grantId}:{}});
  return res.status(200).json({success:true,url:data.signedUrl,title:doc.title,mime_type:doc.mime_type,expires_in:access.expiresIn});
  }catch(error){console.error('document link access',safeErrorMetadata(error));return res.status(503).json({success:false,error:'بررسی دسترسی سند موقتاً در دسترس نیست'});}
 }
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('multipart/form-data;'))return res.status(415).json({success:false,error:'سند باید به شکل فایل ارسال شود'});
 try{
  const {fields,file}=await parse(req);const patientId=String(fields.patient_id||'');if(!file||!patientId||!(await owned(session.sub,patientId)))return res.status(400).json({success:false,error:'فایل یا پرونده معتبر نیست'});
  const type=['lab','prescription','imaging','discharge','visit_note','insurance','vaccine','other'].includes(fields.document_type)?fields.document_type:'other';
  const documentDate=dateField(fields.document_date,{label:'تاریخ سند',allowFuture:false});
  const path=`${patientId}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext(file.mimeType)}`;
  const {error:uploadError}=await supabase.storage.from('medical-documents').upload(path,file.buffer,{contentType:file.mimeType,upsert:false});if(uploadError)throw uploadError;
  const {data,error}=await supabase.from('medical_documents').insert({patient_id:patientId,uploaded_by_user_id:session.sub,document_type:type,title:String(fields.title||file.filename||'سند پزشکی').trim().slice(0,180),storage_path:path,mime_type:file.mimeType,document_date:documentDate}).select('id,document_type,title,document_date,created_at').single();
  if(error){await supabase.storage.from('medical-documents').remove([path]);throw error;}
  await supabase.from('audit_logs').insert({actor_user_id:session.sub,actor_type:'user',patient_id:patientId,action:'document.uploaded',resource_type:'medical_document',resource_id:data.id});
  return res.status(201).json({success:true,document:data});
 }catch(e){if(e instanceof InputValidationError)return res.status(400).json({success:false,error:e.message});console.error('documents',safeErrorMetadata(e));return res.status(500).json({success:false,error:'آپلود سند انجام نشد'});}
}
