#!/bin/sh
# Public transport controls only. No model or application requests.
set -eu
cd /app/apps/auth
node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
assert.equal(process.version, 'v24.22.1')
for (const host of ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
  await assert.rejects(fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) }), e => e.cause?.code === 'CERT_REVOKED')
  for (const store of ['bundle', 'directory']) {
    const options = store === 'bundle' ? ['-CAfile', '/etc/ssl/certs/ca-certificates.crt', '-no-CApath', '-no-CAstore'] : ['-CApath', '/etc/ssl/certs', '-no-CAfile', '-no-CAstore']
    const r = spawnSync('openssl', ['s_client', '-connect', `${host}:443`, '-servername', host, '-verify_return_error', ...options], { input: '', encoding: 'utf8', timeout: 12000 })
    assert(!r.error && r.status !== 0 && /certificate verify failed|unable to get local issuer certificate/i.test(r.stdout + r.stderr))
  }
}
assert.equal((await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(10000) })).status, 204)
for (const options of [['-CAfile', '/etc/ssl/certs/ca-certificates.crt', '-no-CApath', '-no-CAstore'], ['-CApath', '/etc/ssl/certs', '-no-CAfile', '-no-CAstore']]) {
const good = spawnSync('openssl', ['s_client', '-connect', 'www.google.com:443', '-servername', 'www.google.com', '-verify_return_error', ...options], { input: '', encoding: 'utf8', timeout: 12000 })
assert(!good.error && good.status === 0 && /Verification: OK|Verify return code: 0/.test(good.stdout + good.stderr))
}
console.log('PASS: image Node and OS bundle/directory certificate rejection with valid TLS controls')
JS

set -eu
export PATH=/opt/forge-node/bin:$PATH
cd /app
node <<'JS'
const {createRequire}=require('node:module'),path=require('node:path'),assert=require('node:assert/strict');
const req=createRequire('/app/apps/auth/package.json');
const {HttpClient,defaultRetryConfig}=req(path.join(path.dirname(req.resolve('firebase-admin')),'utils/api-request.js'));
(async()=>{
for(const host of ['dv-g3b-emudhra.we-have-a-problem.com','dv-g3b-aaa-emudhra.we-have-a-problem.com','www.google.com']){
 let response,error;
 try{response=await new HttpClient({...defaultRetryConfig(),maxRetries:0}).send({method:'GET',url:'https://'+host+'/generate_204',timeout:10000});}
 catch(e){error=e;}
 const certificateError=Boolean(error&&/CERT_REVOKED|certificate revoked|unable to get local issuer certificate|certificate verify failed/i.test(error.message));
 console.log(JSON.stringify({client:'installed-firebase-admin-HttpClient',host,status:response?.status,code:error?.code,diagnostic:error?.message?.slice(0,220),certificateError}));
 if(host==='www.google.com')assert.equal(response?.status,204);else assert.equal(certificateError,true);
}
})().catch(e=>{console.log(JSON.stringify({failure:e.code||e.name}));process.exitCode=1;});
JS
