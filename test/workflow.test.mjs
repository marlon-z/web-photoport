import test from 'node:test';
import assert from 'node:assert/strict';
import {presetOrganization,rememberOrganization,recallOrganization} from '../public/workflow.js';
import {layoutOverview} from '../lib/names.mjs';

test('整理规则只记列名，跨表匹配正确；缺列或重名不会悄悄使用别的列',()=>{
  const fields=[{id:'s',name:'SKU'},{id:'c',name:'客户'},{id:'p',name:'照片',type:'multipleAttachments'}];
  const o=presetOrganization('customer',fields);assert.deepEqual(o.groupBy,['c','s']);
  const saved=rememberOrganization(o,fields);assert.deepEqual(saved.groupBy,['客户','SKU']);
  assert.deepEqual(recallOrganization(saved,[{id:'n1',name:'SKU'},{id:'n2',name:'客户'}]).groupBy,['n2','n1']);
  assert.equal(recallOrganization(saved,[{id:'n1',name:'SKU'}]),null);
  assert.equal(recallOrganization(saved,[...fields,{id:'c2',name:'客户'}]),null);
  assert.equal(presetOrganization('product',[{id:'x',name:'名称'}]),null);
});

test('整理预览按实际分组统计，明确空值记录和被拒绝附件，不把同名记录合并计数',()=>{
  const records={records:[{id:'a',display:{sku:'A001'}},{id:'b',display:{sku:'A001'}},{id:'c',display:{sku:''}}]};
  const rows=['a','b','c'].map((recordId,i)=>({recordId,status:'pending',fieldId:'p',label:'同名',filename:`${i}.png`,extension:'png'}));
  const overview=layoutOverview([...rows,{...rows[0],status:'rejected'}],{groupBy:['sku']},records);
  assert.equal(overview.files,3);assert.equal(overview.groups,2);assert.equal(overview.emptyRecords,1);
  assert.deepEqual(overview.preview,[{name:'A001',files:2},{name:'未填写',files:1}]);
  assert.equal(layoutOverview(rows,{},records).groups,3);
  assert.equal(layoutOverview(rows.slice(0,2),{groupBy:['sku']},records).emptyRecords,0);
});
