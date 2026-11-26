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
const tokenFrom=request=>request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
const randomHex=size=>Array.from(crypto.getRandomValues(new Uint8Array(size))).map(x=>x.toString(16).padStart(2,'0')).join('');
const sessionCookie=token=>cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
const publicAccount=a=>({id:a.id,name:a.name});
async function findAccount(request,db){
 const token=tokenFrom(request);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 return db.prepare('SELECT a.id,a.name,a.session_id,s.id AS auth_session_id FROM chat_account_sessions s JOIN chat_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),Date.now()).first();
}
async function session(request,db){const account=await findAccount(request,db);if(!account)throw fault('authentication_required',401);return {id:account.session_id,account,authSessionId:account.auth_session_id,cookie:null}}
async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/../g),x=>parseInt(x,16)),iterations:100000,hash:'SHA-256'},key,256);
 return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equalHash(a,b){let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0}
async function availableName(db,key,principal,accountId=''){
 if(await db.prepare('SELECT id FROM chat_accounts WHERE name_key=? AND id<>?').bind(key,accountId).first())throw fault('nickname_taken',409);
 if(await db.prepare('SELECT id FROM chat_members WHERE name_key=? AND session_id<>? LIMIT 1').bind(key,principal).first())throw fault('nickname_taken',409);
}
async function renameAccount(db,account,nickname){
 const display=name(nickname),key=display.toLocaleLowerCase('ko-KR');await availableName(db,key,account.session_id,account.id);
 try{await db.batch([
  db.prepare('UPDATE chat_accounts SET name=?,name_key=? WHERE id=?').bind(display,key,account.id),
  db.prepare('UPDATE chat_members SET name=?,name_key=? WHERE session_id=?').bind(display,key,account.session_id)
 ])}catch(error){if(/unique|constraint/i.test(error.message))throw fault('nickname_taken',409);throw error}
 return {...account,name:display};
}
async function handleAccount(request,db,action){
 if(action==='me'&&request.method==='GET'){const account=await findAccount(request,db);return reply({account:account?publicAccount(account):null})}
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 const data=await readBody(request),ip=await hash(request.headers.get('CF-Connecting-IP')||'local');
 if(action==='logout'){
  const account=await findAccount(request,db);if(account)await db.prepare('DELETE FROM chat_account_sessions WHERE id=?').bind(account.auth_session_id).run();
  return reply({ok:true},200,{'Set-Cookie':cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
 }
 if(action==='rename'){const s=await session(request,db);await throttle(db,'rename:'+s.account.id,10,600000);return reply({account:publicAccount(await renameAccount(db,s.account,data.nickname))})}
 if(!['register','login'].includes(action))return reply({error:'not_found'},404);
 await throttle(db,'auth-ip:'+ip,60,600000);
 const display=name(data.nickname),key=display.toLocaleLowerCase('ko-KR');
 if(typeof data.password!=='string'||data.password.length<8||data.password.length>128)throw fault(action==='login'?'invalid_credentials':'invalid_password',action==='login'?401:400);
 await throttle(db,'auth-name:'+await hash(key),20,600000);
 const token=randomHex(32),authId=crypto.randomUUID(),expires=Date.now()+30*86400000;
 if(action==='login'){
  const account=await db.prepare('SELECT * FROM chat_accounts WHERE name_key=?').bind(key).first();
  const supplied=await passwordHash(data.password,account?.password_salt||'0'.repeat(32));
  if(!account||!equalHash(supplied,account.password_hash))throw fault('invalid_credentials',401);
  await db.prepare('INSERT INTO chat_account_sessions(id,account_id,token_hash,expires_at) VALUES(?,?,?,?)').bind(authId,account.id,await hash(token),expires).run();
  return reply({account:publicAccount(account)},200,{'Set-Cookie':sessionCookie(token)});
 }
 if(await findAccount(request,db))throw fault('already_authenticated',409);
 await throttle(db,'register-ip:'+ip,20,3600000);
 // A browser's existing anonymous membership can be claimed only with its old
 // unguessable cookie. Matching a nickname never claims another person's history.
 const oldToken=tokenFrom(request);let legacy=null;
 if(oldToken&&/^[a-f0-9]{64}$/.test(oldToken))legacy=await db.prepare('SELECT s.id FROM chat_sessions s WHERE s.token_hash=? AND s.expires_at>? AND NOT EXISTS (SELECT 1 FROM chat_accounts a WHERE a.session_id=s.id)').bind(await hash(oldToken),Date.now()).first();
 const principal=legacy?.id||crypto.randomUUID(),id=crypto.randomUUID(),salt=randomHex(16);await availableName(db,key,principal);
 const digest=await passwordHash(data.password,salt),statements=[];
 if(!legacy)statements.push(db.prepare('INSERT INTO chat_sessions(id,token_hash,expires_at) VALUES(?,?,?)').bind(principal,await hash(randomHex(32)),expires));
 statements.push(db.prepare('INSERT INTO chat_accounts(id,session_id,name,name_key,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,principal,display,key,salt,digest,Date.now()),db.prepare('INSERT INTO chat_account_sessions(id,account_id,token_hash,expires_at) VALUES(?,?,?,?)').bind(authId,id,await hash(token),expires),db.prepare('UPDATE chat_members SET name=?,name_key=? WHERE session_id=?').bind(display,key,principal));
 try{await db.batch(statements)}catch(error){if(/unique|constraint/i.test(error.message))throw fault('nickname_taken',409);throw error}
 return reply({account:{id,name:display}},201,{'Set-Cookie':sessionCookie(token)});
}
async function roomById(db,id){const room=await db.prepare('SELECT * FROM chat_rooms WHERE id=?').bind(id).first();if(!room)throw fault('room_not_found',404);return room}
async function membership(request,db,room){const s=await session(request,db);const member=await db.prepare('SELECT id,name FROM chat_members WHERE room_id=? AND session_id=?').bind(room,s.id).first();if(!member)throw fault('join_required',401);return {...member,sessionId:s.id}}
const mapped=row=>({id:row.id,room:row.room_id,name:row.display_name??row.name,text:row.body,time:row.time,memberId:row.member_id,seq:row.seq});
async function joined(db,room,s,nickname,rename=false){
 const account=rename?await renameAccount(db,s.account,nickname):s.account;
 const display=account.name,key=display.toLocaleLowerCase('ko-KR');
 const existing=await db.prepare('SELECT id,name FROM chat_members WHERE room_id=? AND session_id=?').bind(room,s.id).first();
 if(existing)return {id:existing.id,name:display};
 const id=crypto.randomUUID();
 try{await db.prepare('INSERT INTO chat_members(id,room_id,session_id,name,name_key,created_at) VALUES(?,?,?,?,?,?)').bind(id,room,s.id,display,key,Date.now()).run()}catch(error){
  const concurrent=await db.prepare('SELECT id,name FROM chat_members WHERE room_id=? AND session_id=?').bind(room,s.id).first();if(concurrent)return concurrent;
  if(/unique|constraint/i.test(error.message))throw fault('nickname_taken',409);throw error;
 }
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
 const url=new URL(request.url),path=url.pathname,auth=path.match(/^\/api\/auth\/(me|register|login|logout|rename)$/),ai=['/api/summary','/api/ai'].includes(path),route=path==='/api/rooms'||path.startsWith('/api/rooms/');
 if(!route&&!ai&&!auth)return null;if(!env.DB)return route?reply({error:'shared_storage_unavailable'},503):null;
 try{
  await initialize(env.DB);const db=env.DB;if(auth)return await handleAccount(request,db,auth[1]);await session(request,db);
  if(ai){if(request.method!=='POST')return null;const data=await readBody(request.clone());const exists=typeof data.room==='string'&&await db.prepare('SELECT id FROM chat_rooms WHERE id=?').bind(data.room).first();if(!exists)return null;return await sharedAI(request,env,data,path==='/api/summary'?'summary':'search')}
  if(path==='/api/rooms'&&request.method==='GET'){
   const rows=(await db.prepare('SELECT r.*, (SELECT COUNT(*) FROM chat_members m WHERE m.room_id=r.id) AS member_count, (SELECT COUNT(*) FROM chat_messages x WHERE x.room_id=r.id) AS message_count FROM chat_rooms r ORDER BY r.demo DESC,r.created_at DESC LIMIT 100').all()).results;
   const invited=url.searchParams.get('room');if(invited&&!rows.some(r=>r.id===invited)){const extra=await db.prepare('SELECT r.*, (SELECT COUNT(*) FROM chat_members m WHERE m.room_id=r.id) AS member_count, (SELECT COUNT(*) FROM chat_messages x WHERE x.room_id=r.id) AS message_count FROM chat_rooms r WHERE r.id=?').bind(invited).first();if(extra)rows.unshift(extra)}
   return reply({rooms:rows.map(r=>({id:r.id,name:r.name,description:r.description,demo:!!r.demo,memberCount:r.member_count,messageCount:r.message_count}))});
  }
  if(path==='/api/rooms'&&request.method==='POST'){
   const data=await readBody(request),s=await session(request,db,true);await throttle(db,'create:'+s.id,5,3600000);await throttle(db,'create-ip:'+await hash(request.headers.get('CF-Connecting-IP')||'local'),10,3600000);const title=name(data.name,40),nickname=s.account.name,description=typeof data.description==='string'?data.description.trim().slice(0,160):'',id=crypto.randomUUID();
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
