import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createToken} from '../server/api/_lib/session.js';
import {createResetToken,hashResetToken,RESET_REQUEST_MESSAGE,recoveryOrigin} from '../server/api/_lib/password-reset.js';

process.env.SUPABASE_URL='https://recovery-tests.invalid';
process.env.SUPABASE_SECRET_KEY='test-only-database-key';
process.env.SESSION_SECRET='test-only-session-secret-32-characters';
const {supabase}=await import('../server/api/_lib/db.js');
const {default:requestReset}=await import('../server/api/password-reset-request.js');
const {default:reset}=await import('../server/api/password-reset.js');
const {default:adminReset}=await import('../server/api/admin-password-reset.js');
const {default:sessionStatus}=await import('../server/api/session.js');
const userId='11111111-1111-4111-8111-111111111111';
const expiry='2026-10-13T17:30:00.000Z';
const token=createResetToken(),password='new-test-password';
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function response(){return {statusCode:200,headers:{},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];}};}
function database(t,{rateCount=0,countFailure=false,reserveFailure=false,rpcFailure=false,consume=[],issue=[{expires_at:expiry}],requests=[],accountVersion=0}={}){
  const calls=[];
  const client=createClient('https://recovery-tests.invalid','test-only-client-key',{auth:{persistSession:false,autoRefreshToken:false},global:{async fetch(input,init){
    const req=new Request(input,init),url=new URL(req.url),name=url.pathname.split('/').at(-1);
    const body=['GET','HEAD'].includes(req.method)?null:await req.json();
    calls.push({name,body,method:req.method,query:url.searchParams});
    if(name==='auth_rate_events'){
      if(req.method==='HEAD')return new Response(null,{status:countFailure?503:200,headers:{'Content-Range':`*/${rateCount}`}});
      if(req.method==='GET')return json([{created_at:new Date().toISOString()}]);
      if(req.method==='POST')return reserveFailure?json({code:'TEST_RESERVATION_ERROR'},503):json({id:'reserved-attempt'},201);
      if(req.method==='PATCH')return new Response(null,{status:204});
    }
    if(req.method==='POST'&&url.pathname.includes('/rpc/')){
      if(rpcFailure)return json({code:'TEST_PRIVATE_RPC_ERROR',message:'private token secret details'},500);
      if(name==='request_password_reset')return json(null);
      if(name==='issue_password_reset_token')return json(issue);
      if(name==='consume_password_reset_token')return json(consume);
    }
    if(name==='password_reset_requests'&&req.method==='GET')return json(requests);
    if(name==='users'&&req.method==='GET')return json([{id:userId,name:'نام',phone:'09123456789',status:'active',session_version:accountVersion}]);
    throw new Error(`Unexpected fake HTTP request ${req.method} ${name}`);
  }}});
  const originalFrom=supabase.from,originalRpc=supabase.rpc;
  supabase.from=client.from.bind(client);supabase.rpc=client.rpc.bind(client);
  t.after(()=>{supabase.from=originalFrom;supabase.rpc=originalRpc;});
  return calls;
}
async function call(handler,body={},admin=false,method='POST'){
  const res=response();const headers={host:'drman.vercel.app'};
  if(admin)headers.cookie=`drman_admin=${createToken({sub:'admin',role:'admin'})}`;
  await handler({method,headers,body},res);return res;
}

test('reset tokens have cryptographic entropy, non-reversible storage hashes, and no predictable account identifiers',()=>{
  const tokens=new Set(Array.from({length:30},createResetToken));
  assert.equal(tokens.size,30);
  for(const value of tokens){assert.match(value,/^[A-Za-z0-9_-]{43}$/);assert.match(hashResetToken(value),/^[a-f0-9]{64}$/);assert.equal(Buffer.from(value,'base64url').length,32);}
});

for(const phone of ['۰۹۱۲۳۴۵۶۷۸۹','09999999999','09111111111']){
  test(`public recovery uses the same opaque acknowledgement and database path for ${phone}`,async t=>{
    const calls=database(t),res=await call(requestReset,{phone});
    assert.equal(res.statusCode,202);assert.deepEqual(res.body,{success:true,message:RESET_REQUEST_MESSAGE,delivery:'support'});
    const rpc=calls.find(c=>c.name==='request_password_reset');
    assert.match(rpc.body.p_phone,/^09\d{9}$/);assert.deepEqual(calls.map(c=>c.name),['auth_rate_events','auth_rate_events','request_password_reset','auth_rate_events']);
    assert.doesNotMatch(JSON.stringify(res.body),/user_id|token|exists|password|reset_url/);
  });
}

test('a public reset request cannot mint or return a reset token',async t=>{
  const calls=database(t),res=await call(requestReset,{phone:'09123456789',user_id:userId,token,password});
  assert.equal(res.statusCode,202);assert.equal(calls.some(c=>c.name==='issue_password_reset_token'),false);
  assert.deepEqual(calls.find(c=>c.name==='request_password_reset').body,{p_phone:'09123456789'});
});

for(const scenario of [{rateCount:8},{countFailure:true},{reserveFailure:true}]){
  test('recovery fails closed before sensitive RPC if rate admission fails '+JSON.stringify(scenario),async t=>{
    const calls=database(t,scenario),res=await call(reset,{token,password});
    assert.ok([429,503].includes(res.statusCode));assert.equal(calls.some(c=>c.name==='consume_password_reset_token'),false);
  });
}

