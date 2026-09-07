import {spawn} from 'node:child_process';
import {mkdir,symlink,realpath,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const repo='/home/tataihono/.codex/worktrees/06c1/forge',root='/tmp/forge-studio-460-prep/pid1-main';
await mkdir(root+'/deps/@remotion',{recursive:true});await mkdir(root+'/deps/.pnpm',{recursive:true});
const require=createRequire(repo+'/apps/studio-render/package.json');
const renderer=await realpath(repo+'/apps/studio-render/node_modules/@remotion/renderer');
try{await symlink('../.pnpm/'+renderer.split('/node_modules/.pnpm/')[1],root+'/deps/@remotion/renderer')}catch(e){if(e.code!=='EEXIST')throw e}
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const cgroup='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).trim().split('0::')[1];
const built=await readFile(repo+'/apps/studio-render/dist/main.mjs','utf8');await writeFile(root+'/diagnostic-main.mjs',built.replace('tasks > 128','tasks > 1000').replace('if (error48?.code === "ISOLATION_LOST") {','console.error("owned diagnostic",error48); if (error48?.code === "ISOLATION_LOST") {'));
const args=['--unshare-all','--share-net','--as-pid-1','--die-with-parent','--clearenv','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--symlink','usr/bin','/bin','--proc','/proc','--dev','/dev','--ro-bind',cgroup,'/sys/fs/cgroup','--size','268435456','--tmpfs','/work','--ro-bind',process.execPath,'/runtime/node','--ro-bind',root+'/diagnostic-main.mjs','/opt/studio-render/main.mjs','--ro-bind',repo+'/apps/studio-render/dist/child.mjs','/opt/studio-render/child.mjs','--ro-bind',repo+'/apps/studio-render/dist/verify.mjs','/opt/studio-render/verify.mjs','--ro-bind',repo+'/apps/studio-render/dist/bundle','/opt/studio-render/bundle','--ro-bind',repo+'/apps/studio-render/dist','/opt/studio-render/native','--ro-bind',root+'/deps','/opt/studio-render/deps','--ro-bind',repo+'/node_modules/.pnpm','/opt/studio-render/deps/.pnpm','--ro-bind',repo+'/apps/shorts-worker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64','/opt/studio-render/browser','--ro-bind','/tmp/forge-studio-460-runtime/codec/ffmpeg-n9.0-latest-linux64-gpl-9.0/bin','/opt/studio-render/codec','--setenv','PORT','34675','--setenv','STUDIO_RENDER_BROKER_PUBLIC_KEY',publicKey.export({type:'spki',format:'pem'}),'--','/runtime/node','/opt/studio-render/main.mjs'];
await mkdir(root+'/rootfs',{recursive:true});
const mounts=[];for(let i=0;i<args.length;i++)if(args[i]==='--ro-bind')mounts.push([args[i+1],args[i+2]]);
await writeFile(root+'/mounts.json',JSON.stringify({root:root+'/rootfs',mounts,env:{PORT:'34675',STUDIO_RENDER_BROKER_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})}}));
const child=spawn('/usr/bin/unshare',['-UrmpCf','--kill-child=KILL','/usr/bin/python3','/tmp/forge-studio-460-prep/pid1-rootfs-hypothesis.py',root+'/mounts.json'],{stdio:['ignore','inherit','inherit']});
let exit;child.on('exit',(code,signal)=>{exit={code,signal}});
try{
 let health;for(let n=0;n<50;n++){if(exit)throw new Error(JSON.stringify(exit));try{health=await(await fetch('http://127.0.0.1:34675/health')).json();break}catch{}await new Promise(r=>setTimeout(r,100))}
 assert.ok(health);console.log('health',health);
 const now=Date.now();const input={document:{version:1,title:'PID1 render',language:'english',runtimeVersion:'studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16',width:320,height:180,fps:30,durationInFrames:30,tracks:[{id:'visual',kind:'visual'}],items:[{id:'text',kind:'text',trackId:'visual',startFrame:0,durationInFrames:30,text:'PID1 proof',properties:{fontSize:32,color:'#ffffff'}}],components:[],packRevisionIds:[]},media:{},code:{}};
 const body=JSON.stringify({version:1,profileId:health.profileId,executionExpiresAt:now+60000,instanceId:health.instanceId,attemptId:'pid1-main-460',leaseId:randomUUID(),inputHash:'a'.repeat(64),issuedAt:now,expiresAt:now+60000,input,files:[]});
 const started=performance.now();const response=await fetch('http://127.0.0.1:34675/render',{method:'POST',body,headers:{'x-studio-admission':sign(null,Buffer.from(body),privateKey).toString('base64')},signal:AbortSignal.timeout(65000)});
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,bytes.toString());await writeFile(root+'/output.mp4',bytes);console.log(JSON.stringify({elapsedMs:performance.now()-started,bytes:bytes.length,verification:JSON.parse(Buffer.from(response.headers.get('x-studio-verification'),'base64').toString())}));
}finally{
 const descendants=async(pid)=>{let direct=[];try{direct=(await readFile(`/proc/${pid}/task/${pid}/children`,'utf8')).trim().split(/\s+/).filter(Boolean).map(Number)}catch{};return direct.concat(...await Promise.all(direct.map(descendants)))};
 const pids=await descendants(child.pid);
 const metrics={};for(const file of ['memory.peak','memory.events','pids.peak','cpu.stat'])metrics[file]=await readFile(cgroup+'/'+file,'utf8');console.log('metrics',metrics);
 const init=Number((await readFile(`/proc/${child.pid}/task/${child.pid}/children`,'utf8')).trim());assert.ok(init>0);assert.match(await readFile(`/proc/${init}/status`,'utf8'),/NSpid:[^\n]*\s1\n/);
 const ended=new Promise(r=>child.once('exit',r));process.kill(init,'SIGTERM');await Promise.race([ended,new Promise(r=>setTimeout(r,2200))]);if(!exit)child.kill('SIGKILL');assert.deepEqual(exit,{code:0,signal:null});for(const pid of pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});console.log('clean PID1 retirement',exit);
}
