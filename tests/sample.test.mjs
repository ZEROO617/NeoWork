import test from 'node:test';
import assert from 'node:assert/strict';
import {messages,upgradeSampleMessages} from '../public/data.js';
import {summarize} from '../public/analysis.js';
const oldSample=()=>structuredClone(messages.filter(m=>!['m9','m10'].includes(m.id)));
test('default project conversation supplies three distinct cited decisions',()=>{
 assert.deepEqual(summarize(messages.filter(m=>m.room==='project')).decisions.map(x=>x.id),['m8','m9','m10']);
});
test('untouched old sample upgrades once, preserving timestamps and original records',()=>{
 const old=oldSample(),snapshot=structuredClone(old);old.find(m=>m.id==='m8').time='2026-01-01T10:40:00Z';snapshot.find(m=>m.id==='m8').time=old.find(m=>m.id==='m8').time;
 const next=upgradeSampleMessages(old);assert.equal(next.length,old.length+2);assert.deepEqual(old,snapshot);assert.deepEqual(next.slice(0,old.length),old);assert.equal(next.find(m=>m.id==='m9').time,'2026-01-01T10:42:00.000Z');assert.equal(upgradeSampleMessages(next),next);
});
test('custom additions and edited samples are never replaced or extended',()=>{
 const added=[...oldSample(),{id:'custom',room:'project',name:'사용자',text:'검수 일정을 바꿉니다.',time:new Date().toISOString()}];assert.equal(upgradeSampleMessages(added),added);
 const edited=oldSample();edited[0].text='사용자가 수정한 대화';assert.equal(upgradeSampleMessages(edited),edited);
});