test('owner reset links are private, hash-only in the database, and use the canonical site origin',async t=>{
  const calls=database(t),res=await call(adminReset,{user_id:userId},true);
  assert.equal(res.statusCode,201);assert.equal(res.body.expires_at,expiry);
  const link=new URL(res.body.reset_url),issuedToken=new URLSearchParams(link.hash.slice(1)).get('reset');
  assert.equal(link.origin,'https://drman.vercel.app');assert.equal(link.pathname,'/auth');assert.equal(link.search,'');
  const rpc=calls.find(c=>c.name==='issue_password_reset_token');
  assert.deepEqual(rpc.body,{p_user_id:userId,p_token_hash:hashResetToken(issuedToken),p_ttl_seconds:1800});
  assert.equal(JSON.stringify(calls).includes(issuedToken),false);
});

test('an ordinary signed user cannot issue or list owner recovery links',async t=>{
  const calls=database(t),res=response();
  await adminReset({method:'POST',headers:{cookie:`drman_session=${createToken({sub:userId,role:'user'})}`},body:{user_id:userId}},res);
  assert.equal(res.statusCode,401);assert.equal(calls.length,0);
  const listed=await call(adminReset,{},false,'GET');assert.equal(listed.statusCode,401);assert.equal(calls.length,0);
});

test('missing or blocked accounts cannot receive an owner reset link',async t=>{
  const calls=database(t,{issue:[]}),res=await call(adminReset,{user_id:userId},true);
  assert.equal(res.statusCode,404);assert.equal(res.body.reset_url,undefined);
  assert.equal(calls.filter(c=>c.name==='issue_password_reset_token').length,1);
});

for(const consume of [[],null]){
  test('invalid, expired, blocked, or consumed tokens do not replace a password or sign in',async t=>{
    database(t,{consume});const res=await call(reset,{token,password});
    assert.equal(res.statusCode,400);assert.equal(res.body.code,'RESET_LINK_INVALID');assert.equal(res.headers['Set-Cookie'],undefined);
  });
}

test('a successful reset uses a salted password hash, clears the old user cookie, and requires a fresh login',async t=>{
  const calls=database(t,{consume:[{user_id:userId,session_version:1}]}),res=await call(reset,{token,password});
  assert.equal(res.statusCode,200);assert.equal(res.body.success,true);
  const rpc=calls.find(c=>c.name==='consume_password_reset_token');
  assert.equal(rpc.body.p_token_hash,hashResetToken(token));
  const [,salt,hash]=rpc.body.p_password_hash.split('$');
  assert.equal(hash,crypto.scryptSync(password,salt,64).toString('hex'));
  assert.equal(JSON.stringify(calls).includes(password),false);assert.equal(JSON.stringify(calls).includes(token),false);
  assert.match(res.headers['Set-Cookie'],/drman_session=;.*Max-Age=0/);assert.doesNotMatch(res.headers['Set-Cookie'],/drman_admin/);
  assert.equal(res.body.user_id,undefined);assert.equal(res.body.session_version,undefined);
});

for(const payload of [{token:'guess',password},{token,password:'short'},{token,password:'x'.repeat(129)},{token,password:{}}]){
  test('malformed reset input never reaches password mutation '+JSON.stringify(payload).slice(0,70),async t=>{
    const calls=database(t),res=await call(reset,payload);
    assert.equal(res.statusCode,400);assert.equal(calls.some(c=>c.name==='consume_password_reset_token'),false);
  });
}

test('database errors do not disclose reset tokens, passwords, or internal messages',async t=>{
  database(t,{rpcFailure:true});const res=await call(reset,{token,password});
  assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/private|TEST_PRIVATE_RPC_ERROR/);
  assert.equal(JSON.stringify(res.body).includes(token),false);assert.equal(JSON.stringify(res.body).includes(password),false);
});

test('owner pending-request list requests only necessary account fields',async t=>{
  const expected=[{id:'request',user_id:userId,status:'pending',requested_at:expiry,users:{id:userId,name:'نام',phone:'09123456789'}}];
  const calls=database(t,{requests:expected}),res=await call(adminReset,{},true,'GET');
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.requests,expected);
  const query=calls[0].query;assert.equal(query.get('status'),'eq.pending');assert.equal(query.get('limit'),'100');
  assert.equal(query.get('select'),'id,user_id,requested_at,status,users(id,name,phone)');
});

test('untrusted Host headers cannot poison owner reset links',()=>{
  const previous=new Map(['PUBLIC_BASE_URL','PUBLIC_SITE_URL','VERCEL_PROJECT_PRODUCTION_URL','NODE_ENV'].map(k=>[k,process.env[k]]));
  try{for(const key of previous.keys())delete process.env[key];process.env.NODE_ENV='production';assert.equal(recoveryOrigin({headers:{host:'attacker.invalid'}}),'https://drman.vercel.app');}
  finally{for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('the public session status endpoint clears pre-reset cookies without returning private account details',async t=>{
  database(t,{accountVersion:1});const res=response();
  await sessionStatus({method:'GET',headers:{cookie:`drman_session=${createToken({sub:userId,role:'user'})}`}},res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.body,{authenticated:false});assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
});

test('session status accepts a new-version cookie without disclosing the private version',async t=>{
  database(t,{accountVersion:3});const res=response();
  await sessionStatus({method:'GET',headers:{cookie:`drman_session=${createToken({sub:userId,role:'user',ver:3})}`}},res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.body,{authenticated:true,user:{id:userId,name:'نام',phone:'09123456789'}});
});
