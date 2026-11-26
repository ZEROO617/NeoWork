import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,DEFAULT_BACKEND} from '../api/proxy.js';
const token='test-backend-token';
const guest='a'.repeat(64);
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},end(v){this.body=JSON.parse(v)}}}
async function invoke(overrides={},fetcher=async()=>Response.json({ok:true}),env={NEOWORK_BACKEND_TOKEN:token}){
 const req={method:'GET',query:{route:'rooms'},headers:{host:'neowork.vercel.app'},...overrides};const res=response();await createGateway(env,fetcher)(req,res);return res;
}
test('gateway sends only service auth and valid guest cookie; preserves pagination',async()=>{
 let call;const res=await invoke({query:{route:'rooms/demo/state',after:'12',room:'demo',extra:'discard'},headers:{host:'neowork.vercel.app',cookie:`other=secret; __Host-neowork=${guest}`,authorization:'forged','x-oai-user-id':'owner'}},async(url,options)=>{call={url,options};return Response.json({messages:[]})});
 assert.equal(res.statusCode,200);assert.equal(call.url,DEFAULT_BACKEND+'/api/rooms/demo/state?after=12&room=demo');assert.deepEqual(call.options.headers,{'OAI-Sites-Authorization':'Bearer '+token,Cookie:'__Host-neowork='+guest});assert.equal(call.options.redirect,'error');assert.ok(!JSON.stringify(res).includes(token));
});
test('gateway rejects admin paths, unsupported methods and untrusted writes without fetch',async()=>{
 let calls=0;const never=async()=>{calls++;throw Error()};
 for(const [overrides,status] of [[{query:{route:'settings'}},404],[{method:'DELETE'},405],[{method:'POST',headers:{host:'neowork.vercel.app',origin:'https://evil.example','content-type':'application/json'},body:{}},403],[{method:'POST',headers:{host:'neowork.vercel.app',origin:'https://neowork.vercel.app','content-type':'text/plain'},body:{}},415]])assert.equal((await invoke(overrides,never)).statusCode,status);
 assert.equal(calls,0);
});
test('gateway rewrites approved JSON write origin and relays only guest session cookie',async()=>{
 const res=await invoke({method:'POST',query:{route:'rooms/demo/join'},headers:{host:'neowork.vercel.app',origin:'https://neowork.vercel.app','content-type':'application/json'},body:{nickname:'테스터'}},async(url,options)=>{
 assert.equal(options.headers.Origin,DEFAULT_BACKEND);assert.deepEqual(JSON.parse(options.body),{nickname:'테스터'});
 return Response.json({member:{name:'테스터'}},{headers:{'set-cookie':`__Host-neowork=${guest}; Path=/; HttpOnly; Secure; SameSite=Lax`}});
 });assert.equal(res.statusCode,200);assert.equal(res.headers['Set-Cookie'].length,1);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('gateway bounds payload and validates backend configuration',async()=>{
 const write={method:'POST',headers:{host:'neowork.vercel.app',origin:'https://neowork.vercel.app','content-type':'application/json'}};
 assert.equal((await invoke({...write,body:{text:'x'.repeat(96001)}})).statusCode,413);
 assert.equal((await invoke({...write,body:'bad json'})).statusCode,400);
 assert.equal((await invoke({},undefined,{})).statusCode,503);
 assert.equal((await invoke({},undefined,{NEOWORK_BACKEND_TOKEN:token,NEOWORK_API_ORIGIN:'http://unsafe.example'})).statusCode,503);
});
test('gateway does not forward sign-in pages or transport errors',async()=>{
 for(const fetcher of [async()=>new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}}),async()=>{throw Error('sensitive diagnostic')}]){
 const res=await invoke({},fetcher);assert.equal(res.statusCode,502);assert.deepEqual(res.body,{error:'backend_unavailable'});
 }
});
