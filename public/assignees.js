// AI assignees must be people/nicknames grounded in the cited conversation.
const quote=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function resolveTaskAssignee(value,sourceIds,evidence,manualNames=[]){
 const candidate=String(value||'').trim(),all=Object.values(evidence||{}),sources=(sourceIds||[]).map(id=>evidence?.[id]).filter(Boolean);
 const known=new Set([...all.map(m=>m.name),...manualNames].filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()));
 if(candidate&&known.has(candidate))return candidate.slice(0,20);
 const placeholders=['','확인 불가','담당 미정','미정','저','나','제가','본인','각자','전원','모두','팀원','우리 팀'];
 if(!placeholders.includes(candidate)&&candidate.length<=20){
  const n=quote(candidate),assigned=new RegExp('(?:담당자(?:는|가|:)?\\s*'+n+'(?:님)?(?:입니다|이에요|예요|$)|'+n+'(?:님)?(?:이|가|은|는)\\s*[^.!?\\n]{0,50}(?:맡|담당))');
  if(sources.some(m=>assigned.test(m.text)))return candidate;
 }
 const self=sources.filter(m=>/(?:제가|저는|내가|나는)[^.!?\n]*(?:맡|담당|하겠|작성|구현|진행)|(?:맡을게요|담당할게요)/.test(m.text));
 const owners=[...new Set(self.map(m=>m.name).filter(Boolean))];return owners.length===1?owners[0].slice(0,20):'확인 불가';
}
export function repairTaskAssignees(doc,messages=[]){
 if(!doc?.tasks)return doc;
 const evidence={...doc.evidence,...Object.fromEntries(messages.map(m=>[m.id,m]))},manualNames=doc.tasks.filter(t=>t.origin==='manual').map(t=>t.name);let changed=false;
 const tasks=doc.tasks.map(task=>{if(task.origin!=='ai')return task;const name=resolveTaskAssignee(task.name,task.sources,evidence,manualNames);if(name===task.name)return task;changed=true;return {...task,name}});
 return changed?{...doc,tasks}:doc;
}
