import {readFile,readdir,mkdir,rm,writeFile,cp} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const assets={};for(const name of (await readdir('public')).sort()){const ext=name.split('.').at(-1);if(!types[ext])continue;assets['/'+name]={type:types[ext],body:await readFile('public/'+name,'utf8')}}
const ai=(await readFile('worker/ai.js','utf8')).replace(/export /g,'');
const worker=(await readFile('worker/index.js','utf8')).replace("import {analyze,validateContext} from './ai.js';",ai).replace('__NEOWORK_ASSETS__',JSON.stringify(assets));
await writeFile('dist/server/index.js',worker);await mkdir('dist/.openai',{recursive:true});await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built NeoWork Worker with embedded frontend → dist/server/index.js');
