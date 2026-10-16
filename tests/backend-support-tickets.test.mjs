import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {createClient} from '@supabase/supabase-js';
import {createToken} from '../server/api/_lib/session.js';

process.env.SUPABASE_URL='https://ticket-tests.invalid';
process.env.SUPABASE_SECRET_KEY='test-only-database-key';
process.env.SESSION_SECRET='test-only-session-secret-32-characters';
process.env.FREE_AI_API_KEY='test-only-model-key';
process.env.FREE_AI_ACCOUNT_CONFIRMED='true';
const {supabase}=await import('../server/api/_lib/db.js');
const {default:userTickets}=await import('../server/api/support-tickets.js');
const {default:adminTickets}=await import('../server/api/admin-support-tickets.js');
const {default:legacyChat}=await import('../server/api/support-chat.js');
const userId='11111111-1111-4111-8111-111111111111';
const foreignUserId='22222222-2222-4222-8222-222222222222';
const ticketId='33333333-3333-4333-8333-333333333333';
const foreignTicketId='44444444-4444-4444-8444-444444444444';
const createdAt='2026-10-13T12:00:00.000Z';
const title='اشکال ورود',text='رمز حساب کار نمی‌کند';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}
function response(){return {statusCode:200,headers:{},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];}};}
function services(t,{aiEnabled=false,status='open',legacyUsage=0,ticketUsage=0,limit=5,aiFailure=false,onAI,rateCount=0,aiDisabled=false,notificationFailure=false,aiAnswer}={}){
  const state={status:'active',sessionVersion:0,tickets:[{id:ticketId,user_id:userId,title,category:'account',status,ai_enabled:aiEnabled,tags:[],created_at:createdAt,updated_at:createdAt},{id:foreignTicketId,user_id:foreignUserId,title:'private foreign title',category:'other',status:'open',ai_enabled:true,tags:[],created_at:createdAt,updated_at:createdAt}],messages:[],aiCalls:[],dbCalls:[],reservations:[]};
  const client=createClient('https://ticket-tests.invalid','test-only-client-key',{auth:{persistSession:false,autoRefreshToken:false},global:{async fetch(input,init){
    const req=new Request(input,init),url=new URL(req.url),name=url.pathname.split('/').at(-1),query=url.searchParams;
    const body=['GET','HEAD'].includes(req.method)?null:await req.json();
    state.dbCalls.push({name,method:req.method,body,query});
    if(name==='users')return json([{id:query.get('id')?.slice(3)||userId,status:state.status,session_version:state.sessionVersion,name:'نام',phone:'09123456789',plans:{id:'free-plan',active:true,support_daily_limit:limit}}]);
    if(name==='app_settings')return query.get('key')==='eq.private_ai'?json([]):json([{value:{support_chat:!aiDisabled}}]);
    if(name==='auth_rate_events'){
      if(req.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':`*/${rateCount}`}});
      if(req.method==='GET')return json([{created_at:new Date().toISOString()}]);
      if(req.method==='POST')return json({id:'rate-attempt'},201);
      if(req.method==='PATCH')return new Response(null,{status:204});
    }
    if(name==='support_tickets'){
      if(req.method==='GET'){
        let tickets=state.tickets;
        if(query.get('id'))tickets=tickets.filter(t=>t.id===query.get('id').slice(3));
        if(query.get('user_id'))tickets=tickets.filter(t=>t.user_id===query.get('user_id').slice(3));
        return json(tickets);
      }
      if(req.method==='POST'){
        const ticket={id:ticketId,category:'other',status:'open',ai_enabled:true,tags:[],created_at:createdAt,updated_at:createdAt,...body};
        state.tickets=state.tickets.filter(t=>t.id!==ticket.id).concat(ticket);return json(ticket,201);
      }
      if(req.method==='PATCH'){
        const ticket=state.tickets.find(t=>t.id===query.get('id').slice(3));Object.assign(ticket,body);return new Response(null,{status:204});
      }
    }
    if(name==='support_ticket_messages'){
      if(req.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':`*/${ticketUsage}`}});
      if(req.method==='GET')return json(state.messages.filter(m=>m.ticket_id===query.get('ticket_id')?.slice(3)).slice().reverse());
    }
    if(name==='support_messages'&&req.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':`*/${legacyUsage}`}});
    if(name==='reserve_support_ai_reply'){
      const ticket=state.tickets.find(t=>t.id===body.p_ticket_id&&t.user_id===body.p_user_id);
      if(!ticket||!ticket.ai_enabled||ticket.status==='closed')return json({reserved:false,reason:'human'});
      const used=legacyUsage+ticketUsage+state.messages.filter(m=>m.sender_type==='assistant').length+state.reservations.length;
      if(used>=limit)return json({reserved:false,reason:'quota'});
      const reservation={reservation_id:'55555555-5555-4555-8555-555555555555',ticket_id:ticket.id,user_id:body.p_user_id};state.reservations.push(reservation);
      return json({reserved:true,...reservation,remaining_today:limit-used-1});
    }
    if(name==='release_support_ai_reservation'){state.reservations=state.reservations.filter(r=>r.reservation_id!==body.p_reservation_id||r.user_id!==body.p_user_id);return json(null);}
    if(name==='append_support_ticket_message'){
      const ticket=state.tickets.find(t=>t.id===body.p_ticket_id);
      if(!ticket||state.status!=='active')return json({code:'TEST_TICKET_UNAVAILABLE'},400);
      if(['user','assistant'].includes(body.p_sender_type)&&ticket.user_id!==body.p_user_id)return json({code:'TEST_TICKET_FORBIDDEN'},403);
      if(body.p_sender_type==='assistant'&&(!ticket.ai_enabled||ticket.status==='closed'))return json({saved:false,human_takeover:true});
      if(body.p_sender_type==='assistant'&&!state.reservations.some(r=>r.reservation_id===body.p_reservation_id&&r.user_id===body.p_user_id&&r.ticket_id===ticket.id))return json({saved:false,quota_expired:true});
      const message={id:'message-'+state.messages.length,ticket_id:ticket.id,sender_type:body.p_sender_type,content:body.p_content,created_at:createdAt};state.messages.push(message);
      ticket.status=body.p_sender_type==='user'?'waiting_admin':'waiting_user';if(body.p_sender_type==='admin')ticket.ai_enabled=false;
      return json({saved:true,message_id:message.id});
    }
    if(name==='create_support_ticket'){
      const ticket={id:ticketId,user_id:body.p_user_id,title:body.p_title,category:body.p_category,status:body.p_sender_type==='admin'?'waiting_user':'waiting_admin',ai_enabled:body.p_sender_type!=='admin',tags:body.p_tags||[],created_at:createdAt,updated_at:createdAt};
      state.tickets=state.tickets.filter(t=>t.id!==ticket.id).concat(ticket);
      const message={id:'initial-message',ticket_id:ticket.id,sender_type:body.p_sender_type,content:body.p_content,created_at:createdAt};state.messages.push(message);
      return json(ticket);
    }
    if(name==='notify_support_ticket_user')return notificationFailure?json({code:'TEST_NOTIFICATION_FAILURE'},400):json(state.status==='active');
    if(name==='notifications'&&notificationFailure)return json({code:'TEST_NOTIFICATION_FAILURE'},400);
    if(['notifications','audit_logs'].includes(name)&&req.method==='POST')return new Response(null,{status:201});
    throw new Error(`Unexpected fake HTTP ${req.method} ${name}`);
  }}});
  const original={from:supabase.from,rpc:supabase.rpc,create:OpenAI.Chat.Completions.prototype.create};
  supabase.from=client.from.bind(client);supabase.rpc=client.rpc.bind(client);
  OpenAI.Chat.Completions.prototype.create=async function(body){state.aiCalls.push(body);await onAI?.(state);if(aiFailure)throw new Error('test-only-private-provider-error');return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(aiAnswer||{answer:'از بخش فراموشی رمز در صفحه ورود درخواست بازیابی ثبت کنید؛ پشتیبانی پس از تأیید هویت راهنمایی می‌کند.',reference_ids:['account_help']})}}]};};
  t.after(()=>{supabase.from=original.from;supabase.rpc=original.rpc;OpenAI.Chat.Completions.prototype.create=original.create;});
  return state;
}
async function call(handler,{method='GET',body={},query={},role='user',version=0}={}){
  const res=response(),headers={};
  if(role==='user')headers.cookie=`drman_session=${createToken({sub:userId,role:'user',ver:version})}`;
  if(role==='admin')headers.cookie=`drman_admin=${createToken({sub:'admin',role:'admin'})}`;
  await handler({method,headers,body,query},res);return res;
}

