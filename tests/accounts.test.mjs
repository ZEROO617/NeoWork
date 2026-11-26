import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import worker from '../dist/server/index.js';
const base='https://neowork.example',password='test-account-password-123';let mf,db;
async function request(path,actor={},data,origin=base){const headers={};if(actor.cookie)headers.Cookie=actor.cookie;if(data){headers.Origin=origin;headers['Content-Type']='application/json'}const response=await worker.fetch(new Request(base+path,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{})}),{DB:db,ADMIN_PASSWORD:'adm1n'});const cookie=response.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];return {status:response.status,data:await response.json(),cookie}}
async function register(nickname){const actor={};const r=await request('/api/auth/register',actor,{nickname,password});assert.equal(r.status,201);actor.account=r.data.account;return actor}
before(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});db=await mf.getD1Database('DB');for(const file of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run()});
after(async()=>{await mf?.dispose()});
test('registration hashes passwords with unique salts and reserves normalized nicknames globally',async()=>{
 const a=await register('AccountOne'),b=await register('AccountTwo');const rows=(await db.prepare('SELECT * FROM chat_accounts').all()).results;assert.notEqual(rows[0].password_salt,rows[1].password_salt);assert.notEqual(rows[0].password_hash,rows[1].password_hash);assert.ok(rows.every(r=>r.password_hash.length===64&&!JSON.stringify(r).includes(password)));
 assert.equal((await request('/api/auth/register',{}, {nickname:'accountone',password})).status,409);assert.equal((await request('/api/auth/register',{}, {nickname:'짧은 비번',password:'123'})).status,400);
 const me=await request('/api/auth/me',a);assert.deepEqual(me.data.account,a.account);assert.ok(!JSON.stringify(me.data).includes('password'));
 const stolen=await request('/api/auth/rename',b,{nickname:'AccountOne'});assert.equal(stolen.status,409);assert.equal((await request('/api/auth/me',b)).data.account.name,'AccountTwo');
});
test('login on another device restores the same room member and historical author; logout revokes only its session',async()=>{
 const a=await register('재접속 계정');const first=await request('/api/rooms/team/join',a,{nickname:'위조 닉네임'});assert.equal(first.data.member.name,'재접속 계정');
 const message=await request('/api/rooms/team/messages',a,{text:'같은 계정의 메시지',clientId:crypto.randomUUID()});assert.equal(message.status,201);
 const b={};const login=await request('/api/auth/login',b,{nickname:'재접속 계정',password});assert.equal(login.status,200);assert.notEqual(b.cookie,a.cookie);assert.match(login.cookie,/HttpOnly; Secure; SameSite=Lax/);
 const again=await request('/api/rooms/team/join',b,{nickname:'다른 이름'});assert.equal(again.data.member.id,first.data.member.id);assert.equal((await request('/api/rooms/team/state',b)).data.messages[0].memberId,again.data.member.id);
 const renamed=await request('/api/auth/rename',b,{nickname:'계정 이름 변경'});assert.equal(renamed.status,200);assert.equal((await request('/api/rooms/team/state',a)).data.messages[0].name,'계정 이름 변경');
 const c={};assert.equal((await request('/api/auth/login',c,{nickname:'재접속 계정',password})).status,401);assert.equal((await request('/api/auth/login',c,{nickname:'계정 이름 변경',password})).status,200);
 const oldCookie=b.cookie;assert.equal((await request('/api/auth/logout',b,{})).status,200);assert.equal((await request('/api/auth/me',{cookie:oldCookie})).data.account,null);assert.equal((await request('/api/rooms/team/state',a)).status,200);
});
test('anonymous access, expired cookies, wrong credentials, cross-origin auth and renames are rejected',async()=>{
 assert.equal((await request('/api/rooms')).status,401);assert.equal((await request('/api/rooms/team/join',{}, {nickname:'사칭'})).status,401);
 assert.equal((await request('/api/auth/login',{}, {nickname:'AccountOne',password:'incorrect-password'})).status,401);assert.equal((await request('/api/auth/login',{}, {nickname:'unknown-user',password})).status,401);
 assert.equal((await request('/api/auth/register',{}, {nickname:'외부 가입',password},'https://evil.example')).status,403);assert.equal((await request('/api/auth/rename',{}, {nickname:'외부 변경'})).status,401);
 const a=await register('만료 계정');await db.prepare('UPDATE chat_account_sessions SET expires_at=0 WHERE account_id=?').bind(a.account.id).run();assert.equal((await request('/api/auth/me',a)).data.account,null);
});
test('only possession of an old anonymous cookie can link pre-account message ownership',async()=>{
 const token='c'.repeat(64),principal=crypto.randomUUID();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 await db.prepare('INSERT INTO chat_sessions(id,token_hash,expires_at) VALUES(?,?,?)').bind(principal,digest,Date.now()+86400000).run();const member=crypto.randomUUID();await db.prepare('INSERT INTO chat_members(id,room_id,session_id,name,name_key,created_at) VALUES(?,?,?,?,?,?)').bind(member,'team',principal,'이전 참여자','이전 참여자',Date.now()).run();await db.prepare('INSERT INTO chat_messages(id,room_id,member_id,name,body,time) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),'team',member,'이전 참여자','기존 대화',new Date().toISOString()).run();
 const outsider=await register('이전 참여자');const outsiderJoin=await request('/api/rooms/team/join',outsider,{});assert.notEqual(outsiderJoin.data.member.id,member);
 const a={cookie:'__Host-neowork='+token};assert.equal((await request('/api/auth/register',a,{nickname:'기존 기록 복원',password})).status,201);const join=await request('/api/rooms/team/join',a,{});assert.equal(join.data.member.id,member);
 const b={};assert.equal((await request('/api/auth/login',b,{nickname:'기존 기록 복원',password})).status,200);assert.equal((await request('/api/rooms/team/join',b,{})).data.member.id,member);
});

test('admin login is reserved, listing is role-protected, and deletion revokes sessions and frees the nickname',async()=>{
 const user=await register('관리자 삭제 검사'),otherDevice={};assert.equal((await request('/api/auth/login',otherDevice,{nickname:'관리자 삭제 검사',password})).status,200);const original=await request('/api/rooms/team/join',user,{});await request('/api/rooms/team/messages',user,{text:'탈퇴 전 기록',clientId:crypto.randomUUID()});
 assert.equal((await request('/api/admin/users',user)).status,403);assert.equal((await request('/api/admin/delete',user,{accountId:user.account.id})).status,403);assert.equal((await request('/api/auth/register',{}, {nickname:'ADMIN',password})).status,409);
 const admin={};assert.equal((await request('/api/auth/login',admin,{nickname:'admin',password:'wrong'})).status,401);const logged=await request('/api/auth/login',admin,{nickname:'admin',password:'adm1n'});assert.equal(logged.status,200);assert.equal(logged.data.account.role,'admin');
 let listed=await request('/api/admin/users',admin);assert.equal(listed.status,200);assert.equal(listed.data.users.find(x=>x.id===user.account.id).activeSessions,2);assert.ok(!JSON.stringify(listed.data).includes('password_hash'));
 assert.equal((await request('/api/admin/delete',admin,{accountId:logged.data.account.id})).status,403);assert.equal((await request('/api/admin/delete',admin,{accountId:user.account.id},'https://evil.example')).status,403);
 const deleted=await request('/api/admin/delete',admin,{accountId:user.account.id});assert.equal(deleted.status,200);assert.equal((await request('/api/auth/me',user)).data.account,null);assert.equal((await request('/api/auth/me',otherDevice)).data.account,null);
 listed=await request('/api/admin/users',admin);assert.ok(!listed.data.users.some(x=>x.id===user.account.id));
 const replacement=await register('관리자 삭제 검사');const newJoin=await request('/api/rooms/team/join',replacement,{});assert.notEqual(newJoin.data.member.id,original.data.member.id);const state=await request('/api/rooms/team/state',replacement);assert.ok(state.data.messages.some(x=>x.text==='탈퇴 전 기록'&&x.name==='관리자 삭제 검사 (탈퇴)'));
 assert.equal((await request('/api/auth/login',{}, {nickname:'관리자 삭제 검사',password:'incorrect-password'})).status,401);
});
