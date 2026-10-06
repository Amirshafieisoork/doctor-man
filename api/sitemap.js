import { supabase } from './_lib/db.js';

const BASE = process.env.PUBLIC_SITE_URL || 'https://drman.vercel.app';
function x(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).end('Method not allowed');
  const {data:doctors}=await supabase.from('doctor_profiles').select('slug,updated_at').eq('verification_status','verified').eq('public_profile',true).order('updated_at',{ascending:false}).limit(5000);
  const staticUrls=[
    ['/', 'daily','1.0'],['/doctors','daily','0.9'],['/pricing','weekly','0.7'],['/privacy','monthly','0.3'],['/terms','monthly','0.3'],['/doctor-onboarding','monthly','0.5']
  ];
  const urls=staticUrls.map(([p,c,pri])=>`<url><loc>${x(BASE+p)}</loc><changefreq>${c}</changefreq><priority>${pri}</priority></url>`);
  for(const d of doctors||[]) urls.push(`<url><loc>${x(BASE+'/doctor/'+encodeURIComponent(d.slug))}</loc><lastmod>${new Date(d.updated_at||Date.now()).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  const xml=`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');return res.status(200).send(xml);
}
