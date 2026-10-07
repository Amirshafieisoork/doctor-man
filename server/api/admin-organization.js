import { requireAdmin } from './_lib/session.js';
import { supabase } from './_lib/db.js';

function text(v,max=500){return v==null?'':String(v).trim().slice(0,max)}
function slug(v){const s=text(v,100).toLowerCase();return /^[a-z0-9-]{2,100}$/.test(s)?s:null}
function payload(b,partial=false){const x={};
  if(!partial||b.type!==undefined)x.type=['clinic','hospital','lab','imaging','pharmacy','other'].includes(b.type)?b.type:'clinic';
  if(!partial||b.name!==undefined)x.name=text(b.name,180);
  if(!partial||b.slug!==undefined)x.slug=slug(b.slug);
  if(!partial||b.phone!==undefined)x.phone=text(b.phone,40)||null;
  if(!partial||b.website!==undefined)x.website=text(b.website,300)||null;
  if(!partial||b.city!==undefined)x.city=text(b.city,120)||null;
  if(!partial||b.address!==undefined)x.address=text(b.address,700)||null;
  if(!partial||b.verified!==undefined)x.verified=Boolean(b.verified);
  return x;
}
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  try{
    const b=req.body&&typeof req.body==='object'?req.body:{};
    if(req.method==='POST'){
      const p=payload(b,false); if(!p.name||!p.slug)return res.status(400).json({success:false,error:'نام و slug معتبر لازم است'});
      const {data,error}=await supabase.from('organizations').insert(p).select('*').single(); if(error){if(error.code==='23505')return res.status(409).json({success:false,error:'این slug قبلاً استفاده شده است'});throw error} return res.status(201).json({success:true,organization:data});
    }
    if(req.method==='PUT'){
      const id=text(b.id,64); if(!id)return res.status(400).json({success:false,error:'شناسه لازم است'}); const p=payload(b,true); if(p.slug===null)return res.status(400).json({success:false,error:'slug نامعتبر است'});
      const {data,error}=await supabase.from('organizations').update(p).eq('id',id).select('*').single(); if(error)throw error; return res.status(200).json({success:true,organization:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){console.error('admin-organization',error);return res.status(500).json({success:false,error:'مدیریت مرکز انجام نشد'})}
}
