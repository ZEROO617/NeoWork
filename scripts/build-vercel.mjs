import {cp,mkdir,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await rm('vercel-public',{recursive:true,force:true});await mkdir('vercel-public',{recursive:true});
for(const file of await readdir('public')){
 if(file.startsWith('settings.'))continue; // Owner key administration stays on the authenticated backend.
 if(!/\.(html|css|js)$/.test(file))continue;
 const source='public/'+file;if(file.endsWith('.js')){const checked=spawnSync(process.execPath,['--check',source],{encoding:'utf8'});if(checked.status)throw Error(checked.stderr)}
 await cp(source,'vercel-public/'+file);
}
console.log('Built Vercel frontend with same-origin shared API gateway.');
