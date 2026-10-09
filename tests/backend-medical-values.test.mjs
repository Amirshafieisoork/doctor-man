import test from 'node:test';
import assert from 'node:assert/strict';
import {numericLabValue} from '../server/api/_lib/biomarkers.js';
import {safeErrorMetadata} from '../server/api/_lib/errors.js';

test('trend values only accept exact numbers and preserve bounds as text',()=>{
  for(const value of ['<5','>100','2-3','120 / 80','Positive','5,6','1.2 mg/dL','10^3',null])assert.equal(numericLabValue(value),null,value);
  for(const [value,expected] of [['12.5',12.5],['۱۲۰',120],['١٢٣٫٥',123.5],['1,234.5',1234.5],['1.2e3',1200],['.5',.5],['-2',-2]])assert.equal(numericLabValue(value),expected,value);
});
test('provider logs discard error messages, payloads and credentials',()=>{
  const output=JSON.stringify(safeErrorMetadata({name:'AuthenticationError',status:401,message:'Incorrect API key private-value',code:'private-value',response:{private:'private-value'}}));
  assert.equal(output,'{"type":"AuthenticationError","status":401}');
  assert.equal(output.includes('private-value'),false);
});
