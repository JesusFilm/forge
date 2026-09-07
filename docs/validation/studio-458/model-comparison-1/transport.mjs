import {readFile,writeFile,appendFile,mkdir,access} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';import {performance} from 'node:perf_hooks';import {join} from 'node:path';
import {inspectStream} from '../dry-verified/stream-evidence.mjs';
export const PRODUCTION_URL='https://openrouter.ai/api/v1/chat/completions';
const LOOPBACK_URL='http://127.0.0.1:4197/v1/chat/completions';
const BASE='/tmp/forge-studio-458-prep/model-capability-comparison/binding';
const PROPOSAL=BASE+'/verified-bound-proposal.body';
const PROPOSAL_HASH='f1aac2780903fdd16ccfb9aad7af0de7a6de7ee7036534253a8c320ba0e947c4';
const LIVE_LEDGER='/tmp/forge-studio-458-runtime/native-paid-guard/model-comparison-1-live.sqlite';
const HELPER_HASHES={"guard.py": "ea5b831c89bc9eef148b145adb39d170d774d6d336f0d9504870c21d0b41a7a6", "cli.py": "1d23db838a1ab1e3ebf27f35a24da0a8d61bd2e2f02ea3c0584f7d0c77276e56", "expected.py": "96e89c168280316ef0e942fbb5fc9e9bacfc9d3d233f0a235da59b8fa738e49a", "stream-evidence.mjs": "0e33d6a7f54cb99ef8e1ac0502b8dfca34fe7aad29c5c0ff8588452b13604f26", "tool-boundary.mjs": "508487d2fd3ad98e747d982a762412367bfcc66291f24dc214af549064221114"};
const MAX_RESPONSE_BYTES=4*1024*1024;
async function exists(p){try{await access(p);return true;}catch{return false;}}
export function createComparisonTransport({mode='disabled',evidenceDir=BASE+'/live-adapter/live',ledger,timeoutMs=90000,faults={}}={}){
 let stoppedInMemory=false;
 return async(requestedURL,input,upstreamSignal)=>{
  if(upstreamSignal?.aborted)throw new Error('Caller already aborted; no dispatch');
  if(stoppedInMemory)throw new Error('Transport stopped in memory');
  if(mode==='disabled')throw new Error('Network disabled; no paid release');
  if(!['loopback','live'].includes(mode))throw new Error('Unknown transport mode');
  if(requestedURL!==PRODUCTION_URL)throw new Error('Unapproved SDK URL');
  const proposalBytes=await readFile(PROPOSAL);if(createHash('sha256').update(proposalBytes).digest('hex')!==PROPOSAL_HASH)throw new Error('Bound manifest changed');
  for(const [name,expected] of Object.entries(HELPER_HASHES)){if(createHash('sha256').update(await readFile(BASE+'/dry-verified/'+name)).digest('hex')!==expected)throw new Error('Reviewed helper changed');}
  if(createHash('sha256').update(await readFile(BASE+'/live-adapter/bridge.py')).digest('hex')!=='a47b24cfd195e910dabcd61995f4e146beaed62e71009cfe23ceb6d397693336')throw new Error('Reviewed bridge changed');
  let token,target,ledgerPath;
  if(mode==='live'){
   if(Object.keys(faults).length)throw new Error('Test fault injection forbidden in live mode');
   const authorization=JSON.parse(await readFile(BASE+'/live-adapter/authorization.json','utf8'));
   if(authorization.status!=='ROOT_RELEASED'||authorization.proposalSHA256!==PROPOSAL_HASH||authorization.ceilingUSD!==9||authorization.adapterSHA256!==createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'))throw new Error('Explicit matching live release missing');
   if(authorization.executionAdapterSHA256!==createHash('sha256').update(await readFile('/home/tataihono/.codex/worktrees/8b33/forge/apps/mastra/.tmp/model-comparison-live.ts')).digest('hex'))throw new Error('Reviewed native adapter changed');
   if(timeoutMs!==90000)throw new Error('Live timeout changed');
   const lines=(await readFile('/tmp/forge-studio-458-prep/private/manager.env','utf8')).split('\n');const line=lines.find(x=>x.startsWith('OPENROUTER_API_KEY='));token=line?.slice('OPENROUTER_API_KEY='.length).trim().replace(/^['"]|['"]$/g,'');if(!token)throw new Error('Existing credential unavailable');
   target=PRODUCTION_URL;ledgerPath=LIVE_LEDGER;
  }else{
   if(!ledger||ledger===LIVE_LEDGER||!ledger.endsWith('/loopback.sqlite'))throw new Error('Loopback must use a separate test ledger');
   token='loopback-fixture';target=LOOPBACK_URL;ledgerPath=ledger;
  }
  await mkdir(evidenceDir,{recursive:true});const stop=join(evidenceDir,'STOP.json');if(await exists(stop))throw new Error('Batch transport stopped; no replay');
  function fault(stage){if(mode==='loopback'&&faults[stage]){const e=new Error('Injected evidence storage failure');e.code='ENOSPC';throw e;}}
  function guard(command,value){fault(command);return JSON.parse(execFileSync('python3',[BASE+'/live-adapter/bridge.py',command,ledgerPath,PROPOSAL],{input:JSON.stringify(value),encoding:'utf8',stdio:['pipe','pipe','pipe']}));}
  // The bridge serializes all adapter reservations on the existing ledger inode
  // and refuses any prior unresolved/failed claim. Losing claims never latch STOP.
  const claim=guard('reserve',input);const stem=join(evidenceDir,`request-${input.slot}-${input.ordinal}`);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=performance.now();let recorded=false,http=null,responseHeaders=null,reader=null,dispatched=false;
  try{
   fault('requestEvidence');await writeFile(stem+'-request.body',input.raw);
   dispatched=true;
   const response=await fetch(target,{method:'POST',redirect:'error',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:input.raw,signal:upstreamSignal?AbortSignal.any([controller.signal,upstreamSignal]):controller.signal});http=response.status;responseHeaders={'content-type':response.headers.get('content-type'),'x-request-id':response.headers.get('x-request-id')};
   await writeFile(stem+'-response.body','');let bytes=0;const parts=[];reader=response.body?.getReader();
   if(reader)while(true){const next=await reader.read();if(next.done)break;await appendFile(stem+'-response.body',next.value);bytes+=next.value.byteLength;if(bytes>MAX_RESPONSE_BYTES){controller.abort();throw new Error('Response byte bound exceeded');}parts.push(next.value);}
   const payload=Buffer.concat(parts),parsed=inspectStream(payload.toString('utf8'),http);
   const result={...parsed,elapsedMs:performance.now()-started,responseHeaders,requestDigest:claim.digest,requestBytes:claim.serializedBytes,reservedUSD:claim.reservedUSD,transport:mode,networkDispatched:dispatched};
   const state=http!==200?'FAILED':parsed.completeStream?'COMPLETED':'AMBIGUOUS';
   // Evidence must exist before COMPLETED is possible. Ledger is authoritative
   // for settlement; this artifact explicitly records the pre-settlement intent.
   await writeFile(stem+'-result.json',JSON.stringify({...result,state:'AWAITING_SETTLEMENT',requestedState:state},null,2));
   const settled=guard('finish',{claim,state,result});recorded=true;
   if(settled.state!=='COMPLETED')throw new Error('Failed, incomplete or invalid observed result; no replay');
   return new Response(payload,{status:http,headers:{'content-type':responseHeaders['content-type']??'text/event-stream'}});
  }catch(error){
   stoppedInMemory=true;controller.abort();
   const result={state:'AMBIGUOUS',elapsedMs:performance.now()-started,http,responseHeaders,actualCostUSD:null,networkDispatched:dispatched,errorType:error?.name??'Error',errorMessage:error?.message??'Unknown transport failure',requestDigest:claim.digest};
   // Independent attempts: no new evidence file is needed to stop the existing
   // ledger. If storage prevents even that write, its unresolved claim blocks
   // every later reservation through the bridge, including after restart.
   try{guard('stop',{claim});}catch{}
   if(!recorded)try{guard('finish',{claim,state:'AMBIGUOUS',result});}catch{}
   try{await writeFile(stem+'-failure.json',JSON.stringify(result,null,2));}catch{}
   try{fault('stopEvidence');await writeFile(stop,JSON.stringify({proposalSHA256:PROPOSAL_HASH,slot:input.slot,ordinal:input.ordinal,reason:result.errorMessage,automaticReplay:false},null,2),{flag:'wx'});}catch{}
   throw error;
  }finally{clearTimeout(timer);if(reader)try{await reader.cancel();}catch{}}
 };
}
