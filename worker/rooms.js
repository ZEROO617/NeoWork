import {repairTaskAssignees} from '../public/assignees.js';
import {analyze} from './ai.js';
import {readKey} from './secrets.js';
import {emptyDocument,manualChange,apiDocument,stageRefresh,isDirty} from '../public/document.js';
import {messages as sampleMessages} from '../public/data.js';
const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const fault=(code,status=400)=>Object.assign(new Error(code),{status});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const cookieName='__Host-neowork';
const initialized=new WeakMap();
async function initialize(db){
 if(!initialized.has(db))initialized.set(db,(async()=>{
  if(await db.prepare("SELECT id FROM chat_rooms WHERE id='demo'").first())return;
  const now=Date.now();await db.prepare('DELETE FROM chat_rate_limits WHERE key IN (SELECT key FROM chat_rate_limits WHERE expires_at<? LIMIT 500)').bind(now).run();await db.batch([
   db.prepare('INSERT OR IGNORE INTO chat_rooms(id,name,description,demo,created_at) VALUES(?,?,?,?,?)').bind('demo','시연용 예시 채팅방','예시 대화와 세 가지 결정사항으로 NeoWork를 체험해 보세요.',1,now),
   db.prepare('INSERT OR IGNORE INTO chat_rooms(id,name,description,demo,created_at) VALUES(?,?,?,?,?)').bind('team','우리 팀 채팅방','닉네임으로 입장하고 팀원들과 대화를 시작하세요.',0,now),
   ...sampleMessages.filter(m=>m.room==='project').map(m=>db.prepare('INSERT OR IGNORE INTO chat_messages(id,room_id,member_id,client_id,name,body,time) VALUES(?,?,?,?,?,?,?)').bind('demo-'+m.id,'demo',null,null,m.name,m.text,m.time)),
   ...['demo','team'].map(id=>db.prepare('INSERT OR IGNORE INTO chat_documents(room_id,body,revision) VALUES(?,?,0)').bind(id,JSON.stringify(emptyDocument())))
  ]);
 })().catch(error=>{initialized.delete(db);throw error}));return initialized.get(db);
}
async function readBody(request){
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw fault('origin_rejected',403);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw fault('json_required',415);
 const reader=request.body?.getReader();if(!reader)throw fault('invalid_request');const parts=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>96000){await reader.cancel();throw fault('request_too_large',413)}parts.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length}
 try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body}catch{throw fault('invalid_request')}
}
function name(value,max=20){if(typeof value!=='string')throw fault('invalid_name');const v=value.normalize('NFC').trim();if(!v||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw fault('invalid_name');return v}
async function throttle(db,key,limit,period=60000){
 const bucket=Math.floor(Date.now()/period),expires=(bucket+2)*period;
 const row=await db.prepare('INSERT INTO chat_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(key+':'+bucket,expires,limit).first();
 if(!row)throw fault('rate_limited',429);
}
async function session(request,db,create=false){
 const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(token&&/^[a-f0-9]{64}$/.test(token)){const row=await db.prepare('SELECT id FROM chat_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first();if(row)return {...row,cookie:null}}
 if(!create)throw fault('join_required',401);
 const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');await throttle(db,'session:'+ip,20);
 const random=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),age=30*86400;
 await db.prepare('INSERT INTO chat_sessions(id,token_hash,expires_at) VALUES(?,?,?)').bind(id,await hash(random),Date.now()+age*1000).run();
 return {id,cookie:cookieName+'='+random+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age};
}
async function roomById(db,id){const room=await db.prepare('SELECT * FROM chat_rooms WHERE id=?').bind(id).first();if(!room)throw fault('room_not_found',404);return room}
async function membership(request,db,room){const s=await session(request,db);const member=await db.prepare('SELECT id,name FROM chat_members WHERE room_id=? AND session_id=?').bind(room,s.id).first();if(!member)throw fault('join_required',401);return {...member,sessionId:s.id}}
const mapped=row=>({id:row.id,room:row.room_id,name:row.display_name??row.name,text:row.body,time:row.time,memberId:row.member_id,seq:row.seq});
async function joined(db,room,s,nickname,rename=false){
 const display=name(nickname),key=display.toLocaleLowerCase('ko-KR');const existing=await db.prepare('SELECT id,name FROM chat_members WHERE room_id=? AND session_id=?').bind(room,s.id).first();
 if(existing&&!rename)return {id:existing.id,name:existing.name};
 const collision=await db.prepare('SELECT id,session_id FROM chat_members WHERE room_id=? AND name_key=?').bind(room,key).first();if(collision&&collision.session_id!==s.id)throw fault('nickname_taken',409);
 const id=existing?.id||crypto.randomUUID();
 try{if(existing)await db.prepare('UPDATE chat_members SET name=?,name_key=? WHERE id=?').bind(display,key,id).run();else await db.prepare('INSERT INTO chat_members(id,room_id,session_id,name,name_key,created_at) VALUES(?,?,?,?,?,?)').bind(id,room,s.id,display,key,Date.now()).run()}catch{throw fault('nickname_taken',409)}
 return {id,name:display};
}
async function documentRow(db,room){const row=await db.prepare('SELECT body,revision,lock_token,lock_until FROM chat_documents WHERE room_id=?').bind(room).first();if(!row)throw fault('room_not_found',404);return {...row,document:repairTaskAssignees(JSON.parse(row.body))}}
const messageSelect='SELECT x.*, COALESCE((SELECT m.name FROM chat_members m WHERE m.id=x.member_id AND m.room_id=x.room_id),x.name) AS display_name FROM chat_messages x';
async function allMessages(db,room){return (await db.prepare(messageSelect+' WHERE x.room_id=? ORDER BY x.seq').bind(room).all()).results.map(mapped)}
async function storeDocument(db,room,doc,revision,token=null){
 const body=JSON.stringify(doc);if(new TextEncoder().encode(body).length>500000)throw fault('document_too_large',413);
 const result=token?await db.prepare('UPDATE chat_documents SET body=?,revision=revision+1,lock_token=NULL,lock_until=0 WHERE room_id=? AND revision=? AND lock_token=? RETURNING revision').bind(body,room,revision,token).first():await db.prepare('UPDATE chat_documents SET body=?,revision=revision+1 WHERE room_id=? AND revision=? AND lock_until<? RETURNING revision').bind(body,room,revision,Date.now()).first();
 if(!result)throw fault('document_conflict',409);return {document:doc,revision:result.revision};
}
async function sharedAI(request,env,data,kind){
 const db=env.DB,room=data.room;await roomById(db,room);const member=await membership(request,db,room);
 if(kind==='search'&&(typeof data.question!=='string'||!data.question.trim()||data.question.length>500))throw fault('invalid_question');
 const row=await documentRow(db,room),messages=await allMessages(db,room);
 if(kind==='summary'&&!isDirty(row.document,messages))return reply({document:row.document,revision:row.revision});
 const key=await readKey(env);if(!key)throw fault('openai_not_configured',503);
 await throttle(db,'ai:member:'+member.id,3);await throttle(db,'ai:global',100,86400000);
 if(kind==='search')return reply({...await analyze({room,user:member.name,messages:messages.slice(-80),offset:Math.max(0,messages.length-80),document:apiDocument(row.document),question:data.question},'search',key,env.OPENAI_MODEL||'gpt-4.1-mini'),provider:'openai'});
 const token=crypto.randomUUID();const locked=await db.prepare('UPDATE chat_documents SET lock_token=?,lock_until=? WHERE room_id=? AND revision=? AND lock_until<? RETURNING revision').bind(token,Date.now()+180000,room,row.revision,Date.now()).first();if(!locked)throw fault('summary_busy',423);
 try{const doc=await stageRefresh(row.document,messages,room,member.name,async payload=>{
  await db.prepare('UPDATE chat_documents SET lock_until=? WHERE room_id=? AND lock_token=?').bind(Date.now()+180000,room,token).run();
  return analyze(payload,'summary',key,env.OPENAI_MODEL||'gpt-4.1-mini');
 });return reply(await storeDocument(db,room,doc,row.revision,token))}
 finally{await db.prepare('UPDATE chat_documents SET lock_token=NULL,lock_until=0 WHERE room_id=? AND lock_token=?').bind(room,token).run()}
}
export async function handleRooms(request,env){
 const url=new URL(request.url),path=url.pathname,ai=['/api/summary','/api/ai'].includes(path),route=path==='/api/rooms'||path.startsWith('/api/rooms/');
 if(!route&&!ai)return null;if(!env.DB)return route?reply({error:'shared_storage_unavailable'},503):null;
 try{
  await initialize(env.DB);const db=env.DB;
  if(ai){if(request.method!=='POST')return null;const data=await readBody(request.clone());const exists=typeof data.room==='string'&&await db.prepare('SELECT id FROM chat_rooms WHERE id=?').bind(data.room).first();if(!exists)return null;return await sharedAI(request,env,data,path==='/api/summary'?'summary':'search')}
  if(path==='/api/rooms'&&request.method==='GET'){
   const rows=(await db.prepare('SELECT r.*, (SELECT COUNT(*) FROM chat_members m WHERE m.room_id=r.id) AS member_count, (SELECT COUNT(*) FROM chat_messages x WHERE x.room_id=r.id) AS message_count FROM chat_rooms r ORDER BY r.demo DESC,r.created_at DESC LIMIT 100').all()).results;
   const invited=url.searchParams.get('room');if(invited&&!rows.some(r=>r.id===invited)){const extra=await db.prepare('SELECT r.*, (SELECT COUNT(*) FROM chat_members m WHERE m.room_id=r.id) AS member_count, (SELECT COUNT(*) FROM chat_messages x WHERE x.room_id=r.id) AS message_count FROM chat_rooms r WHERE r.id=?').bind(invited).first();if(extra)rows.unshift(extra)}
   return reply({rooms:rows.map(r=>({id:r.id,name:r.name,description:r.description,demo:!!r.demo,memberCount:r.member_count,messageCount:r.message_count}))});
  }
  if(path==='/api/rooms'&&request.method==='POST'){
   const data=await readBody(request),s=await session(request,db,true);await throttle(db,'create:'+s.id,5,3600000);await throttle(db,'create-ip:'+await hash(request.headers.get('CF-Connecting-IP')||'local'),10,3600000);const title=name(data.name,40),nickname=name(data.nickname),description=typeof data.description==='string'?data.description.trim().slice(0,160):'',id=crypto.randomUUID();
   await db.batch([db.prepare('INSERT INTO chat_rooms(id,name,description,demo,created_at) VALUES(?,?,?,0,?)').bind(id,title,description,Date.now()),db.prepare('INSERT INTO chat_documents(room_id,body,revision) VALUES(?,?,0)').bind(id,JSON.stringify(emptyDocument()))]);
   const member=await joined(db,id,s,nickname);return reply({room:{id,name:title,description,demo:false},member},201,s.cookie?{'Set-Cookie':s.cookie}:{});
  }
  const match=path.match(/^\/api\/rooms\/([a-zA-Z0-9-]{1,100})\/(join|state|messages|document)$/);if(!match)return reply({error:'not_found'},404);const [,room,action]=match;const roomData=await roomById(db,room);
  if(action==='join'&&request.method==='POST'){
   const data=await readBody(request),s=await session(request,db,true);await throttle(db,'join:'+s.id,20);const member=await joined(db,room,s,data.nickname,data.rename===true),doc=await documentRow(db,room);return reply({room:{id:room,name:roomData.name,description:roomData.description,demo:!!roomData.demo},member,document:doc.document,revision:doc.revision},200,s.cookie?{'Set-Cookie':s.cookie}:{});
  }
  const member=await membership(request,db,room);
  if(action==='state'&&request.method==='GET'){
   const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw fault('invalid_cursor');
   const snapshot=await db.batch([
    db.prepare(messageSelect+' WHERE x.room_id=? AND x.seq>? ORDER BY x.seq LIMIT 201').bind(room,after),
    db.prepare('SELECT id,name FROM chat_members WHERE room_id=? ORDER BY created_at LIMIT 1000').bind(room),
    db.prepare('SELECT body,revision,lock_until FROM chat_documents WHERE room_id=?').bind(room)
   ]);
   const rows=snapshot[0].results,more=rows.length>200,messages=rows.slice(0,200).map(mapped),members=snapshot[1].results,row=snapshot[2].results[0],doc={...row,document:repairTaskAssignees(JSON.parse(row.body))};
   return reply({room:{id:room,name:roomData.name,description:roomData.description,demo:!!roomData.demo},member:{id:member.id,name:member.name},members,messages,hasMore:more,cursor:messages.at(-1)?.seq||after,document:doc.document,revision:doc.revision,summaryBusy:doc.lock_until>Date.now()});
  }
  if(action==='messages'&&request.method==='POST'){
   const data=await readBody(request);if(typeof data.text!=='string'||!data.text.trim()||data.text.length>4000||typeof data.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(data.clientId))throw fault('invalid_message');
   if(/^\/리셋(?:\s|$)/u.test(data.text.trim())){
    await throttle(db,'reset:'+member.sessionId,5,600000);
    if(!env.ROOM_RESET_PASSWORD)throw fault('reset_not_configured',503);
    const supplied=data.text.trim().match(/^\/리셋\s+(\S+)$/u)?.[1];
    if(!supplied||await hash(supplied)!==await hash(env.ROOM_RESET_PASSWORD))throw fault('reset_password_invalid',403);
    const document={...emptyDocument(),resetId:crypto.randomUUID()};
    const results=await db.batch([
     db.prepare('UPDATE chat_documents SET body=?,revision=revision+1,lock_token=NULL,lock_until=0 WHERE room_id=? RETURNING revision').bind(JSON.stringify(document),room),
     db.prepare('DELETE FROM chat_messages WHERE room_id=?').bind(room)
    ]);
    return reply({reset:true,document,revision:results[0].results[0].revision});
   }
   const prior=await db.prepare(messageSelect+' WHERE x.room_id=? AND x.member_id=? AND x.client_id=?').bind(room,member.id,data.clientId).first();if(prior)return reply({message:mapped(prior)});
   await throttle(db,'message:'+member.id,30);
   await db.prepare('INSERT OR IGNORE INTO chat_messages(id,room_id,member_id,client_id,name,body,time) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),room,member.id,data.clientId,member.name,data.text.trim(),new Date().toISOString()).run();
   const message=await db.prepare(messageSelect+' WHERE x.room_id=? AND x.member_id=? AND x.client_id=?').bind(room,member.id,data.clientId).first();return reply({message:mapped(message)},201);
  }
  if(action==='document'&&request.method==='POST'){
   const data=await readBody(request);await throttle(db,'document:'+member.id,30);if(!Number.isInteger(data.revision))throw fault('invalid_revision');const row=await documentRow(db,room);if(row.revision!==data.revision)throw fault('document_conflict',409);if(row.lock_until>Date.now())throw fault('summary_busy',423);
   if(!['topics','decisions','tasks'].includes(data.section)||data.id!=null&&!row.document[data.section].some(x=>x.id===data.id))throw fault('invalid_item');
   const doc=manualChange(row.document,data.section,data.id,data.fields||{},await allMessages(db,room),member.name,data.remove===true);return reply(await storeDocument(db,room,doc,row.revision));
  }
  return reply({error:'method_not_allowed'},405);
 }catch(error){const status=error.status||(['invalid_text','invalid_status','invalid_section','missing_item','invalid_context','invalid_question'].includes(error.message)?400:502);const safe=error.status||status===400?error.message:error.message==='rate_limited'?'rate_limited':'chat_unavailable';console.error(JSON.stringify({event:'chat_request_failed',status,code:safe}));return reply({error:safe},status)}
}
