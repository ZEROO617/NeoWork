// Vercel's same-origin API gateway. The existing Worker remains the authoritative
// data/AI service, preserving D1 data and server-only OpenAI credentials.
export const DEFAULT_BACKEND='https://neowork-team-space.gthunder0601.chatgpt.site';
const COOKIE='__Host-neowork';
const allowed=/^(?:config|summary|ai|rooms(?:\/[a-zA-Z0-9-]{1,100}\/(?:join|state|messages|document))?)$/;
const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
export function createGateway(env=process.env,fetcher=fetch){return async function handler(req,res){
 const route=req.query?.route;
 if(typeof route!=='string'||!allowed.test(route))return json(res,404,{error:'not_found'});
 if(!['GET','POST'].includes(req.method))return json(res,405,{error:'method_not_allowed'});
 const host=req.headers.host;if(typeof host!=='string'||!host)return json(res,400,{error:'invalid_host'});
 const protocol=host.startsWith('localhost:')||host.startsWith('127.0.0.1:')?'http':'https';
 if(req.method==='POST'){
  if(req.headers.origin!==protocol+'://'+host)return json(res,403,{error:'origin_rejected'});
  if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'json_required'});
 }
 if(!env.NEOWORK_BACKEND_TOKEN)return json(res,503,{error:'backend_not_configured'});
 let backend;try{backend=new URL(env.NEOWORK_API_ORIGIN||DEFAULT_BACKEND);if(backend.protocol!=='https:'||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw Error()}catch{return json(res,503,{error:'backend_not_configured'})}
 let body;if(req.method==='POST'){
  if(Number(req.headers['content-length']||0)>96000)return json(res,413,{error:'request_too_large'});
  try{const value=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!value||typeof value!=='object'||Array.isArray(value))throw Error();body=JSON.stringify(value);if(Buffer.byteLength(body)>96000)return json(res,413,{error:'request_too_large'})}catch{return json(res,400,{error:'invalid_request'})}
 }
 const url=new URL('/api/'+route,backend.origin);
 for(const key of ['after','room'])if(typeof req.query[key]==='string')url.searchParams.set(key,req.query[key]);
 const headers={'OAI-Sites-Authorization':'Bearer '+env.NEOWORK_BACKEND_TOKEN};
 if(body){headers['Content-Type']='application/json';headers.Origin=backend.origin}
 const cookie=typeof req.headers.cookie==='string'?req.headers.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'=')):null;
 if(cookie&&new RegExp('^'+COOKIE+'=[a-f0-9]{64}$').test(cookie))headers.Cookie=cookie;
 try{
  const upstream=await fetcher(url.href,{method:req.method,headers,body,redirect:'error',signal:AbortSignal.timeout(55000)});
  if(!upstream.headers.get('content-type')?.includes('application/json'))return json(res,502,{error:'backend_unavailable'});
  const text=await upstream.text();JSON.parse(text); // Never forward an HTML sign-in/error page as application data.
  const setCookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[upstream.headers.get('set-cookie')].filter(Boolean);
  const guestCookies=setCookies.filter(value=>value.startsWith(COOKIE+'=')&&!/;\s*domain=/i.test(value));
  if(guestCookies.length)res.setHeader('Set-Cookie',guestCookies);
  res.statusCode=upstream.status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(text);
 }catch{return json(res,502,{error:'backend_unavailable'})}
}}
export default createGateway();
