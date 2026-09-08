import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='/home/tataihono/.cache/forge-studio-460-image-runtime';
const key=(await readFile(base+'/worker-api-key','utf8')).trim();
const origin='http://127.0.0.1:34761';
const observations=[];
async function request(label,path,{method='GET',auth=false,body}={}) {
 const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(5000),headers:{...(auth?{authorization:'Bearer '+key}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json(); observations.push({label,status:response.status,body:data});return {status:response.status,data};
}
try {
 assert.equal((await request('health','/health')).status,200);
 assert.equal((await request('unauthenticated job','/jobs',{method:'POST',body:{kind:'render'}})).status,401);
 for(const kind of ['prepare','render']) assert.equal((await request('retired '+kind,'/jobs',{method:'POST',auth:true,body:{kind}})).status,400);
 assert.equal((await request('unknown retained job','/jobs/no-such-owned-job',{auth:true})).status,404);
 assert.equal((await request('invalid retained job','/jobs',{method:'POST',auth:true,body:{kind:'devotional-render'}})).status,400);
 assert.equal((await request('health after rejections','/health')).status,200);
 console.log(JSON.stringify({passed:true,observations},null,2));
} finally {await writeFile(base+'/evidence/worker-http-smoke.json',JSON.stringify(observations,null,2)+'\n');}
