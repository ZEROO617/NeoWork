// User-entered keys are encrypted before durable server storage; never returned.
const objectName='credentials/openai-v1';
async function encryptionKey(env){
 if(!env.KEY_ENCRYPTION_SECRET)throw Error('storage_not_configured');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.KEY_ENCRYPTION_SECRET));
 return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
export async function readKey(env){
 if(env.OPENAI_API_KEY)return env.OPENAI_API_KEY;
 if(!env.SECRETS_BUCKET||!env.KEY_ENCRYPTION_SECRET)return null;
 const object=await env.SECRETS_BUCKET.get(objectName);if(!object)return null;
 const record=await object.json();
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},await encryptionKey(env),new Uint8Array(record.cipher));
 return new TextDecoder().decode(clear);
}
export async function writeKey(env,key){
 if(!env.SECRETS_BUCKET||!env.KEY_ENCRYPTION_SECRET)throw Error('storage_not_configured');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(key));
 await env.SECRETS_BUCKET.put(objectName,JSON.stringify({iv:[...iv],cipher:[...new Uint8Array(cipher)]}),{httpMetadata:{contentType:'application/json'}});
}
