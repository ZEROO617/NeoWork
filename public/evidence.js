// Chat-evidence navigation is local UI state; it never changes stored documents.
export function evidenceIds(ids,messages){
 const positions=new Map(messages.map((m,i)=>[m.id,{message:m,index:i}]));
 return [...new Set((ids||[]).filter(id=>typeof id==='string'&&positions.has(id)))].sort((a,b)=>{
  const left=positions.get(a),right=positions.get(b),difference=Date.parse(left.message.time)-Date.parse(right.message.time);
  return Number.isFinite(difference)&&difference!==0?difference:left.index-right.index;
 });
}
export function startEvidenceState(ids,messages,origin){const resolved=evidenceIds(ids,messages);return resolved.length?{ids:resolved,index:0,origin:{...origin}}:null}
export function moveEvidenceState(state,step){if(!state)return null;return {...state,index:Math.max(0,Math.min(state.ids.length-1,state.index+step))}}
export function reconcileEvidenceState(state,messages){
 if(!state)return null;const current=state.ids[state.index],ids=evidenceIds(state.ids,messages);if(!ids.length)return null;
 const index=ids.indexOf(current);return {...state,ids,index:index<0?Math.min(state.index,ids.length-1):index};
}
