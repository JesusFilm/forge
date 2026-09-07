import {readFile,writeFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
const root='/home/tataihono/.codex/worktrees/06c1/forge/';
const files=['apps/web/src/components/sections/block-types.ts','apps/web/src/components/whats-new/whats-new-content.ts'];
const targets=[];
for(const source of files){const text=await readFile(root+source,'utf8');for(const match of text.matchAll(/"(https:\/\/(?:images\.unsplash\.com|www\.jesusfilm\.org\/wp-content\/uploads|imagedelivery\.net)\/[^"\s]+)"/g))targets.push({source,url:match[1]});}
let count=0;
const results=[];
for(const target of targets.slice(0,6)){
 for(const method of ['HEAD','GET']){
  let url=new URL(target.url);const chain=[];const signal=AbortSignal.timeout(10000);
  try{
   for(let redirects=0;redirects<3;redirects++){
    if(++count>24)throw Error('request budget');
    if(url.protocol!=='https:'||url.username||url.password)throw Error('nonpublic target');
    const addresses=await lookup(url.hostname,{all:true});
    if(addresses.some(({address})=>/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::|f[cd]|fe[89ab])/i.test(address)))throw Error('private address');
    const response=await fetch(url,{method,redirect:'manual',headers:method==='GET'?{Range:'bytes=0-1023'}:{},signal});
    const row={host:url.hostname,path:url.pathname,status:response.status,type:response.headers.get('content-type')?.split(';')[0],bytes:0};chain.push(row);
    if(method==='GET'&&response.body){const reader=response.body.getReader();const first=await reader.read();row.bytes=first.value?.byteLength??0;await reader.cancel();reader.releaseLock();}
    const location=response.headers.get('location');
    if(response.status>=300&&response.status<400&&location){url=new URL(location,url);continue;}break;
   }
   results.push({source:target.source,method,chain});
  }catch(error){results.push({source:target.source,method,chain,error:error.name});}
 }
}
await writeFile('/home/tataihono/.cache/forge-studio-460-runtime/core-image-public-probe.json',JSON.stringify({limits:{targets:6,requests:24,perChainMs:10000,getRange:'bytes=0-1023',body:'one transport chunk then cancel; recorded actual bytes'},count,results},null,2));
