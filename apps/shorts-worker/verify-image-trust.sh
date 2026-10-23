#!/bin/sh
# CI only: public TLS controls and an isolated production HTTP process.
set -eu
cd /app/apps/shorts-worker
node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createDefaultRenderEngine } from './dist/render-engine.js'

assert.equal(process.version, 'v22.23.4')
const affected = ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']
for (const host of affected) {
  await assert.rejects(fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) }), error => error.cause?.code === 'CERT_REVOKED')
}
assert.equal((await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(10000) })).status, 204)
console.log('PASS: actual image Node rejects both affected chains and accepts valid TLS')

const browser = await createDefaultRenderEngine().openBrowser()
try {
  for (const host of [...affected, 'www.google.com']) {
    const page = await browser.newPage({ context: 'image-trust', logLevel: 'error', indent: false, pageIndex: 0, onLog: () => {} })
    try {
      const navigate = () => page.goto({ url: `https://${host}/`, timeout: 10000 })
      if (host === 'www.google.com') assert.equal((await navigate())?.status(), 200)
      else await assert.rejects(navigate(), /net::ERR_CERT_/)
    } finally {
      await page.close()
    }
  }
  console.log('PASS: actual compiled default Remotion engine rejects both affected chains and accepts valid TLS')
} finally {
  await browser.close({ silent: true })
}

// Start the actual image entrypoint with synthetic configuration and local
// scratch paths. Invalid jobs stop before admission; no render or S3 call runs.
const scratch = mkdtempSync('/tmp/devotional-image-')
const child = spawn(process.execPath, ['dist/server.js'], {
  stdio: 'ignore',
  env: {
    PATH: process.env.PATH,
    HOME: '/root',
    NODE_ENV: 'production',
    PORT: '3312',
    SHORTS_WORKER_API_KEYS: 'image-fixture-key',
    RAILWAY_S3_ENDPOINT: 'https://storage.audit.invalid',
    RAILWAY_S3_REGION: 'us-east-1',
    RAILWAY_S3_BUCKET: 'image-fixture',
    RAILWAY_S3_ACCESS_KEY_ID: 'synthetic-access-key',
    RAILWAY_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
    AWS_EC2_METADATA_DISABLED: 'true',
    DEVOTIONAL_WORKSPACE_CAPABILITY_ORIGIN: 'https://storage.audit.invalid',
    DEVOTIONAL_WORKSPACE_LOCAL_DIR: scratch + '/workspace',
    SHORTS_WORKER_LOCAL_ARTIFACTS_DIR: scratch + '/artifacts',
    SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR: '/app/devotional-bundle',
  },
})
try {
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.equal(child.exitCode, null, 'Production image exited before readiness')
    try {
      const response = await fetch('http://127.0.0.1:3312/health', { signal: AbortSignal.timeout(500) })
      ready = response.status === 200 && (await response.json()).ok === true
    } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, 'Production image never became ready')
  for (const [authorization, status] of [[undefined, 401], ['Bearer wrong-key', 401], ['Bearer image-fixture-key', 404]]) {
    const response = await fetch('http://127.0.0.1:3312/jobs/00000000-0000-4000-8000-000000000000', { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(2000) })
    assert.equal(response.status, status)
    await response.body?.cancel()
  }
  for (const kind of ['prepare', 'render']) {
    const response = await fetch('http://127.0.0.1:3312/jobs', { method: 'POST', headers: { authorization: 'Bearer image-fixture-key', 'content-type': 'application/json' }, body: JSON.stringify({ kind }), signal: AbortSignal.timeout(2000) })
    assert.equal(response.status, 400)
    await response.body?.cancel()
  }
  console.log('PASS: production entrypoint health, bearer guards, absent job and retired-kind rejection without job admission')
} finally {
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve([child.exitCode])
    : once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
  try {
    const [code] = await exited
    assert.equal(code, 0, 'Production image did not drain cleanly')
  } finally {
    clearTimeout(timer)
    rmSync(scratch, { recursive: true, force: true })
  }
}
JS
