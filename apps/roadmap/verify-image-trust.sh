#!/bin/sh
# Public certificate controls and a read-only server fixture. No external identity.
set -eu
cd /app/apps/roadmap
node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
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
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3199'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3199' } })
const stopped = once(child, 'exit')
try {
  let ready = false
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error('Production server exited before readiness')
    try { ready = (await fetch('http://127.0.0.1:3199/', { signal: AbortSignal.timeout(1000) })).status === 200 } catch {}
    if (ready) break
    await new Promise(r => setTimeout(r, 200))
  }
  assert(ready)
  for (const path of ['/', '/roadmap', '/ticket/feat-786', '/index.md', '/roadmap.md', '/ticket/feat-786.md']) {
    const response = await fetch(`http://127.0.0.1:3199${path}`)
    assert.equal(response.status, 200, path)
    const body = await response.text()
    assert(body.length > 100, path)
    if (path.endsWith('.md')) assert.match(response.headers.get('content-type'), /text\/markdown/)
    if (path === '/') {
      const asset = body.match(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+\.(?:js|css))"/)
      assert(asset, 'Production HTML references a static asset')
      assert.equal((await fetch(new URL(asset[1].replaceAll('&amp;', '&'), 'http://127.0.0.1:3199'))).status, 200)
    }
  }
  for (const path of ['/ticket/platform/audit-missing-ticket', '/ticket/platform/audit-missing-ticket.md']) assert.equal((await fetch(`http://127.0.0.1:3199${path}`)).status, 404)
  console.log('PASS: actual production home/dashboard/ticket/Markdown/static reads and unknown ticket 404')
} finally {
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await stopped } finally { clearTimeout(timer) }
}
JS