test('ordinary users list only their own support tickets',async t=>{
  const state=services(t),res=await call(userTickets);
  assert.equal(res.statusCode,200);assert.equal(res.body.tickets.length,1);assert.equal(res.body.tickets[0].id,ticketId);
  const lookup=state.dbCalls.find(c=>c.name==='support_tickets');assert.equal(lookup.query.get('user_id'),`eq.${userId}`);
});

for(const method of ['GET','POST']){
  test('another account ticket cannot be read or appended using '+method,async t=>{
    const state=services(t),res=await call(userTickets,{method,query:{ticket_id:foreignTicketId},body:{ticket_id:foreignTicketId,message:text}});
    assert.equal(res.statusCode,404);assert.equal(state.dbCalls.some(c=>c.name==='support_ticket_messages'),false);assert.equal(state.dbCalls.some(c=>c.name==='append_support_ticket_message'),false);assert.equal(state.aiCalls.length,0);
  });
}

for(const role of ['none','user']){
  test('owner support controls reject '+role+' authentication',async t=>{
    const state=services(t),res=await call(adminTickets,{method:'POST',role,body:{ticket_id:ticketId,message:text}});
    assert.equal(res.statusCode,401);assert.equal(state.dbCalls.length,0);
  });
}

test('unauthenticated and blocked accounts cannot open or read support tickets',async t=>{
  const state=services(t);const none=await call(userTickets,{role:'none'});assert.equal(none.statusCode,401);
  state.status='blocked';const blocked=await call(userTickets,{method:'POST',body:{title,message:text}});assert.equal(blocked.statusCode,403);
  assert.equal(state.dbCalls.some(c=>c.name==='support_tickets'),false);
});

