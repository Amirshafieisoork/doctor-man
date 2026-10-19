import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewRecord, readOverviewRecord, localOverview } from '../server/api/_lib/health-overview.js';
import { foodAllergyRows, criticalReportContext, criticalReportNotice, localLifestylePlan } from '../server/api/_lib/lifestyle-plan.js';

const patient={id:'synthetic',birth_date:'1990-01-01',sex:'male',height_cm:178};
test('environmental and medication allergy types do not become food exclusions; mixed food descriptions stay guarded',()=>{
 const rows=[{allergen:'گرده چمن و علف',allergy_type:'environmental'},{allergen:'کاه و گرد و غبار',allergy_type:'other'},{allergen:'پنی‌سیلین',allergy_type:'drug'},{allergen:'گرده چمن و بادام زمینی',allergy_type:'environmental'},{allergen:'شیر',allergy_type:'food'}];
 assert.deepEqual(foodAllergyRows(rows),rows.slice(3));
 assert.equal(foodAllergyRows([{allergen:'گرده چمن و حساسیت به غذای ناشناخته'}]).length,1);assert.equal(foodAllergyRows([{allergen:'کاهو'}]).length,1);
 const record=overviewRecord(patient,{allergies:rows.slice(0,2)}),text=localLifestylePlan(record).precautions.join(' ');
 assert.doesNotMatch(text,/برچسب مواد غذایی|آلودگی متقاطع/);assert.match(text,/دلیل حذف غذاها نیست/);
 assert.equal(record.allergies[0].allergy_type,'environmental');
});
test('reading the clinical snapshot retains allergy type while keeping queries patient scoped',async()=>{
 const selections=[];const db={from(table){const entry={table,fields:null,filters:[]};selections.push(entry);const query={select(fields){entry.fields=fields;return query;},eq(key,value){entry.filters.push([key,value]);return query;},order(){return query;},limit(){return query;},then(resolve){return Promise.resolve({data:[]}).then(resolve);}};return query;}};
 await readOverviewRecord(db,patient,Date.now());
 assert.match(selections.find(row=>row.table==='patient_allergies').fields,/allergy_type/);assert.ok(selections.every(row=>row.filters.some(([key,value])=>key==='patient_id'&&value===patient.id)));
});
test('an allergy-marker flag alone does not invent an acute emergency or suppress ordinary food planning',()=>{
 const record=overviewRecord(patient,{tests:[{created_at:'2026-10-01',structured_analysis:{items:[{name:'Total IgE',value:'350',unit:'IU/mL',flag:'critical'}]}}]});
 assert.equal(criticalReportContext(record).reported,true);assert.equal(criticalReportContext(record).clinicalHold,false);
 const warning=criticalReportNotice(record);assert.match(warning,/Total IgE/);assert.match(warning,/350/);assert.match(warning,/۱۴۰۵/);assert.match(warning,/به‌تنهایی/);
 assert.doesNotMatch(warning,/پزشک فوراً|مرکز درمانی فوراً/);assert.doesNotMatch(localOverview(record).seek_care,/برای تعیین اقدام لازم فوراً/);
});
test('true or uncertain acute critical results retain named, dated urgent review instead of being ignored by allergy history',()=>{
 const record=overviewRecord(patient,{allergies:[{allergen:'چمن',allergy_type:'environmental'}],tests:[{created_at:'2026-10-15',structured_analysis:{items:[{name:'Potassium',value:'6.8',unit:'mmol/L',flag:'critical'}]}}]});
 assert.equal(criticalReportContext(record).clinicalHold,true);
 const warning=criticalReportNotice(record);assert.match(warning,/Potassium 6.8 mmol\/L/);assert.match(warning,/۱۴۰۵/);assert.match(warning,/فوراً بررسی/);
 for(const name of ['Potassium and IgE','Troponin – allergy panel','CBC allergy panel','Troponin IgE']){record.tests[0].items[0].name=name;assert.equal(criticalReportContext(record).clinicalHold,true,name);}
});
