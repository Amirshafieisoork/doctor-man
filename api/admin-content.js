import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=5000){return v==null?'':String(v).trim().slice(0,max)}
function slug(v){const s=text(v,100).toLowerCase();return /^[a-z0-9-]{2,100}$/.test(s)?s:null}
function bodyToHtml(v){return text(v,30000).split(/\n{2,}/).map(p=>`<p>${p.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g,'<br>')}</p>`).join('')}
function articlePayload(b,partial=false){const x={};
  if(!partial||b.title!==undefined)x.title=text(b.title,220);
  if(!partial||b.slug!==undefined)x.slug=slug(b.slug);
  if(!partial||b.summary!==undefined)x.summary=text(b.summary,1000);
  if(!partial||b.body_text!==undefined)x.body_html=bodyToHtml(b.body_text);
  if(!partial||b.category!==undefined)x.category=text(b.category,100);
  if(!partial||b.keywords!==undefined)x.keywords=Array.isArray(b.keywords)?b.keywords.map(v=>text(v,80)).filter(Boolean).slice(0,20):[];
  if(!partial||b.seo_title!==undefined)x.seo_title=text(b.seo_title,180);
  if(!partial||b.seo_description!==undefined)x.seo_description=text(b.seo_description,300);
  if(!partial||b.author_name!==undefined)x.author_name=text(b.author_name,160);
  if(!partial||b.reviewer_doctor_id!==undefined)x.reviewer_doctor_id=b.reviewer_doctor_id||null;
  if(!partial||b.source_links!==undefined)x.source_links=Array.isArray(b.source_links)?b.source_links.map(v=>typeof v==='string'?text(v,500):{title:text(v?.title,180),url:text(v?.url,500)}).filter(v=>typeof v==='string'?Boolean(v):Boolean(v.url)).slice(0,20):[];
  if(!partial||b.risk_level!==undefined)x.risk_level=['low','moderate','high'].includes(b.risk_level)?b.risk_level:'moderate';
  if(!partial||b.review_level!==undefined)x.review_level=['editorial','medical'].includes(b.review_level)?b.review_level:'medical';
  if(!partial||b.ai_assisted!==undefined)x.ai_assisted=b.ai_assisted===true;
  if(!partial||b.featured!==undefined)x.featured=b.featured===true;
  if(!partial||b.noindex!==undefined)x.noindex=b.noindex===true;
  if(!partial||b.review_notes!==undefined)x.review_notes=text(b.review_notes,2000);
  if(!partial||b.evidence_updated_at!==undefined)x.evidence_updated_at=b.evidence_updated_at||null;
  if(!partial||b.next_review_at!==undefined)x.next_review_at=b.next_review_at||null;
  x.updated_at=new Date().toISOString(); return x;}

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  try{
    if(req.method==='GET'){
      const id=text(req.query?.id,64); if(!id)return res.status(400).json({success:false,error:'شناسه مقاله لازم است'});
      const {data,error}=await supabase.from('medical_articles').select('*').eq('id',id).maybeSingle(); if(error)throw error; if(!data)return res.status(404).json({success:false,error:'مقاله پیدا نشد'});
      const plain=String(data.body_html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n\n').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim();
      return res.status(200).json({success:true,article:{...data,body_text:plain}});
    }
    const b=req.body&&typeof req.body==='object'?req.body:{};
    if(req.method==='POST'){
      const payload=articlePayload(b,false); if(!payload.title||!payload.slug)return res.status(400).json({success:false,error:'عنوان و slug معتبر لازم است'});
      payload.status='draft'; payload.created_at=new Date().toISOString();
      const {data,error}=await supabase.from('medical_articles').insert(payload).select('*').single(); if(error){if(error.code==='23505')return res.status(409).json({success:false,error:'این slug قبلاً استفاده شده است'});throw error}
      return res.status(201).json({success:true,article:data});
    }
    if(req.method==='PUT'){
      const id=text(b.id,64); if(!id)return res.status(400).json({success:false,error:'شناسه لازم است'});
      const payload=articlePayload(b,true); if(payload.slug===null)return res.status(400).json({success:false,error:'slug نامعتبر است'}); if(payload.title!==undefined&&!payload.title)return res.status(400).json({success:false,error:'عنوان لازم است'});
      const {data,error}=await supabase.from('medical_articles').update(payload).eq('id',id).select('*').single(); if(error)throw error; return res.status(200).json({success:true,article:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('admin-content',error);return res.status(500).json({success:false,error:'مدیریت محتوا انجام نشد'})}
}