test('revoked pre-reset sessions cannot access support tickets',async t=>{
  const state=services(t);state.sessionVersion=1;const res=await call(userTickets);
  assert.equal(res.statusCode,401);assert.equal(res.body.code,'SESSION_REVOKED');assert.equal(state.dbCalls.some(c=>c.name==='support_tickets'),false);
});

test('malformed ticket identifiers never read messages or call AI',async t=>{
  const state=services(t),res=await call(userTickets,{query:{ticket_id:'not-a-ticket'}});
  assert.equal(res.statusCode,400);assert.equal(state.dbCalls.some(c=>c.name==='support_ticket_messages'),false);assert.equal(state.aiCalls.length,0);
});

test('a closed support ticket rejects new user messages',async t=>{
  const state=services(t,{status:'closed'}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,409);assert.equal(state.messages.length,0);assert.equal(state.aiCalls.length,0);
});

test('user role and account ownership are fixed by the server despite extra body fields',async t=>{
  const state=services(t),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text,user_id:foreignUserId,sender_type:'admin',role:'admin',ai_enabled:true,tags:['private-admin-tag']}});
  assert.equal(res.statusCode,200);assert.equal(state.messages[0].sender_type,'user');
  const mutation=state.dbCalls.find(c=>c.name==='append_support_ticket_message');assert.equal(mutation.body.p_user_id,userId);assert.equal(mutation.body.p_sender_type,'user');
  assert.deepEqual(state.tickets[0].tags,[]);assert.equal(state.aiCalls.length,0);
});

