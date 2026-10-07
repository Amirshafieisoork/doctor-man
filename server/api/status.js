import { supabase, usingSupabaseProxy } from './_lib/db.js';
import { configuredModels } from './_lib/ai-models.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  let database=false;
  try{
    const {error}=await supabase.from('plans').select('id',{head:true,count:'exact'}).limit(1);
    database=!error;
  }catch{}
  const models=configuredModels();
  return res.status(database?200:503).json({
    success:database,
    service:'drman',
    database:{ok:database,mode:usingSupabaseProxy?'private-edge-proxy':'direct-secret'},
    ai:{configured:models.provider!=='unconfigured',provider:models.provider,models},
    payments:{digipay_configured:Boolean(process.env.DIGIPAY_CLIENT_ID&&process.env.DIGIPAY_CLIENT_SECRET&&process.env.DIGIPAY_USERNAME&&process.env.DIGIPAY_PASSWORD)},
    admin:{configured:Boolean(process.env.ADMIN_PASSWORD)},
    version:process.env.VERCEL_GIT_COMMIT_SHA||'local'
  });
}
