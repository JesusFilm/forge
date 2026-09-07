import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs'
import {spawn,spawnSync} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {randomBytes,createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
const root='/home/tataihono/.codex/worktrees/06c1/forge',out='/tmp/forge-studio-460-runtime'
const runtimeVersion='studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16'
const ref={assetId:'fixture',versionId:'fixture-v1',digest:'a'.repeat(64)}
const code=`import React from 'react';export default function Card({title}){let isolated=false;try{window.parent.document.title}catch{isolated=true}return <div data-isolated={String(isolated)} style={{position:'absolute',left:20,top:20,color:'white',fontSize:24}}>{title}</div>}`
const input={document:{version:1,title:'Preview regression',language:'english',runtimeVersion,width:320,height:180,fps:30,durationInFrames:30,tracks:[{id:'source',kind:'visual'},{id:'overlay',kind:'visual'},{id:'audio',kind:'audio'}],components:[{versionId:'component-v1',code:{...ref,digest:createHash('sha256').update(code).digest('hex')},runtimeVersion,dependencies:[{name:'react',version:'19.2.4'}],width:320,height:180,duration:{minFrames:1,maxFrames:90},assets:[],controls:{title:{type:'text',maxLength:100}}}],packRevisionIds:[],items:[{id:'video',kind:'video',trackId:'source',startFrame:0,durationInFrames:30,source:{videoId:'source',dubId:'dub',editionId:'edition',language:'english',subtitle:{trackId:'subtitles',editionId:'edition',language:'english',asset:ref},preview:ref,export:ref,startMs:500,endMs:1500},volume:0},{id:'custom',kind:'component',trackId:'overlay',startFrame:0,durationInFrames:30,componentVersionId:'component-v1',properties:{title:'Isolated component'}},{id:'audio',kind:'audio',trackId:'audio',startFrame:0,durationInFrames:30,asset:ref,sourceStartMs:250,volume:0.5}]},media:{video:{file:'source.m3u8',sourceStartMs:0,kind:'hls'},audio:{file:'voice.wav',sourceStartMs:0,kind:'audio'}},code:{'component-v1':code}}
const generated=spawnSync(out+'/codec/ffmpeg-n9.0-latest-linux64-gpl-9.0/bin/ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=2','-c:a','pcm_s16le',out+'/preview-voice.wav'],{timeout:10000});assert.equal(generated.status,0)
const assets=[['source.m3u8','application/vnd.apple.mpegurl',await readFile('/tmp/forge-studio-458-runtime/source-variant.m3u8')],['source-fixture-0.ts','video/mp2t',await readFile('/tmp/forge-studio-458-runtime/source-fixture-0.ts')],['voice.wav','audio/wav',await readFile(out+'/preview-voice.wav')]]
let activeUrl=''
const parent=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Trusted parent</title><script>window.events=[];window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe')?.contentWindow)events.push({...e.data,at:performance.now()})});function command(data){document.querySelector('iframe').contentWindow.postMessage(data,'*')}</script><button onclick="window.command({type:'play'})">Play</button><iframe title="Preview" sandbox="allow-scripts" allow="autoplay" referrerpolicy="no-referrer" style="width:640px;height:360px" src="${activeUrl}"></iframe>`)})
await new Promise(done=>parent.listen(4610,'127.0.0.1',done))
const results={base:'4ee4f716',scope:'fixed preview runtime only; full Manager/NLE and Watch verification remains outstanding',samples:[]}
try{
 for(const [version,directory] of [['baseline',out+'/preview-baseline'],['changed',root+'/apps/studio-preview']]){
  const key=randomBytes(32).toString('hex'),origin='http://127.0.0.1:4611'
  const server=spawn(process.execPath,['dist/server.mjs'],{cwd:directory,env:{PATH:'/usr/bin:/bin',PORT:'4611',STUDIO_PREVIEW_API_KEY:key,STUDIO_PREVIEW_PUBLIC_ORIGIN:origin,STUDIO_MANAGER_ORIGIN:'http://localhost:4610'},stdio:['ignore','pipe','pipe']})
  let logs='';server.stderr.on('data',b=>logs+=b)
  try{
   for(let n=0;n<100;n++){try{if((await fetch(origin)).status===404)break}catch{}await new Promise(r=>setTimeout(r,50));if(n===99)throw new Error(logs)}
   const headers={authorization:`Bearer ${key}`,'content-type':'application/json'}
   const session=await fetch(origin+'/sessions',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(session.status,200,await session.clone().text());activeUrl=(await session.json()).url
   for(const [name,type,body] of assets)assert.equal((await fetch(activeUrl+name,{method:'PUT',headers:{authorization:`Bearer ${key}`,'content-type':type},body})).status,201)
   const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true})
   try{
    for(let repetition=1;repetition<=3;repetition++){
    const context=await browser.newContext(),page=await context.newPage()
    for(const temperature of ['cold','warm']){
     const errors=[];page.on('console',m=>console.log(version,temperature,m.type(),m.text()));page.on('pageerror',e=>errors.push(e.message))
     await page.goto('http://localhost:4610')
     await page.waitForFunction(()=>events.some(e=>e.type==='ready'))
     const frame=page.frames().find(f=>f.url()===activeUrl)
     await frame.locator('[data-isolated="true"]').waitFor()
     await frame.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&document.querySelector('audio')?.readyState>=2)
     const decodedMs=await page.evaluate(()=>performance.now())
     await page.evaluate(()=>command({type:'seek',frame:15}))
     await page.waitForFunction(()=>events.some(e=>e.type==='frame'&&e.frame===15))
     const updated=structuredClone(input.document);updated.items.find(i=>i.id==='custom').properties.title='Changed live'
     await page.evaluate(document=>command({type:'document',document}),updated)
     await frame.getByText('Changed live',{exact:true}).waitFor()
     await page.getByRole('button',{name:'Play',exact:true}).click()
     let playback=true;try{await page.waitForFunction(()=>events.some(e=>e.type==='frame'&&e.frame>15),{},{timeout:5000})}catch(e){playback=false;console.log('playback diagnostic',await page.evaluate(()=>events),await frame.evaluate(()=>[...document.querySelectorAll('video,audio')].map(x=>({tag:x.tagName,paused:x.paused,time:x.currentTime,ready:x.readyState,error:x.error?.message}))));if(version!=='baseline')throw e}
     await page.evaluate(()=>command({type:'pause'}))
     assert.equal(await frame.evaluate(()=>location.origin),'http://127.0.0.1:4611')
     assert.equal(await frame.evaluate(()=>window.origin),'null')
     const audio=await frame.evaluate(()=>({time:document.querySelector('audio').currentTime,gain:document.querySelector('audio').volume,seekable:document.querySelector('audio').seekable.length,intervals:Array.from({length:document.querySelector('audio').seekable.length},(_,i)=>[document.querySelector('audio').seekable.start(i),document.querySelector('audio').seekable.end(i)])}));assert.equal(audio.gain,0.5);if(version==='changed'){assert.ok(audio.time>=0.75);assert.ok(audio.seekable>0)}
     const timings=await frame.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/client.js')).map(r=>({duration:r.duration,encodedBodySize:r.encodedBodySize,transferSize:r.transferSize})))
     const readyMs=await page.evaluate(()=>events.find(e=>e.type==='ready').at)
     const messages=await page.evaluate(()=>events.filter(e=>e.type==='error'))
     assert.deepEqual(messages,[]);assert.deepEqual(errors,[])
     results.samples.push({version,temperature,repetition,readyMs,decodedMs,bundleTiming:timings,isolated:true,seek:true,liveControls:true,playback,audio})
     if(temperature==='warm')await page.screenshot({path:out+`/preview-${version}.png`})
     await page.goto('about:blank')
    }
    await context.close()
    }
   }finally{await browser.close()}
   assert.equal((await fetch(activeUrl,{method:'DELETE',headers})).status,204)
   assert.equal((await fetch(activeUrl)).status,410)
   const bundle=await readFile(directory+'/dist/client.js');results[version+'Bundle']={rawBytes:bundle.length,gzipBytes:gzipSync(bundle).length}
  }finally{server.kill('SIGTERM');await new Promise(done=>server.once('exit',done))}
 }
 await writeFile(out+'/preview-regression.json',JSON.stringify(results,null,2));console.log(results)
}finally{await new Promise(done=>parent.close(done))}
