#!/bin/sh
# Public transport controls only. No model or application requests.
set -eu
cd /app/apps/mastra-gateway
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


cd /app/apps/mastra-gateway
node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import {createRemoteJWKSet} from 'jose'
for (const host of ['dv-g3b-emudhra.we-have-a-problem.com','dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
  const keys=createRemoteJWKSet(new URL(`https://${host}/api/auth/jwks`), {timeoutDuration:10000})
  await assert.rejects(keys({alg:'RS256',kid:'public-transport-control'},{}),e=>e.cause?.code==='CERT_REVOKED')
}
const endpoint = new URL('https://www.googleapis.com/oauth2/v3/certs')
const response = await fetch(endpoint, {signal:AbortSignal.timeout(10000)})
assert.equal(response.status,200)
const {keys} = await response.json()
const key = keys.find(k=>k.kty==='RSA'&&k.kid)
assert.ok(key)
const resolved = await createRemoteJWKSet(endpoint,{timeoutDuration:10000})({alg:'RS256',kid:key.kid},{})
assert.equal(resolved.type,'public')
console.log('PASS: installed JOSE remote JWKS rejects both affected certificate chains and resolves a valid public TLS control')
JS
