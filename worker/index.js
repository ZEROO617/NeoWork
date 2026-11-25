import {handleRooms} from './rooms.js';
import {analyze,validateContext} from './ai.js';
import {readKey,writeKey} from './secrets.js';
// Replaced with embedded public assets by scripts/build.mjs.
const assets=__NEOWORK_ASSETS__;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const recent=new Map(); // Best-effort per-isolate burst control; not a billing limit.
export default {async fetch(request,env){
  const url=new URL(request.url);
  const shared=await handleRooms(request,env);if(shared)return shared;
  if(url.pathname==='/api/config'&&request.method==='GET'){try{return json({openai:!!(await readKey(env)),storage:env.DB?'shared':'browser'})}catch{return json({openai:false,storage:env.DB?'shared':'browser'})}}
  if(url.pathname==='/api/settings/openai'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    if(!request.headers.get('oai-authenticated-user-id'))return json({error:'authentication_required'},401);
    if(!env.SITE_OWNER_ID||request.headers.get('oai-authenticated-user-id')!==env.SITE_OWNER_ID)return json({error:'owner_required'},403);
    if(request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
    if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'json_required'},415);
    try{
      if(Number(request.headers.get('Content-Length')||0)>4096)return json({error:'request_too_large'},413);
      const reader=request.body?.getReader();if(!reader)return json({error:'invalid_key'},400);const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return json({error:'request_too_large'},413)}chunks.push(value)}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      const {key,consent}=JSON.parse(new TextDecoder().decode(bytes));
      if(consent!==true||typeof key!=='string'||!/^sk-[A-Za-z0-9_-]{16,1000}$/.test(key))return json({error:'invalid_key'},400);
      await writeKey(env,key);
      return json({saved:true});
    }catch{return json({error:'save_failed'},503)}
  }

  if(url.pathname==='/api/ai'||url.pathname==='/api/summary'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const identity=request.headers.get('oai-authenticated-user-id');
    if(!identity)return json({error:'authentication_required'},401);
    if(env.DB&&identity!==env.SITE_OWNER_ID)return json({error:'owner_required'},403);
    if(request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
    if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'json_required'},415);
    let apiKey;try{apiKey=await readKey(env)}catch{return json({error:'key_storage_unavailable',mode:'rules'},503)}
    if(!apiKey)return json({error:'openai_not_configured',mode:'rules'},503);
    const now=Date.now(),history=(recent.get(identity)||[]).filter(t=>now-t<60000);
    if(history.length>=10)return json({error:'rate_limited'},429);
    recent.set(identity,[...history,now]);
    if(recent.size>1000)for(const [id,ts] of recent)if(ts.at(-1)<now-60000)recent.delete(id);
    try{
      const limit=96000;let raw='';
      if(Number(request.headers.get('Content-Length')||0)>limit)return json({error:'request_too_large'},413);
      const reader=request.body?.getReader();if(!reader)return json({error:'invalid_context'},400);
      const decoder=new TextDecoder();let bytes=0;
      while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();return json({error:'request_too_large'},413)}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();
      const data=JSON.parse(raw);validateContext(data);
      const kind=url.pathname==='/api/summary'?'summary':'search';
      const result=await analyze(data,kind,apiKey,env.OPENAI_MODEL||'gpt-4.1-mini');
      return json({...result,provider:'openai'});
    }catch(error){
      if(['invalid_context','invalid_question'].includes(error.message)||error instanceof SyntaxError)return json({error:'invalid_request'},400);
      return json({error:error.message==='rate_limited'?'rate_limited':'ai_unavailable',mode:'rules'},error.message==='rate_limited'?429:502);
    }
  }
  if(url.pathname.startsWith('/api/'))return json({error:'not_found'},404);
  const asset=assets[url.pathname==='/'?'/index.html':url.pathname==='/settings'?'/settings.html':url.pathname];
  if(!asset||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
}};
