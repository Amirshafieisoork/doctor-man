import { supabase } from './_lib/db.js';
const BASE=String(process.env.PUBLIC_SITE_URL||process.env.PUBLIC_BASE_URL||'https://drman.vercel.app').replace(/\/$/,'');
function x(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end('Method not allowed');
 const [docsRes,articlesRes]=await Promise.all([
  supabase.from('doctor_profiles').select('slug,updated_at').eq('verification_status','verified').eq('public_profile',true).order('updated_at',{ascending:false}).limit(5000),
  supabase.from('medical_articles').select('slug,updated_at,reviewer_doctor_id,doctor_profiles(verification_status)').eq('status','published').order('updated_at',{ascending:false}).limit(10000)
 ]);
 const staticUrls=[['/','daily','1.0'],['/doctors','daily','0.9'],['/learn','daily','0.9'],['/pricing','weekly','0.7'],['/medical-methodology','monthly','0.6'],['/privacy','monthly','0.3'],['/terms','monthly','0.3'],['/doctor-onboarding','monthly','0.5']];
 const urls=staticUrls.map(([p,c,pri])=>`<url><loc>${x(BASE+p)}</loc><changefreq>${c}</changefreq><priority>${pri}</priority></url>`);
 for(const d of docsRes.data||[])urls.push(`<url><loc>${x(BASE+'/doctor/'+encodeURIComponent(d.slug))}</loc><lastmod>${new Date(d.updated_at||Date.now()).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
 for(const a of articlesRes.data||[]){if(a.doctor_profiles?.verification_status!=='verified')continue;urls.push(`<url><loc>${x(BASE+'/learn/'+encodeURIComponent(a.slug))}</loc><lastmod>${new Date(a.updated_at||Date.now()).toISOString()}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`)}
 const xml=`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
 res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');return res.status(200).send(xml);
}
