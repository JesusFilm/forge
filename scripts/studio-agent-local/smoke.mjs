/** Infrastructure probe, NOT real-client/portable-skill qualification. No human approval. */
import { readFile, appendFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as wait } from "node:timers/promises"
import assert from "node:assert/strict"
const output = process.argv[2]
const fixture = JSON.parse(
  await readFile(join(output, "seed-result.json"), "utf8"),
)
const token = (await readFile(join(output, "token"), "utf8")).trim()
const config = JSON.parse(
  await readFile(join(output, "environment.json"), "utf8"),
)
assert.equal(
  config.DATABASE_URL,
  "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification",
)
assert.equal(config.STUDIO_MCP_AUDIENCE, "http://127.0.0.1:55483/mcp")
async function call(name, args) {
  const response = await fetch(config.STUDIO_MCP_AUDIENCE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(100000),
  })
  const value = await response.json()
  await appendFile(
    join(output, "infrastructure-smoke.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      name,
      status: response.status,
      value,
    }) + "\n",
    { mode: 0o600 },
  )
  assert.ok(
    response.ok && !value.error && !value.result?.isError,
    JSON.stringify(value),
  )
  if (name === "shorts.inspect")
    assert.ok(
      value.result.content.some((item) => item.type === "image"),
      "No usable rendered images returned",
    )
  return value.result.structuredContent.result ?? value.result.structuredContent
}
await call("shorts.search", { search: "Hope", language: "en" })
await call("shorts.assets", {})
const source = await call("shorts.capture", {
  videoId: fixture.videoId,
  dubId: fixture.dubId,
  editionId: fixture.editionId,
  trackId: fixture.trackId,
  downloadId: fixture.downloadId,
  language: "en",
  startMs: 0,
  endMs: 10000,
  retainOriginalBytes: false,
  idempotencyKey: randomUUID(),
})
const projectId = `infrastructure-${randomUUID()}`
await writeFile(join(output, "smoke-project"), projectId)
await call("shorts.create", {
  projectId,
  expectedRevision: 0,
  idempotencyKey: randomUUID(),
  document: {
    version: 1,
    title: "Infrastructure probe, synthetic speech tone",
    language: "en",
    runtimeVersion:
      "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    tracks: [
      { id: "visual", kind: "visual" },
      { id: "caption", kind: "caption" },
    ],
    components: [],
    packRevisionIds: [],
    items: [
      {
        id: "footage",
        kind: "video",
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 300,
        volume: 0,
        source: source.source,
      },
      {
        id: "title",
        kind: "text",
        trackId: "caption",
        startFrame: 0,
        durationInFrames: 300,
        text: "A moment of hope",
        properties: { fontSize: 72, color: "#ffffff" },
        speech: {
          text: "A moment of hope",
          role: "narration",
          suppressed: false,
          voice: fixture.voice,
          provider: "elevenlabs",
          model: "eleven_multilingual_v2",
          settings: {},
          pronunciation: null,
        },
      },
    ],
  },
})
await call("shorts.narrate", {
  projectId,
  expectedRevision: 1,
  idempotencyKey: randomUUID(),
})
let project
for (let i = 0; i < 30; i++) {
  project = await call("shorts.read", { projectId })
  if (project.revision > 1) break
  await wait(1000)
}
assert.ok(project.revision > 1, "Actual Next after() narration did not attach")
const admitted = await call("shorts.renderRequest", {
  projectId,
  expectedRevision: project.revision,
  idempotencyKey: randomUUID(),
})
const attemptId = admitted.attemptId
assert.ok(attemptId)
console.log(`Infrastructure render admitted: ${attemptId}`)
let status
for (let i = 0; i < 450; i++) {
  status = await call("shorts.renderStatus", { projectId, attemptId })
  if (["SUCCEEDED", "FAILED", "CANCELLED", "STALE"].includes(status.status))
    break
  await wait(2000)
}
assert.equal(status.status, "SUCCEEDED", JSON.stringify(status))
const inspected = await call("shorts.inspect", { projectId, attemptId })
await writeFile(
  join(output, "infrastructure-result.json"),
  JSON.stringify({ projectId, attemptId, status, inspected }, null, 2),
  { mode: 0o600 },
)
console.log(
  "Real Next narration, canonical source preparation, contained render and inspection completed; this is transport infrastructure proof only.",
)
