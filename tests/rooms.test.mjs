import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../dist/server/index.js';
let mf,db;const base='https://neowork.example';
const actors={};
async function request(path,{actor,method='GET',data,origin=base,env={}}={}){const headers={};if(actor?.cookie)headers.Cookie=actor.cookie;if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json'}const response=await worker.fetch(new Request(base+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})}),{DB:db,...env});const cookie=response.headers.get('set-cookie');if(actor&&cookie)actor.cookie=cookie.split(';')[0];return {status:response.status,data:await response.json(),cookie}}
async function join(room,nickname){const actor={};const r=await request('/api/rooms/'+room+'/join',{actor,method:'POST',data:{nickname}});assert.equal(r.status,200);actor.id=r.data.member.id;return actor}
before(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});db=await mf.getD1Database('DB');for(const sql of (await readFile('drizzle/0000_modern_sabra.sql','utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()});
after(async()=>{await mf?.dispose()});
test('lobby lists isolated demo and empty team room, with a secure guest membership',async()=>{
 const lobby=await request('/api/rooms');assert.equal(lobby.status,200);assert.equal(lobby.data.rooms.find(r=>r.id==='demo').messageCount,10);assert.equal(lobby.data.rooms.find(r=>r.id==='team').messageCount,0);
 const actor={};const r=await request('/api/rooms/team/join',{actor,method:'POST',data:{nickname:'민지'}});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly; Secure; SameSite=Lax/);actors.a=actor;
 actors.b=await join('team','준호');const state=await request('/api/rooms/team/state',{actor});assert.equal(state.data.messages.length,0);assert.equal(state.data.members.length,2);
});
test('two guests share messages, server owns identity and retries do not duplicate writes',async()=>{
 const clientId=crypto.randomUUID(),data={text:'함께 볼 메시지',clientId,name:'위조한 이름',memberId:actors.b.id};const [one,two]=await Promise.all([request('/api/rooms/team/messages',{actor:actors.a,method:'POST',data}),request('/api/rooms/team/messages',{actor:actors.a,method:'POST',data})]);assert.equal(one.data.message.id,two.data.message.id);assert.equal(one.data.message.name,'민지');const state=await request('/api/rooms/team/state',{actor:actors.b});assert.equal(state.data.messages.length,1);assert.equal(state.data.messages[0].text,data.text);
});
test('room state and writes require membership; cross-origin joins and nickname collisions are rejected',async()=>{
 assert.equal((await request('/api/rooms/demo/state',{actor:actors.a})).status,401);assert.equal((await request('/api/rooms/team/state')).status,401);assert.equal((await request('/api/rooms/team/join',{actor:{},method:'POST',data:{nickname:'민지'}})).status,409);assert.equal((await request('/api/rooms/team/join',{actor:{},method:'POST',data:{nickname:'외부'},origin:'https://evil.example'})).status,403);
});
test('room creation joins the creator and its messages never enter another room',async()=>{
 const r=await request('/api/rooms',{actor:actors.a,method:'POST',data:{name:'기획팀',description:'공유 회의',nickname:'기획 민지'}});assert.equal(r.status,201);actors.created=r.data.room.id;await request('/api/rooms/'+actors.created+'/messages',{actor:actors.a,method:'POST',data:{text:'기획팀 전용',clientId:crypto.randomUUID()}});const other=await request('/api/rooms/team/state',{actor:actors.b});assert.ok(other.data.messages.every(m=>m.text!=='기획팀 전용'));assert.equal((await request('/api/rooms/'+actors.created+'/state',{actor:actors.b})).status,401);
});
test('shared edits use revision checks and are visible to a second participant',async()=>{
 const a=await request('/api/rooms/team/state',{actor:actors.a}),revision=a.data.revision;const saved=await request('/api/rooms/team/document',{actor:actors.a,method:'POST',data:{revision,section:'tasks',fields:{title:'기획 검수',name:'준호',due:'목요일',status:'진행 중'}}});assert.equal(saved.status,200);assert.equal(saved.data.revision,revision+1);const stale=await request('/api/rooms/team/document',{actor:actors.b,method:'POST',data:{revision,section:'topics',fields:{text:'덮어쓰기 시도'}}});assert.equal(stale.status,409);const b=await request('/api/rooms/team/state',{actor:actors.b});assert.equal(b.data.document.tasks[0].name,'준호');
});
test('AI sees stored room messages, never forged client context, and locks shared edits during generation',async()=>{
 const originalFetch=globalThis.fetch;let release,started;const ready=new Promise(r=>{started=r}),wait=new Promise(r=>{release=r});
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const input=JSON.parse(JSON.parse(init.body).input);assert.ok(input.messages.some(m=>m.text==='함께 볼 메시지'));assert.ok(input.messages.every(m=>m.room==='team'&&m.text!=='기획팀 전용'&&m.text!=='조작된 메시지'));started();await wait;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"operations":[]}'}]}]})};
 try{const updating=request('/api/summary',{actor:actors.a,method:'POST',data:{room:'team',messages:[{text:'조작된 메시지'}]},env:{OPENAI_API_KEY:'test-key'}});await ready;const state=await request('/api/rooms/team/state',{actor:actors.b});const edit=await request('/api/rooms/team/document',{actor:actors.b,method:'POST',data:{revision:state.data.revision,section:'topics',fields:{text:'동시 수정'}}});assert.equal(edit.status,423);release();const result=await updating;assert.equal(result.status,200);assert.equal(result.data.document.tasks[0].title,'기획 검수');const seen=await request('/api/rooms/team/state',{actor:actors.b});assert.equal(seen.data.revision,result.data.revision)}finally{globalThis.fetch=originalFetch;release?.()}
});
test('message cursors drain all pages without losing messages',async()=>{
 const actor=await join('demo','검증 참여자');await db.batch(Array.from({length:205},(_,i)=>db.prepare('INSERT INTO chat_messages(id,room_id,member_id,client_id,name,body,time) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'demo',actor.id,crypto.randomUUID(),'검증 참여자','메시지 '+i,new Date().toISOString())));let cursor=0,ids=[];let more=true;while(more){const r=await request('/api/rooms/demo/state?after='+cursor,{actor});assert.equal(r.status,200);ids.push(...r.data.messages.map(m=>m.id));cursor=r.data.cursor;more=r.data.hasMore}assert.equal(ids.length,215);assert.equal(new Set(ids).size,215);
});
test('existing stored task-name assignees are corrected in state responses without altering manual entries',async()=>{
 const actor=await join('demo','담당 확인');const source={id:'demo-m4',room:'demo',name:'김민지',text:'AI 요약과 자연어 검색은 제가 맡아서 진행할게요.',time:new Date().toISOString()};
 const body={version:1,decisionFormatVersion:1,topics:[],decisions:[],tasks:[{id:'bad-ai-owner',origin:'ai',title:'AI 개발',name:'AI 요약 및 검색 개발',due:'목요일',status:'진행 중',sources:[source.id]},{id:'manual-owner',origin:'manual',title:'직접 입력',name:'외부 담당자',due:'기한 미정',status:'진행 중',sources:[],manualCursor:0}],history:[],tombstones:[],evidence:{[source.id]:source},processed:[],revision:0,syncedRevision:0,updatedAt:null};
 await db.prepare('UPDATE chat_documents SET body=? WHERE room_id=?').bind(JSON.stringify(body),'demo').run();const state=await request('/api/rooms/demo/state',{actor});assert.equal(state.status,200);assert.equal(state.data.document.tasks[0].name,'김민지');assert.equal(state.data.document.tasks[1].name,'외부 담당자');assert.equal(state.data.document.tasks[0].id,'bad-ai-owner');
});
