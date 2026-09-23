/** Run from repository root under the documented bounded systemd user scope.
 * No provider calls. Outputs go to an explicit private directory, never Git. */
import { mkdir, writeFile, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { executeStudioChild } from "../../../apps/studio-render/src/isolation.mjs"
import {
  currentCgroupDirectory,
  verifyExecutionBudget,
} from "../../../apps/studio-render/src/budget.mjs"
import inspection from "../../../apps/manager/src/services/studio-inspection-output.ts"
const { extractStudioInspection } = inspection
const out = process.env.STUDIO_INSPECTION_FIXTURE_DIR
const codec = process.env.STUDIO_CODEC_DIR
const browser = process.env.STUDIO_INSPECTION_BROWSER
assert.ok(
  out && codec && browser,
  "Explicit local output/codec/browser paths required",
)
console.log(
  "containment",
  await verifyExecutionBudget(await currentCgroupDirectory()),
)
await mkdir(out, { recursive: true })
const required = createRequire(resolve("apps/shorts-worker/package.json"))
await required("@remotion/bundler").bundle({
  entryPoint: resolve("packages/shorts-compositions/src/studio/entry.tsx"),
  outDir: join(out, "bundle"),
})
const deps = await realpath("node_modules")
const runtimeVersion =
  "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16"
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const results = []
for (const name of process.env.STUDIO_INSPECTION_FIXTURE_NAMES?.split(",") ?? [
  "clean",
  "authored-gap",
  "overflow-text",
  "black-cut",
  "silent-audio",
  "representative-30s",
]) {
  const total = name === "representative-30s" ? 900 : 120,
    cut = total / 2,
    seconds = total / 30
  const dir = join(out, name)
  await mkdir(dir, { recursive: true })
  const ffmpeg = (args) =>
    execFileSync(
      join(codec, "ffmpeg"),
      ["-y", "-v", "error", "-nostdin", "-threads", "1", ...args],
      { timeout: 10000 },
    )
  for (const color of ["blue", "red", "black"])
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=${color}:s=320x180`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      join(dir, `${color}.png`),
    ])
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    name === "silent-audio"
      ? "anullsrc=r=48000:cl=mono"
      : `sine=frequency=880:sample_rate=48000:duration=${seconds}`,
    "-t",
    String(seconds),
    join(dir, "audio.wav"),
  ])
  const ref = {
    assetId: "fixture",
    versionId: "fixture-v1",
    digest: "a".repeat(64),
  }
  const visual = (id, startFrame, durationInFrames) => ({
    id,
    kind: "image",
    trackId: "visual",
    startFrame,
    durationInFrames,
    asset: ref,
  })
  const items = [
    visual("first", 0, name === "authored-gap" ? 30 : cut),
    visual("second", cut, cut),
    {
      id: "voice",
      kind: "audio",
      trackId: "voice",
      startFrame: 0,
      durationInFrames: total,
      asset: ref,
      sourceStartMs: 0,
      volume: 1,
    },
  ]
  if (name === "overflow-text")
    items.push({
      id: "text",
      kind: "text",
      trackId: "caption",
      startFrame: 0,
      durationInFrames: total,
      text: "Unusually long overflowing text ".repeat(30),
      properties: { fontSize: 100, color: "#ffffff" },
    })
  const document = {
    version: 1,
    title: name,
    language: "en",
    runtimeVersion,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: total,
    tracks: [
      { id: "visual", kind: "visual" },
      { id: "caption", kind: "caption" },
      { id: "voice", kind: "audio" },
    ],
    items,
    components: [],
    packRevisionIds: [],
  }
  const input = {
    document,
    media: {
      first: { file: "blue.png", sourceStartMs: 0, kind: "image" },
      second: {
        file: name === "black-cut" ? "black.png" : "red.png",
        sourceStartMs: 0,
        kind: "image",
      },
      voice: { file: "audio.wav", sourceStartMs: 0, kind: "audio" },
    },
    code: {},
  }
  await writeFile(join(dir, "input.json"), JSON.stringify(input))
  const started = Date.now()
  const bytes = await executeStudioChild({
    nativeDir: resolve("apps/studio-render/dist"),
    child: resolve("apps/studio-render/src/child.mjs"),
    node: process.execPath,
    input: dir,
    bundle: join(out, "bundle"),
    dependencies: deps,
    browser,
    codec,
    renderer: required.resolve("@remotion/renderer").replace(deps, "/deps"),
    timeoutMs: 60000,
  })
  const renderMs = Date.now() - started,
    outputReadyAt = new Date().toISOString()
  await writeFile(join(dir, "render.mp4"), bytes)
  const evidence = await extractStudioInspection(
    {
      projectId: `fixture-${name}`,
      attemptId: `render-${name}`,
      revision: 1,
      currentRevision: 1,
      stale: false,
      inputHash: hash(Buffer.from(JSON.stringify(document))),
      output: { ...ref, digest: hash(bytes) },
      document,
      outputReadyAt,
      evidence: null,
    },
    bytes,
    { ffmpeg: join(codec, "ffmpeg"), ffprobe: join(codec, "ffprobe") },
  )
  await writeFile(join(dir, "evidence.json"), JSON.stringify(evidence, null, 2))
  await writeFile(join(dir, "document.json"), JSON.stringify(document, null, 2))
  for (let n = 0; n < evidence.samples.length; n++)
    await writeFile(
      join(dir, `sample-${n}.jpg`),
      Buffer.from(evidence.samples[n].image.data, "base64"),
    )
  assert.equal(evidence.status, "sampled")
  const codes = evidence.findings.map((f) => f.code)
  if (name === "clean" || name === "representative-30s")
    assert.deepEqual(codes, [])
  if (name === "authored-gap") {
    assert.ok(codes.includes("authored-gap"))
    assert.ok(!codes.includes("sampled-black"))
  }
  if (name === "overflow-text")
    assert.ok(codes.includes("potential-text-overflow"))
  if (name === "black-cut") assert.ok(codes.includes("sampled-black"))
  if (name === "silent-audio") assert.ok(codes.includes("audio-silence"))
  results.push({
    fixture: name,
    durationMs: evidence.durationMs,
    cutCount: evidence.coverage.cutCount,
    renderMs,
    preparationMs: evidence.preparationMs,
    samples: evidence.samples.length,
    outputDigest: evidence.output.digest,
    evidenceBytes: Buffer.byteLength(JSON.stringify(evidence)),
    findings: codes,
    toolchain: evidence.toolchain,
    clientReasoningMs: null,
    repairRenderMs: null,
  })
  console.log(JSON.stringify(results.at(-1)))
}
await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2))