test('AI provider failure retains the user message and gives an honest owner-pending response',async t=>{
  const state=services(t,{aiEnabled:true,aiFailure:true}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(res.body.success,true);assert.equal(res.body.pending_admin,true);assert.equal(res.body.ai_unavailable,true);
  assert.deepEqual(state.messages.map(m=>m.sender_type),['user']);assert.equal(state.messages[0].content,text);assert.doesNotMatch(JSON.stringify(res.body),/test-only-private-provider-error|model-key/);
});

test('an owner answer takes over the ticket and suppresses further automatic responses',async t=>{
  const state=services(t,{aiEnabled:true});const owner=await call(adminTickets,{method:'POST',role:'admin',body:{ticket_id:ticketId,message:'پاسخ مدیر'}});
  assert.equal(owner.statusCode,200);assert.equal(state.tickets.find(x=>x.id===ticketId).ai_enabled,false);
  const user=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(user.statusCode,200);assert.equal(user.body.pending_admin,true);assert.equal(state.aiCalls.length,0);assert.deepEqual(state.messages.map(m=>m.sender_type),['admin','user']);
});

test('an owner takeover while AI is running prevents a late AI answer from being saved or returned',async t=>{
  const state=services(t,{aiEnabled:true,onAI:async s=>{s.tickets.find(x=>x.id===ticketId).ai_enabled=false;}}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(res.body.human_takeover,true);assert.equal(res.body.pending_admin,true);assert.equal(res.body.answer,undefined);assert.deepEqual(state.messages.map(m=>m.sender_type),['user']);
});

test('users do not receive an AI response after account blocking during generation',async t=>{
  const state=services(t,{aiEnabled:true,onAI:async s=>{s.status='blocked';}}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,403);assert.equal(res.body.answer,undefined);assert.deepEqual(state.messages.map(m=>m.sender_type),['user']);
});

test('owner updates cannot reassign ticket ownership or accept invented statuses',async t=>{
  const state=services(t);
  const bad=await call(adminTickets,{method:'PATCH',role:'admin',body:{ticket_id:ticketId,status:'made-up'}});assert.equal(bad.statusCode,400);
  const updated=await call(adminTickets,{method:'PATCH',role:'admin',body:{ticket_id:ticketId,user_id:foreignUserId,status:'closed',ai_enabled:false,tags:[' issue ','issue']}});
  assert.equal(updated.statusCode,200);assert.equal(state.tickets.find(t=>t.id===ticketId).user_id,userId);
  const mutation=state.dbCalls.find(c=>c.name==='support_tickets'&&c.method==='PATCH');assert.equal(mutation.body.user_id,undefined);assert.deepEqual(mutation.body.tags,['issue']);
});

test('new user tickets and their initial messages use one atomic server-owned mutation',async t=>{
  const state=services(t,{aiDisabled:true}),res=await call(userTickets,{method:'POST',body:{title,message:text,category:'account',user_id:foreignUserId,sender_type:'admin',tags:['owner-only'],ai_enabled:false}});
  assert.equal(res.statusCode,200);assert.equal(state.messages.length,1);assert.equal(state.messages[0].sender_type,'user');assert.equal(state.messages[0].content,text);
  const create=state.dbCalls.find(c=>c.name==='create_support_ticket');
  assert.deepEqual(create.body,{p_user_id:userId,p_title:title,p_category:'account',p_content:text,p_sender_type:'user',p_tags:[]});
  assert.equal(state.dbCalls.some(c=>c.name==='support_tickets'&&c.method==='POST'),false);assert.equal(state.dbCalls.some(c=>c.name==='append_support_ticket_message'),false);
  assert.equal(res.body.pending_admin,true);assert.equal(res.body.ai_disabled,true);
});

test('owner proactive tickets keep initial labels and message even when notifications fail',async t=>{
  const state=services(t,{notificationFailure:true}),res=await call(adminTickets,{method:'POST',role:'admin',body:{action:'create',user_id:userId,title,message:text,category:'billing',tags:[' issue ','issue']}});
  assert.equal(res.statusCode,200);assert.equal(res.body.notification_sent,false);assert.equal(state.messages[0].sender_type,'admin');
  const create=state.dbCalls.find(c=>c.name==='create_support_ticket');assert.equal(create.body.p_sender_type,'admin');assert.deepEqual(create.body.p_tags,['issue']);assert.equal(res.body.ticket.ai_enabled,false);assert.deepEqual(res.body.ticket.tags,['issue']);
  assert.equal(state.dbCalls.some(c=>c.name==='support_tickets'&&c.method==='PATCH'),false);
});

test('disabling smart support leaves human ticket registration available without calling AI or reserving quota',async t=>{
  const state=services(t,{aiEnabled:true,aiDisabled:true}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(res.body.ai_disabled,true);assert.equal(state.messages.length,1);assert.equal(state.aiCalls.length,0);assert.equal(state.dbCalls.some(c=>c.name==='reserve_support_ai_reply'),false);
});

test('legacy and current support usage share the same daily quota while user messages remain saved',async t=>{
  const state=services(t,{aiEnabled:true,legacyUsage:3,ticketUsage:2,limit:5}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(res.body.ai_limit_reached,true);assert.equal(res.body.pending_admin,true);assert.equal(state.messages.length,1);assert.equal(state.aiCalls.length,0);
  assert.deepEqual(state.dbCalls.find(c=>c.name==='reserve_support_ai_reply').body,{p_user_id:userId,p_ticket_id:ticketId});
});

test('AI failures release their account-scoped quota reservation without losing the original message',async t=>{
  const state=services(t,{aiEnabled:true,aiFailure:true}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(state.reservations.length,0);assert.deepEqual(state.messages.map(m=>m.sender_type),['user']);
  const release=state.dbCalls.find(c=>c.name==='release_support_ai_reservation');assert.equal(release.body.p_user_id,userId);assert.match(release.body.p_reservation_id,/^[a-f0-9-]{36}$/);
});

test('expired reservations cannot publish an unreserved AI answer',async t=>{
  const state=services(t,{aiEnabled:true,onAI:async s=>{s.reservations=[];}}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,200);assert.equal(res.body.ai_unavailable,true);assert.equal(res.body.human_takeover,false);assert.equal(res.body.answer,undefined);assert.deepEqual(state.messages.map(m=>m.sender_type),['user']);
});

test('the legacy support chat route writes a persistent ticket instead of a transient chat row',async t=>{
  const state=services(t,{aiDisabled:true}),res=await call(legacyChat,{method:'POST',body:{message:text}});
  assert.equal(res.statusCode,200);assert.equal(state.messages[0].content,text);assert.equal(res.body.ticket.title,'گفتگو با پشتیبانی');
  assert.equal(state.dbCalls.some(c=>c.name==='support_messages'&&c.method==='POST'),false);assert.equal(state.dbCalls.filter(c=>c.name==='create_support_ticket').length,1);
});

test('rate-limited messages do not create tickets, append content, or call AI',async t=>{
  const state=services(t,{rateCount:30}),res=await call(userTickets,{method:'POST',body:{title,message:text}});
  assert.equal(res.statusCode,429);assert.ok(Number(res.headers['Retry-After'])>0);assert.equal(state.messages.length,0);assert.equal(state.aiCalls.length,0);assert.equal(state.dbCalls.some(c=>c.name==='create_support_ticket'),false);
});


test('medical support uses reviewed references without transmitting ticket health data to a model',async t=>{
  const state=services(t,{aiEnabled:true}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:'پرولاکتین بالا یعنی تومور دارم؟'}});
  assert.equal(res.statusCode,200);assert.equal(state.aiCalls.length,0);assert.equal(res.body.evidence_mode,'curated_reference');assert.equal(res.body.search_performed,false);
  assert.ok(res.body.sources.some(source=>source.url==='https://medlineplus.gov/lab-tests/prolactin-levels/'));
  assert.match(res.body.answer,/به‌تنهایی|به تنهایی/);assert.match(state.messages.at(-1).content,/medlineplus.gov/);
});
test('unknown medical requests and mixed billing plus drug advice never fall through to site AI',async t=>{
  const state=services(t,{aiEnabled:true});
  for(const message of ['برای سردرد شدید چه قرصی بخورم؟','پلنم فعال نمیشه؛ داروی تومور رو چقدر بخورم؟']){
    const res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message}});assert.equal(res.statusCode,200);assert.equal(res.body.search_performed,false);assert.match(res.body.answer,/نمی‌توانم|منبع اختصاصی/);
  }
  assert.equal(state.aiCalls.length,0);
});
test('support discards fabricated site source IDs and retains human follow-up',async t=>{
  const state=services(t,{aiEnabled:true,aiAnswer:{answer:'پاسخ ظاهراً معتبر که منبع آن ساختگی است.',reference_ids:['https://evil.invalid']}}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.body.pending_admin,true);assert.equal(res.body.answer,undefined);assert.deepEqual(state.messages.map(row=>row.sender_type),['user']);assert.equal(state.reservations.length,0);
});
test('resetting a password during support generation prevents saving or exposing the late answer',async t=>{
  const state=services(t,{aiEnabled:true,onAI:async s=>{s.sessionVersion++;}}),res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message:text}});
  assert.equal(res.statusCode,401);assert.equal(res.body.answer,undefined);assert.deepEqual(state.messages.map(row=>row.sender_type),['user']);assert.equal(state.reservations.length,0);
});
test('site support removes credential-like strings, email and national/phone identifiers before calling Free AI',async t=>{
  const state=services(t,{aiEnabled:true}),message='مشکل ورود؛ password: SUPER_PRIVATE_VALUE، client_secret: PRIVATE_SECRET من ۰۹۱۲۳۴۵۶۷۸۹ و ۰۰۱۲۳۴۵۶۷۸ user@example.invalid هستم';
  const res=await call(userTickets,{method:'POST',body:{ticket_id:ticketId,message}});assert.equal(res.statusCode,200);assert.equal(state.aiCalls.length,1);
  const sent=JSON.stringify(state.aiCalls[0]);assert.doesNotMatch(sent,/SUPER_PRIVATE_VALUE|PRIVATE_SECRET|09123456789|0012345678|user@example/);assert.equal(JSON.parse(state.aiCalls[0].messages[1].content).raw_ticket_text_sent,false);
});
