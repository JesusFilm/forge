#!/bin/sh
# Public transport controls only. No model or application requests.
set -eu
cd /app/apps/rag
node --import tsx --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { HttpFetcher } from './src/adapters/http/http-fetcher.ts'
import { spawnSync } from 'node:child_process'
assert.equal(process.version, 'v24.22.1')
for (const host of ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
  await assert.rejects(fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) }), e => e.cause?.code === 'CERT_REVOKED')
  await assert.rejects(new HttpFetcher({ timeoutMs: 10000 }).fetch(`https://${host}/`), e => e.cause?.code === 'CERT_REVOKED')
  for (const store of ['bundle', 'directory']) {
    const options = store === 'bundle' ? ['-CAfile', '/etc/ssl/certs/ca-certificates.crt', '-no-CApath', '-no-CAstore'] : ['-CApath', '/etc/ssl/certs', '-no-CAfile', '-no-CAstore']
    const r = spawnSync('openssl', ['s_client', '-connect', `${host}:443`, '-servername', host, '-verify_return_error', ...options], { input: '', encoding: 'utf8', timeout: 12000 })
    assert(!r.error && r.status !== 0 && /certificate verify failed|unable to get local issuer certificate/i.test(r.stdout + r.stderr))
  }
}
assert.equal((await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(10000) })).status, 204)
assert.equal((await new HttpFetcher({ timeoutMs: 10000 }).fetch('https://www.google.com/generate_204')).status, 204)
for (const options of [['-CAfile', '/etc/ssl/certs/ca-certificates.crt', '-no-CApath', '-no-CAstore'], ['-CApath', '/etc/ssl/certs', '-no-CAfile', '-no-CAstore']]) {
const good = spawnSync('openssl', ['s_client', '-connect', 'www.google.com:443', '-servername', 'www.google.com', '-verify_return_error', ...options], { input: '', encoding: 'utf8', timeout: 12000 })
assert(!good.error && good.status === 0 && /Verification: OK|Verify return code: 0/.test(good.stdout + good.stderr))
}
console.log('PASS: image Node, actual RAG HttpFetcher and OS bundle/directory certificate rejection with valid TLS controls')
JS
