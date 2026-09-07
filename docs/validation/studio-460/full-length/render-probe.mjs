import {mkdtemp,writeFile,rm,realpath,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {executeStudioChild} from '/home/tataihono/.cache/forge-studio-460-runtime/isolation-diagnostic.mjs'
import {currentCgroupDirectory,verifyExecutionBudget} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/studio-render/src/budget.mjs'
const root='/home/tataihono/.codex/worktrees/06c1/forge',dir=await mkdtemp('/home/tataihono/.cache/forge-studio-460-runtime/full-length-')
const codec='/tmp/forge-studio-460-runtime/codec/ffmpeg-n9.0-latest-linux64-gpl-9.0/bin',seconds=231,fps=30,frames=seconds*fps
const runtimeVersion='studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16'
const reference={assetId:'fixture',versionId:'fixture',digest:'a'.repeat(64)}
const code="import React from 'react'; import {useCurrentFrame} from 'remotion'; export default function Overlay(){const frame=useCurrentFrame();return <div style={{position:'absolute',left:80,top:120,width:180+Math.sin(frame/30)*60,height:180,background:'#00ff00'}}/>}"
const document={version:1,title:'Full 231-second local composition throughput',language:'english',runtimeVersion,width:1080,height:1920,fps,durationInFrames:frames,tracks:[{id:'visual',kind:'visual'},{id:'caption',kind:'caption'},{id:'audio',kind:'audio'}],components:[{versionId:'overlay',code:reference,runtimeVersion,width:1080,height:1920,duration:{minFrames:1,maxFrames:frames},dependencies:[],assets:[],controls:{}}],packRevisionIds:[],items:[{id:'overlay-item',kind:'component',trackId:'visual',startFrame:0,durationInFrames:frames,componentVersionId:'overlay',properties:{}},{id:'audio-item',kind:'audio',trackId:'audio',startFrame:0,durationInFrames:frames,asset:reference,sourceStartMs:0,volume:0.5},...Array.from({length:77},(_,i)=>({id:`caption-${i}`,kind:'text',trackId:'caption',startFrame:i*90,durationInFrames:90,text:`Full-length devotional composition — segment ${i+1} of 77`,properties:{fontSize:48,color:'#ffffff'}}))]}
try{
 const wav=spawnSync(join(codec,'ffmpeg'),['-v','error','-f','lavfi','-i',`sine=frequency=880:sample_rate=48000:duration=${seconds}`,'-c:a','pcm_s16le',join(dir,'voice.wav')],{timeout:15000,maxBuffer:8192});if(wav.status!==0)throw new Error(wav.stderr.toString())
 await writeFile(join(dir,'input.json'),JSON.stringify({document,media:{'audio-item':{file:'voice.wav',sourceStartMs:0,kind:'audio'}},code:{overlay:code}}))
 const cgroup=await currentCgroupDirectory(),before=await readFile(join(cgroup,'cpu.stat'),'utf8')
 console.log(JSON.stringify({durationSeconds:seconds,frames,width:1080,height:1920,budget:await verifyExecutionBudget(cgroup),deadlineMs:900000,before}))
 const required=createRequire(join(root,'apps/studio-render/package.json')),dependencies=await realpath(join(root,'node_modules')),started=performance.now()
 try{
 const output=await executeStudioChild({nativeDir:join(root,'apps/studio-render/dist'),child:'/home/tataihono/.cache/forge-studio-460-runtime/child-throughput.mjs',node:process.execPath,input:dir,bundle:join(root,'apps/studio-render/dist/bundle'),dependencies,browser:join(root,'apps/shorts-worker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64'),codec,renderer:required.resolve('@remotion/renderer').replace(dependencies,'/deps'),timeoutMs:900000})
 console.log(JSON.stringify({status:'rendered',elapsedMs:performance.now()-started,outputBytes:output.length}));await writeFile('/tmp/forge-studio-460-runtime/full-length-output.mp4',output)
 }catch(error){console.log(JSON.stringify({status:error.code,message:error.message,elapsedMs:performance.now()-started}))}
 console.log(JSON.stringify({after:await readFile(join(cgroup,'cpu.stat'),'utf8'),memoryPeak:await readFile(join(cgroup,'memory.peak'),'utf8'),memoryEvents:await readFile(join(cgroup,'memory.events'),'utf8')}))
}finally{await rm(dir,{recursive:true,force:true})}
