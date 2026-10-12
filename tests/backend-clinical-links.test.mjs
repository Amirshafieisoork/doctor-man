import test from 'node:test';
import assert from 'node:assert/strict';
import {encounterLinks} from '../server/api/_lib/clinical-links.js';

const input={patientId:'patient-a',doctorId:'doctor-a',userId:'user-a',doctorOrganizationId:'clinic-a'};
function database(rows){const queries=[];return {queries,from(table){const filters={};queries.push({table,filters});return {select(){return this},eq(key,value){filters[key]=value;return this},async maybeSingle(){return rows[table]||{data:null,error:null}}}}}}
test('a clinical encounter rejects another patient appointment even with write access',async()=>{const db=database({appointments:{data:null}});await assert.rejects(encounterLinks(db,{...input,appointmentId:'foreign-appointment'}),/نوبت/);assert.deepEqual(db.queries[0].filters,{id:'foreign-appointment',patient_id:'patient-a',doctor_id:'doctor-a'})});
test('intake and appointment must belong to the same visit',async()=>{const db=database({visit_intakes:{data:{id:'intake',appointment_id:'visit-a'}}});await assert.rejects(encounterLinks(db,{...input,intakeId:'intake',appointmentId:'visit-b'}),/شرح حال/)});
test('a validated intake resolves its linked appointment and organization',async()=>{const db=database({visit_intakes:{data:{id:'intake',appointment_id:'visit-a'}},appointments:{data:{id:'visit-a',organization_id:'clinic-a',status:'confirmed'}}});assert.deepEqual(await encounterLinks(db,{...input,intakeId:'intake'}),{intake_id:'intake',appointment_id:'visit-a',organization_id:'clinic-a'});assert.equal(db.queries.length,2)});
test('a doctor cannot attach a record to another clinic without active membership',async()=>{const db=database({organization_members:{data:null}});await assert.rejects(encounterLinks(db,{...input,organizationId:'clinic-b'}),/مرکز درمانی/);assert.deepEqual(db.queries[0].filters,{organization_id:'clinic-b',user_id:'user-a',doctor_id:'doctor-a',status:'active'})});
test('database failures cannot silently approve linked clinical records',async()=>{await assert.rejects(encounterLinks(database({appointments:{data:null,error:new Error('query failed')}}),{...input,appointmentId:'visit'}),/query failed/)});
