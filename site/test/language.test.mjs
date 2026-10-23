import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('every English public page starts in English; privacy and removal have separate Chinese pages',async()=>{
  for(const path of ['index.html','privacy.html','remove.html','404.html']){
    const html=await readFile(new URL('../public/'+path,import.meta.url),'utf8');
    assert.match(html,/<html lang="en">/);
    assert.doesNotMatch(html.replaceAll('中文',''),/[\u3400-\u9fff]/u,path);
    assert.match(html,/<script type="module" src="\/site.js"/);
  }
  for(const path of ['index.html','privacy.html','remove.html']){
    const html=await readFile(new URL('../public/zh/'+path,import.meta.url),'utf8');
    assert.match(html,/<html lang="zh-CN">/);
    assert.match(html,/href="\/zh\/privacy"/);
  }
  assert.equal(await readFile(new URL('../public/form-validation.js',import.meta.url),'utf8'),await readFile(new URL('../../public/form-validation.js',import.meta.url),'utf8'));
});
