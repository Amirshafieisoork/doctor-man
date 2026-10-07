import crypto from 'node:crypto';
import { supabase } from './_lib/db.js';
function hash(v){return crypto.createHash('sha256').update(v).digest('hex')}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).end('Method not allowed');
  const token=String(req.query?.token||'').trim();if(token.length<20)return res.status(404).end('Not found');
  const {data:card}=await supabase.from('emergency_cards').select('*').eq('token_hash',hash(token)).eq('enabled',true).maybeSingle();if(!card)return res.status(404).end('Not found');
  const {data:p}=await supabase.from('patients').select('display_name,blood_type,emergency_contact_name,emergency_contact_phone').eq('id',card.patient_id).maybeSingle();if(!p)return res.status(404).end('Not found');
  const [allergies,conditions,meds]=await Promise.all([
    card.show_allergies?supabase.from('patient_allergies').select('allergen,severity,reaction').eq('patient_id',card.patient_id).limit(30):Promise.resolve({data:[]}),
    card.show_conditions?supabase.from('patient_conditions').select('name,status').eq('patient_id',card.patient_id).eq('status','active').limit(30):Promise.resolve({data:[]}),
    card.show_medications?supabase.from('patient_medications').select('name,dose,frequency').eq('patient_id',card.patient_id).eq('status','active').limit(30):Promise.resolve({data:[]})
  ]);
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
  const list=(title,a,fn)=>a?.length?`<section><h2>${title}</h2>${a.map(fn).join('')}</section>`:'';
  return res.status(200).end(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>کارت اضطراری سلامت | DrMan</title><style>body{margin:0;background:#050d1a;color:#e8f4ff;font-family:system-ui,sans-serif}.wrap{max-width:700px;margin:auto;padding:30px 16px}.hero,section{background:#0a1628;border:1px solid #00d4ff26;border-radius:18px;padding:20px;margin-bottom:14px}h1,h2{margin-top:0}h1{color:#00d4ff}.item{padding:8px 0;border-bottom:1px solid #ffffff12}.warn{color:#ffd060}.red{color:#ff8098}.muted{color:#7aa0c4;font-size:13px}</style></head><body><main class="wrap"><div class="hero"><h1>کارت اضطراری سلامت</h1><h2>${esc(p.display_name)}</h2>${card.show_blood_type&&p.blood_type?`<div><b>گروه خونی:</b> ${esc(p.blood_type)}</div>`:''}${card.show_emergency_contact&&p.emergency_contact_phone?`<div><b>تماس اضطراری:</b> ${esc(p.emergency_contact_name||'')} — <a style="color:#00d4ff" href="tel:${esc(p.emergency_contact_phone)}">${esc(p.emergency_contact_phone)}</a></div>`:''}<p class="muted">این صفحه فقط اطلاعاتی را نشان می‌دهد که صاحب پرونده برای شرایط اضطراری مجاز کرده است. صحت اطلاعات باید در ارزیابی حضوری بررسی شود.</p></div>${list('حساسیت‌ها',allergies.data,x=>`<div class="item"><b class="${x.severity==='severe'?'red':''}">${esc(x.allergen)}</b> <span class="muted">${esc(x.severity||'')} ${esc(x.reaction||'')}</span></div>`)}${list('بیماری‌های فعال',conditions.data,x=>`<div class="item"><b>${esc(x.name)}</b></div>`)}${list('داروهای فعال',meds.data,x=>`<div class="item"><b>${esc(x.name)}</b> <span class="muted">${esc(x.dose||'')} ${esc(x.frequency||'')}</span></div>`)}</main></body></html>`);
}
