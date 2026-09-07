import { verifyOutput } from "./verify-output.js"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bundle } from "@remotion/bundler"
import { ensureBrowser } from "@remotion/renderer"
import { exampleManifest } from "@forge/shorts-compositions/studio-proof/example"
import {
  executeIsolated,
  browserDirectory,
  proofChildPath,
} from "../../src/studio-proof/isolate.js"
import { sha256, verifyBrokerInput } from "../../src/studio-proof/broker.js"
import { previewProof } from "./preview.js"

const out = resolve(process.argv[2] ?? "/tmp/forge-studio-proof")
await mkdir(out, { recursive: true })
const browser = await ensureBrowser()
assert("path" in browser, "Chromium must be installed before isolation")
const browserDir = browserDirectory(browser.path)
const bundleDir = join(out, "bundle")
const started = performance.now()
await bundle({
  entryPoint: fileURLToPath(
    import.meta.resolve("@forge/shorts-compositions/studio-proof/entry"),
  ),
  outDir: bundleDir,
})
const bundleMs = performance.now() - started
// Remotion's bundled ffmpeg includes the codecs needed by this synthetic test.
const ffmpeg = process.argv[3]
assert(ffmpeg, "Third argument must be an ffmpeg executable path")
execFileSync(
  ffmpeg,
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-c:a",
    "aac",
    join(out, "source.mp4"),
  ],
  { stdio: "pipe" },
)
await mkdir(join(out, "media"), { recursive: true })
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    join(out, "source.mp4"),
    "-vf",
    "scale=320:180",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-c:a",
    "aac",
    "-hls_time",
    "1",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    join(out, "media", "segment-%d.ts"),
    join(out, "media", "preview.m3u8"),
  ],
  { stdio: "pipe" },
)
const manifest = structuredClone(exampleManifest)
const segmentNames = (
  await readFile(join(out, "media", "preview.m3u8"), "utf8")
)
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
const segments = Object.fromEntries(
  await Promise.all(
    segmentNames.map(async (name) => [
      name,
      await readFile(join(out, "media", name)),
    ]),
  ),
)
const bytes = {
  segments,
  preview: await readFile(join(out, "media", "preview.m3u8")),
  export: await readFile(join(out, "source.mp4")),
  subtitle: Buffer.from(JSON.stringify(manifest.asset.subtitle.cues)),
}
manifest.asset.previewDigest = sha256(bytes.preview)
manifest.asset.previewSegments = segmentNames.map((name) => ({
  name,
  digest: sha256(segments[name]!),
  size: segments[name]!.length,
}))
manifest.asset.exportDigest = sha256(bytes.export)
manifest.asset.subtitle.digest = sha256(bytes.subtitle)
const selection = {
  ...manifest.asset,
  subtitleTrackId: manifest.asset.subtitle.trackId,
  subtitleEditionId: manifest.asset.subtitle.editionId,
  subtitleLanguageSlug: manifest.asset.subtitle.languageSlug,
  eligible: true,
}
const verified = verifyBrokerInput(manifest, selection, bytes)
await writeFile(join(out, "manifest.json"), JSON.stringify(verified.manifest))
await writeFile(
  join(out, "input.json"),
  JSON.stringify({ manifest: verified.manifest }),
)
await executeIsolated({ jobDir: out, browserDir, script: proofChildPath })
const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"))
assert.deepEqual(result.environmentKeys, ["HOME", "PATH", "PWD"])
const probes: Record<string, unknown> = {}
// A real OS probe cannot use host networking, home files, or parent env.
const probeScript = join(out, "probe.mjs")
await writeFile(
  probeScript,
  `import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.env.STUDIO_PARENT_SECRET, undefined);
assert.equal(fs.existsSync(${JSON.stringify(process.cwd())}), false);
assert.equal(fs.existsSync('/home'), false);
await assert.rejects(fetch('http://169.254.169.254/', {signal: AbortSignal.timeout(1000)}));
await assert.rejects(fetch('https://example.com', {signal: AbortSignal.timeout(1000)}));
console.log('filesystem, environment and network denied');`,
)
process.env.STUDIO_PARENT_SECRET = "sentinel-not-a-real-credential"
probes.os = await executeIsolated({
  jobDir: out,
  browserDir,
  script: probeScript,
})
delete process.env.STUDIO_PARENT_SECRET
await writeFile(
  probeScript,
  `while(true) process.stdout.write("x".repeat(65536));`,
)
const floodStart = performance.now()
await assert.rejects(
  executeIsolated({
    jobDir: out,
    browserDir,
    script: probeScript,
    timeoutMs: 5000,
  }),
  /output limit/,
)
probes.outputFlood = { rejectedMs: performance.now() - floodStart }
for (const [name, source] of Object.entries({
  compile: "export default function {",
  dependency: 'import fs from "node:fs"; export default () => <div>{fs}</div>',
  thrown: 'export default () => { throw new Error("fixture failure") }',
  infinite: "export default () => { while (true) {} }",
})) {
  const attempt = join(out, name)
  await mkdir(attempt, { recursive: true })
  await cp(bundleDir, join(attempt, "bundle"), { recursive: true })
  await writeFile(
    join(attempt, "input.json"),
    JSON.stringify({ manifest: { ...manifest, source }, noMedia: true }),
  )
  const start = performance.now()
  await assert.rejects(
    executeIsolated({
      jobDir: attempt,
      browserDir,
      script: proofChildPath,
      timeoutMs: name === "infinite" ? 5000 : 15_000,
    }),
  )
  probes[name] = { rejectedMs: performance.now() - start }
}
const preview = await previewProof({
  out,
  browserPath: process.argv[4] ?? "/usr/bin/google-chrome",
  manifest,
})
const editedDir = join(out, "edited")
await mkdir(editedDir, { recursive: true })
await cp(bundleDir, join(editedDir, "bundle"), { recursive: true })
await cp(join(out, "source.mp4"), join(editedDir, "source.mp4"))
await writeFile(
  join(editedDir, "input.json"),
  JSON.stringify({ manifest: preview.editedManifest }),
)
await executeIsolated({ jobDir: editedDir, browserDir, script: proofChildPath })
const editedRender = JSON.parse(
  await readFile(join(editedDir, "result.json"), "utf8"),
)
const bundleFiles = await readdir(bundleDir)
const report = {
  fixture: "synthetic mechanics only; Forge source acceptance still required",
  identity: verified.identity,
  encodedOutput: await verifyOutput(ffmpeg, join(out, "output.mp4")),
  bundleMs,
  bundleFiles,
  render: result,
  editedRender,
  editedEncodedOutput: await verifyOutput(
    ffmpeg,
    join(editedDir, "output.mp4"),
  ),
  probes,
  preview,
  gate: "Synthetic mechanics passed; combine with forge.ts evidence and deployment prerequisites",
}
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
