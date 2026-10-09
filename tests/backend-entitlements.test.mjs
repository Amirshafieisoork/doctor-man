import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionExpired,readEntitlement,planLimit} from '../server/api/_lib/entitlements.js';

const now=Date.parse('2026-10-09T12:00:00Z');
const paid={id:'paid',slug:'pro',active:true,test_limit:40},free={id:'free',slug:'free',active:true,test_limit:2};
const baseUser={id:'test',status:'active',plan_started_at:'2026-10-01T00:00:00Z',plan_expires_at:'2026-11-01T00:00:00Z',plans:paid};
function database(user,freePlan=free,error=null){const calls=[];return {calls,from(table){calls.push(table);return {select(){return this},eq(){return this},async maybeSingle(){return {data:table==='users'?user:freePlan,error}}}}}}
test('valid paid entitlements keep subscription dates',async()=>{const db=database(baseUser),value=await readEntitlement(db,'test',now);assert.equal(value.plan,paid);assert.equal(value.expiresAt,baseUser.plan_expires_at);assert.deepEqual(db.calls,['users'])});
test('expired subscriptions fall back to Free without overwriting the user',async()=>{const db=database({...baseUser,plan_expires_at:'2026-10-09T12:00:00Z'}),value=await readEntitlement(db,'test',now);assert.equal(value.plan,free);assert.equal(value.expiresAt,null);assert.equal(value.startsAt,null);assert.equal(value.expired,true);assert.deepEqual(db.calls,['users','plans'])});
test('inactive or missing subscriptions fall back to Free',async()=>{for(const plans of [null,{...paid,active:false}]){const value=await readEntitlement(database({...baseUser,plans}),'test',now);assert.equal(value.plan.slug,'free')}});
test('database failure, blocked users and missing Free plan fail closed',async()=>{await assert.rejects(readEntitlement(database(null,free,new Error('query failure')),'test',now),/query failure/);await assert.rejects(readEntitlement(database({...baseUser,status:'blocked'}),'test',now),/USER_BLOCKED/);await assert.rejects(readEntitlement(database({...baseUser,plans:null},null),'test',now),/FREE_PLAN_UNAVAILABLE/)});
test('invalid expiry dates and unlimited or missing quotas are rejected',()=>{assert.equal(subscriptionExpired({plan_expires_at:'invalid'},now),true);for(const value of [-1,null,undefined,1.5,'unlimited'])assert.throws(()=>planLimit({test_limit:value},'test_limit'),/INVALID_PLAN_LIMIT/);assert.equal(planLimit({test_limit:0},'test_limit'),0);assert.equal(planLimit({test_limit:2},'test_limit'),2)});
