import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const build=spawnSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});if(build.status)process.exit(build.status);
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const bindings={};try{for(const line of (await readFile('.env.local','utf8')).split('\n')){const m=line.match(/^(OPENAI_API_KEY|OPENAI_MODEL|KEY_ENCRYPTION_SECRET|SITE_OWNER_ID)=(.*)$/);if(m)bindings[m[1]]=m[2].trim()}}catch{}
const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-07-01',port:Number(arg('--port')||4173),host:arg('--host')||'127.0.0.1',d1Databases:['DB'],d1Persist:'.wrangler/shared-d1',r2Buckets:['SECRETS_BUCKET'],r2Persist:'.wrangler/shared-r2',bindings});
const db=await mf.getD1Database('DB');await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
for(const file of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort()){if(await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(file).first())continue;const sql=await readFile('drizzle/'+file,'utf8');for(const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();await db.prepare('INSERT INTO local_migrations(name) VALUES(?)').bind(file).run()}
console.log('NeoWork shared preview: '+await mf.ready);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await mf.dispose();process.exit()});
