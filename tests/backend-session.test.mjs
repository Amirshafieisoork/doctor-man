import test from 'node:test';
import assert from 'node:assert/strict';
import {createToken,verifyToken,parseCookies,getUserSession,getAdminSession,requireUser,setUserSession} from '../server/api/_lib/session.js';

process.env.SESSION_SECRET='test-only-session-secret-32-characters';
const userId='11111111-1111-4111-8111-111111111111';
function req(token){return {headers:{cookie:`drman_session=${token}`}}}
function response(){return {headers:{},statusCode:200,status(n){this.statusCode=n;return this},json(value){this.body=value;return this},setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]}}}
function database(data,error=null){return {from(table){assert.equal(table,'users');return {select(fields){assert.equal(fields,'id,status,session_version');return this},eq(field,id){assert.equal(field,'id');assert.equal(id,userId);return this},async maybeSingle(){return {data,error}}}}}}

test('signed user session verifies and cannot become an admin session',()=>{
  const token=createToken({sub:userId,role:'user'});
  assert.equal(getUserSession(req(token)).sub,userId);
  assert.equal(getAdminSession({headers:{cookie:`drman_admin=${token}`}}),null);
  assert.equal(verifyToken(`${token}extra`),null);
  assert.equal(verifyToken(`${token}.ignored`),null);
  assert.equal(verifyToken(token.slice(0,-3)),null);
  assert.equal(verifyToken('unsigned'),null);
  assert.equal(verifyToken('.signature'),null);
  assert.equal(verifyToken('x'.repeat(4097)),null);
});
test('expired and future sessions are rejected',()=>{
  const actual=Date.now;
  try{
    Date.now=()=>100000;
    const token=createToken({sub:userId,role:'user'},60);
    Date.now=()=>160000;
    assert.equal(verifyToken(token),null);
    Date.now=()=>0;
    assert.equal(verifyToken(token),null);
  }finally{Date.now=actual}
});
test('malformed cookies do not break valid sessions and duplicate values do not replace the first',()=>{
  const token=createToken({sub:userId,role:'user'});
  const request={headers:{cookie:`bad=%E0%A4; drman_session=${token}; drman_session=other; __proto__=safe`}};
  assert.equal(getUserSession(request).sub,userId);
  assert.equal(Object.getPrototypeOf(parseCookies(request)),null);
  assert.equal(parseCookies({headers:{cookie:'%E0=value; other=ok'}}).other,'ok');
});
test('active users pass ownership authentication',async()=>{
  const res=response();
  const session=await requireUser(req(createToken({sub:userId,role:'user'})),res,database({id:userId,status:'active'}));
  assert.equal(session.sub,userId);
  assert.equal(res.body,undefined);
});
test('blocking a user revokes an already signed cookie immediately',async()=>{
  const res=response();
  assert.equal(await requireUser(req(createToken({sub:userId,role:'user'})),res,database({id:userId,status:'blocked'})),null);
  assert.equal(res.statusCode,403);
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
});
test('deleted users fail authentication and database outages fail closed',async()=>{
  const token=createToken({sub:userId,role:'user'}),deleted=response(),unavailable=response();
  assert.equal(await requireUser(req(token),deleted,database(null)),null);
  assert.equal(deleted.statusCode,401);
  assert.equal(await requireUser(req(token),unavailable,database(null,{code:'TEST_FAILURE'})),null);
  assert.equal(unavailable.statusCode,503);
});
test('production session cookies are HttpOnly, Secure and SameSite=Lax',()=>{
  const old=process.env.NODE_ENV;
  try{process.env.NODE_ENV='production';const res=response();setUserSession(res,{id:userId});assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/)}finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old}
});

for(const oldPayload of [{sub:userId,role:'user'},{sub:userId,role:'user',ver:0}]){
  test('password-reset version revokes an earlier signed cookie '+JSON.stringify(oldPayload),async()=>{
    const res=response();
    assert.equal(await requireUser(req(createToken(oldPayload)),res,database({id:userId,status:'active',session_version:1})),null);
    assert.equal(res.statusCode,401);assert.equal(res.body.code,'SESSION_REVOKED');assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
  });
}
test('a login after password reset carries the current account version',async()=>{
  const cookie=response();setUserSession(cookie,{id:userId,session_version:3});
  const request={headers:{cookie:cookie.headers['Set-Cookie']}};const res=response();
  assert.equal(getUserSession(request).ver,3);
  assert.equal((await requireUser(request,res,database({id:userId,status:'active',session_version:3}))).sub,userId);
});
for(const version of [-1,1.5,'1']){
  test('invalid signed session version fails closed '+JSON.stringify(version),async()=>{
    const res=response();
    assert.equal(await requireUser(req(createToken({sub:userId,role:'user',ver:version})),res,database({id:userId,status:'active',session_version:0})),null);
    assert.equal(res.statusCode,401);
  });
}
