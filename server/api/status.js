import { supabase, usingSupabaseProxy } from './_lib/db.js';
import { configuredModels } from './_lib/ai-models.js';
import { isSessionConfigured } from './_lib/session.js';
import { readPublicDigiPaySettings } from './_lib/private-digipay-settings.js';
import { privateAIEncryptionReady } from './_lib/private-ai-settings.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  let database=false;
  try{
    const {error}=await supabase.from('plans').select('id',{head:true,count:'exact'}).limit(1);
    database=!error;
  }catch{}
  const models=await configuredModels();
  let digipay = { configured: false, fields: { client_id: false, client_secret: false, username: false, password: false } };
  try { digipay = await readPublicDigiPaySettings(supabase); } catch {}
  const missingDigiPayFields = Object.entries(digipay.fields).filter(([, configured]) => !configured).map(([field]) => 'DIGIPAY_' + field.toUpperCase());
  return res.status(database?200:503).json({
    success:database,
    service:'drman',
    database:{ok:database,mode:usingSupabaseProxy?'private-edge-proxy':'direct-secret'},
    ai:{configured:models.provider!=='unconfigured',provider:models.provider,free_only:true,encryption_ready:privateAIEncryptionReady(),models},
    payments:{digipay_configured:digipay.configured,missing_fields:missingDigiPayFields},
    admin:{configured:Boolean(process.env.ADMIN_PASSWORD)},
    sessions:{configured:isSessionConfigured()},
    version:process.env.VERCEL_GIT_COMMIT_SHA||'local'
  });
}
