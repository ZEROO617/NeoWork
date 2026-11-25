// Persistent conversation document; independent of rendering and API calls.
export const sections=['topics','decisions','tasks'];
export const emptyDocument=()=>({version:1,decisionFormatVersion:1,topics:[],decisions:[],tasks:[],history:[],tombstones:[],evidence:{},processed:[],revision:0,syncedRevision:0,updatedAt:null});
const clone=value=>JSON.parse(JSON.stringify(value));
export const signature=m=>[m.id,m.text];
export function validDocument(value){return !!value&&value.version===1&&[...sections,'history','tombstones','processed'].every(k=>Array.isArray(value[k]))&&value.evidence&&typeof value.evidence==='object'&&Number.isInteger(value.revision)&&Number.isInteger(value.syncedRevision)}
export function pendingMessages(doc,messages){const first=messages.findIndex((m,i)=>doc.processed[i]?.[0]!==m.id||doc.processed[i]?.[1]!==m.text);return first<0?[]:messages.slice(first)}
export const needsDecisionRestructure=doc=>doc.decisionFormatVersion!==1&&doc.decisions.some(item=>item.origin==='ai');
export const isDirty=(doc,messages)=>!doc.updatedAt||pendingMessages(doc,messages).length>0||doc.revision!==doc.syncedRevision||needsDecisionRestructure(doc);
export function manualChange(doc,section,id,fields,messages,author,remove=false){
 if(!sections.includes(section))throw Error('invalid_section');
 const next=clone(doc),index=next[section].findIndex(x=>x.id===id),old=next[section][index],now=new Date().toISOString();
 if(remove&&!old)throw Error('missing_item');
 if(old&&section==='decisions')next.history.push({...old,historyId:crypto.randomUUID(),originalId:old.id,state:remove?'cancelled':'superseded',reason:remove?'직접 삭제':'직접 수정',changeSources:[],changedAt:now,changedBy:author});
 if(remove){next[section].splice(index,1);next.tombstones.push({section,item:old,manualCursor:messages.length,deletedAt:now,author});}
 else{
  const text=String(section==='tasks'?fields.title:fields.text).trim();if(!text||text.length>(section==='tasks'?100:200))throw Error('invalid_text');
  const item={...(old||{}),id:old?.id||crypto.randomUUID(),sources:old?.sources||[],origin:'manual',editedBy:author,editedAt:now,manualCursor:messages.length};
  if(section==='tasks'){if(!['완료','진행 중','확인 불가'].includes(fields.status))throw Error('invalid_status');Object.assign(item,{title:text,name:String(fields.name||'확인 불가').trim().slice(0,20),due:String(fields.due||'기한 미정').trim().slice(0,60),status:fields.status});}else item.text=text;
  if(index<0)next[section].push(item);else next[section][index]=item;
 }
 next.revision++;return next;
}
export function pruneEvidence(doc){const ids=new Set([...sections.flatMap(s=>doc[s]),...doc.history,...doc.tombstones.map(t=>t.item)].flatMap(x=>[...(x.sources||[]),...(x.changeSources||[])]));doc.evidence=Object.fromEntries(Object.entries(doc.evidence).filter(([id])=>ids.has(id)));return doc}
const normalized=x=>String(x||'').toLowerCase().replace(/[\s.,·!?]/g,'');
export function applyOperations(doc,operations,messages,offset){
 const next=clone(doc),now=new Date().toISOString(),positions=new Map(messages.map((m,i)=>[m.id,offset+i]));
 for(const m of messages)next.evidence[m.id]=m;
 for(const op of operations){
  if(!sections.includes(op.section))throw Error('invalid_section');
  const items=next[op.section],index=items.findIndex(x=>op.id?x.id===op.id:normalized(x.text||x.title)===normalized(op.text)),old=items[index],deleted=next.tombstones.find(t=>t.section===op.section&&(t.item.id===op.id||normalized(t.item.text||t.item.title)===normalized(op.text)));
  const sources=[...new Set(op.sources||[])];if(!sources.length||sources.some(id=>!Object.hasOwn(next.evidence,id)))throw Error('invalid_sources');
  const newIndices=sources.filter(id=>positions.has(id)).map(id=>positions.get(id));
  const protectedCursor=old?.origin==='manual'?old.manualCursor:deleted?.manualCursor;
  if(protectedCursor!==undefined&&!newIndices.some(i=>i>=protectedCursor))continue;
  if(['cancel','supersede','remove'].includes(op.action)&&!old)continue;
  if(op.section==='decisions'&&old&&(op.action==='cancel'||op.action==='supersede'||op.action==='remove'))next.history.push({...old,historyId:crypto.randomUUID(),originalId:old.id,state:op.action==='supersede'?'superseded':'cancelled',reason:op.reason||'후속 대화에 따른 변경',changeSources:sources,changedAt:now});
  if(op.action==='cancel'||op.action==='remove'){items.splice(index,1);continue;}
  if(!['upsert','supersede'].includes(op.action)||!op.text.trim())throw Error('invalid_operation');
  const item={id:old?.id||deleted?.item.id||crypto.randomUUID(),sources,origin:'ai',updatedAt:now};
  if(op.section==='tasks')Object.assign(item,{title:op.text,name:op.name,due:op.due,status:op.status});else item.text=op.text;
  if(index<0)items.push(item);else items[index]=item;
  if(deleted)next.tombstones=next.tombstones.filter(t=>t!==deleted);
 }
 return pruneEvidence(next);
}
export function apiDocument(doc){return {version:1,...Object.fromEntries(sections.map(s=>[s,doc[s]])),history:doc.history,tombstones:doc.tombstones,evidence:doc.evidence}}
export function requestBatches(messages,doc,room,user){
 // The caller recomputes this after each staged result, so evidence growth is budgeted.
 let batch=[];const encode=rows=>new TextEncoder().encode(JSON.stringify({room,user,mode:'update',previous:apiDocument(doc),messages:rows,offset:0})).length;
 for(const m of messages.slice(0,80)){if(encode([...batch,m])>90000)break;batch.push(m)}
 if(messages.length&&!batch.length)throw Error('request_too_large');if(!messages.length&&encode([])>90000)throw Error('request_too_large');return batch;
}

export async function stageRefresh(base,messages,room,user,request,onProgress=()=>{}){
 const cutoff=clone(messages);let staged=clone(base);if(!isDirty(staged,cutoff))return staged;const restructureDecisions=needsDecisionRestructure(staged);let remaining=restructureDecisions?cutoff:pendingMessages(staged,cutoff),first=true,processed=0;
 while(first||remaining.length){first=false;const batch=requestBatches(remaining,staged,room,user),offset=batch.length?cutoff.findIndex(m=>m.id===batch[0].id):cutoff.length;const result=await request({room,user,mode:'update',previous:apiDocument(staged),messages:batch,offset,...(restructureDecisions?{restructureDecisions:true}:{})});if(!Array.isArray(result?.operations))throw Error('invalid_output');staged=applyOperations(staged,result.operations,batch,offset);processed+=batch.length;remaining=remaining.slice(batch.length);onProgress(processed);if(!batch.length)break;}
 staged.processed=cutoff.map(signature);staged.updatedAt=new Date().toISOString();staged.syncedRevision=staged.revision;staged.decisionFormatVersion=1;return staged;
}
