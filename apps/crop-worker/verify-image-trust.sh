#!/bin/sh
# CI only: public transport controls, local synthetic media and isolated HTTP.
set -eu
# Debian backports retain upstream 1.0.9; compare the security package revision.
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libbrotli1)" ge 1.0.9-2+deb12u1
printf '%s\n' 'PASS: system Brotli includes the CVE-2026-111497 Debian security fix'
cd /app/apps/crop-worker
node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { defaultRunCommand, probeSource, sourceTlsOptions } from './dist/ffmpeg.js'

assert.equal(process.version, 'v24.22.1')
const affected = ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']
for (const host of affected) {
  await assert.rejects(fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) }), error => error.cause?.code === 'CERT_REVOKED')
}
assert.equal((await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(10000) })).status, 204)
console.log('PASS: actual image Node rejects both affected chains and accepts valid TLS')
for (const host of [...affected, 'www.google.com']) {
  const url = `https://${host}/`
  const command = () => defaultRunCommand('ffmpeg', ['-v', 'error', ...sourceTlsOptions(url), '-protocol_whitelist', 'https,tls,tcp,crypto', '-f', 'data', '-i', url, '-map', '0:0', '-c', 'copy', '-f', 'data', 'pipe:1'], { timeoutMs: 15000 })
  if (host === 'www.google.com') assert((await command()).stdout.length > 0)
  else await assert.rejects(command(), /certificate.*verif|verif.*certificate/i)
}
console.log('PASS: actual compiled FFmpeg invocation rejects both affected chains and reads a valid TLS control')
// Also test the protocol default used by nested HLS reads in FFmpeg 7.1.
for (const host of [...affected, 'www.google.com']) {
  const command = () => defaultRunCommand('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'https,tls,tcp,crypto', '-f', 'data', '-i', `https://${host}/`, '-map', '0:0', '-c', 'copy', '-f', 'data', 'pipe:1'], { timeoutMs: 15000 })
  if (host === 'www.google.com') assert((await command()).stdout.length > 0)
  else await assert.rejects(command(), /certificate.*verif|verif.*certificate/i)
}
console.log('PASS: native FFmpeg protocol defaults reject both affected chains and accept valid TLS')

const scratch = mkdtempSync('/tmp/crop-image-')
let child
let mediaServer
try {
  const clip = scratch + '/synthetic.mp4'
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { encoding: 'utf8', timeout: 10000 })
  assert.equal(generated.status, 0, 'Synthetic FFmpeg encode failed')
  const info = await probeSource(clip, { protocolWhitelist: 'file', timeoutMs: 10000 })
  assert.equal(info.width, 64)
  assert.equal(info.height, 48)
  assert(info.durationSeconds > 0)
  console.log('PASS: actual image FFmpeg encode and compiled ffprobe adapter read local synthetic media')
  const segment = scratch + '/synthetic.ts'
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', clip, '-c', 'copy', '-f', 'mpegts', segment], { timeout: 10000 })
  assert.equal(converted.status, 0, 'Synthetic HLS segment conversion failed')
  mediaServer = createServer((request, response) => {
    if (request.url === '/segment.ts') {
      response.end(readFileSync(segment))
      return
    }
    const index = Number(request.url?.match(/^\/bad-(\d)\.m3u8$/)?.[1])
    const target = Number.isInteger(index) && affected[index] ? `https://${affected[index]}/segment.ts` : '/segment.ts'
    response.setHeader('content-type', 'application/vnd.apple.mpegurl')
    response.end(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:0.3,\n${target}\n#EXT-X-ENDLIST\n`)
  })
  mediaServer.listen(0, '127.0.0.1')
  await once(mediaServer, 'listening')
  const origin = `http://127.0.0.1:${mediaServer.address().port}`
  const hls = path => defaultRunCommand('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'http,https,tls,tcp,crypto', '-i', origin + path, '-f', 'null', '-'], { timeoutMs: 15000 })
  for (let index = 0; index < affected.length; index++) await assert.rejects(hls(`/bad-${index}.m3u8`), /certificate.*verif|verif.*certificate/i)
  await hls('/good.m3u8')
  console.log('PASS: actual HLS nested reads reject both affected TLS chains and decode local synthetic media')

  child = spawn(process.execPath, ['dist/server.js'], {
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      HOME: '/root',
      NODE_ENV: 'production',
      PORT: '3311',
      CROP_WORKER_API_KEYS: 'image-fixture-key',
      RAILWAY_S3_ENDPOINT: 'https://storage.audit.invalid',
      RAILWAY_S3_REGION: 'us-east-1',
      RAILWAY_S3_BUCKET: 'image-fixture',
      RAILWAY_S3_ACCESS_KEY_ID: 'synthetic-access-key',
      RAILWAY_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      AWS_EC2_METADATA_DISABLED: 'true',
      CROP_WORKER_LOCAL_ARTIFACTS_DIR: scratch + '/artifacts',
    },
  })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.equal(child.exitCode, null, 'Production image exited before readiness')
    try {
      const response = await fetch('http://127.0.0.1:3311/health', { signal: AbortSignal.timeout(500) })
      ready = response.status === 200 && (await response.json()).ok === true
    } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, 'Production image never became ready')
  for (const [authorization, status] of [[undefined, 401], ['Bearer wrong-key', 401], ['Bearer image-fixture-key', 404]]) {
    const response = await fetch('http://127.0.0.1:3311/jobs/wj_image_missing', { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(2000) })
    assert.equal(response.status, status)
    await response.body?.cancel()
  }
  const invalid = await fetch('http://127.0.0.1:3311/jobs', { method: 'POST', headers: { authorization: 'Bearer image-fixture-key', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'fingerprint' }), signal: AbortSignal.timeout(2000) })
  assert.equal(invalid.status, 400)
  await invalid.body?.cancel()
  console.log('PASS: production entrypoint health, bearer guards, absent job and invalid-body rejection before admission')
} finally {
  if (mediaServer) await new Promise(resolve => mediaServer.close(resolve))
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    try { await exited } finally { clearTimeout(timer) }
  }
  rmSync(scratch, { recursive: true, force: true })
}
JS
