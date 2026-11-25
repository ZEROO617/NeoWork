import {readFile,readdir,mkdir,rm,writeFile,cp} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const assets={};for(const name of (await readdir('public')).sort()){const ext=name.split('.').at(-1);if(!types[ext])continue;assets['/'+name]={type:types[ext],body:await readFile('public/'+name,'utf8')}}
const assigneeSource=(await readFile('public/assignees.js','utf8')).replace(/export /g,'');
const assigneeModel='const assigneeModel=(()=>{'+assigneeSource+';return {resolveTaskAssignee,repairTaskAssignees}})();';
const updates=(await readFile('worker/updates.js','utf8')).replace("import {resolveTaskAssignee} from '../public/assignees.js';",'const {resolveTaskAssignee}=assigneeModel;').replace(/export /g,'');
const ai=(await readFile('worker/ai.js','utf8')).replace("import {resolveTaskAssignee} from '../public/assignees.js';",'').replace("import {updateSchema,validatePrevious,cleanOperations,updateInstructions} from './updates.js';",()=>updates).replace(/export /g,'');
const secrets=(await readFile('worker/secrets.js','utf8')).replace(/export /g,'');
const docSource=(await readFile('public/document.js','utf8')).replace(/export /g,'');
const documentModel='const documentModel=(()=>{'+docSource+';return {emptyDocument,manualChange,apiDocument,stageRefresh,isDirty}})();';
const seed=await import('../public/data.js');
const roomSource=(await readFile('worker/rooms.js','utf8')).replace("import {repairTaskAssignees} from '../public/assignees.js';",'const {repairTaskAssignees}=assigneeModel;').replace("import {analyze} from './ai.js';",'').replace("import {readKey} from './secrets.js';",'').replace("import {emptyDocument,manualChange,apiDocument,stageRefresh,isDirty} from '../public/document.js';",'const {emptyDocument,manualChange,apiDocument,stageRefresh,isDirty}=documentModel;').replace("import {messages as sampleMessages} from '../public/data.js';",'const sampleMessages='+JSON.stringify(seed.messages)+';').replace(/export /g,'');
const roomsModule='const {handleRooms}=(()=>{'+roomSource+';return {handleRooms}})();';
const worker=(await readFile('worker/index.js','utf8')).replace("import {handleRooms} from './rooms.js';",()=>assigneeModel+documentModel+roomsModule).replace("import {analyze,validateContext} from './ai.js';",()=>ai).replace("import {readKey,writeKey} from './secrets.js';",()=>secrets).replace('__NEOWORK_ASSETS__',()=>JSON.stringify(assets));
await writeFile('dist/server/index.js',worker);await mkdir('dist/.openai',{recursive:true});await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built NeoWork Worker with embedded frontend → dist/server/index.js');
