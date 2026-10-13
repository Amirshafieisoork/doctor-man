import { supabase, usingSupabaseProxy } from './_lib/db.js';
import { configuredModels } from './_lib/ai-models.js';
import { isSessionConfigured } from './_lib/session.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  let database=false;
  try{
    const {error}=await supabase.from('plans').select('id',{head:true,count:'exact'}).limit(1);
    database=!error;
  }catch{}
  const models=await configuredModels();
  const missingDigiPayFields=['DIGIPAY_CLIENT_ID','DIGIPAY_CLIENT_SECRET','DIGIPAY_USERNAME','DIGIPAY_PASSWORD'].filter(key=>!process.env[key]);
  return res.status(database?200:503).json({
    success:database,
    service:'drman',
    database:{ok:database,mode:usingSupabaseProxy?'private-edge-proxy':'direct-secret'},
    ai:{configured:models.provider!=='unconfigured',provider:models.provider,models},
    payments:{digipay_configured:missingDigiPayFields.length===0,missing_fields:missingDigiPayFields},
    admin:{configured:Boolean(process.env.ADMIN_PASSWORD)},
    sessions:{configured:isSessionConfigured()},
    version:process.env.VERCEL_GIT_COMMIT_SHA||'local'
  });
}
