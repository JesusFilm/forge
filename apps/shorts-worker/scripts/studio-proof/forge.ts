import { verifyOutput } from "./verify-output.js"
// Read-only public catalog proof. No environment credentials or paid generation.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { ensureBrowser } from "@remotion/renderer"
import { z } from "zod"
import { StudioProofError } from "@forge/shorts-compositions/studio-proof/manifest"
import { exampleManifest } from "@forge/shorts-compositions/studio-proof/example"
import { sha256, verifyBrokerInput } from "../../src/studio-proof/broker.js"
import { parseSourceVtt } from "../../src/studio-proof/subtitles.js"
import {
  executeIsolated,
  browserDirectory,
  proofChildPath,
} from "../../src/studio-proof/isolate.js"
import { previewProof } from "./preview.js"

const allowed = new Set([
  "admin.jesusfilm.org",
  "stream.mux.com",
  "api-media-core.jesusfilm.org",
  "manifest-gcp-us-east1-vop1.fastly.mux.com",
  "chunk-oci-us-ashburn-1-vop1.fastly.mux.com",
])
let downloadedBytes = 0
async function download(raw: string, init?: RequestInit): Promise<Buffer> {
  const url = new URL(raw)
  assert(
    url.protocol === "https:" &&
      allowed.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port,
    "Unapproved media host",
  )
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  assert(
    response.ok && response.body,
    `Read-only media request failed: ${response.status}`,
  )
  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      downloadedBytes += chunk.length
      assert(
        downloadedBytes <= 64 * 1_048_576,
        "Read-only proof download budget exhausted",
      )
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
const out = resolve(process.argv[2] ?? "/tmp/forge-studio-real")
await mkdir(join(out, "media"), { recursive: true })
await cp(
  resolve(process.argv[3] ?? "/tmp/forge-studio-proof/bundle"),
  join(out, "bundle"),
  { recursive: true },
)
const query = `{ videoBySlug(slug:"jesus") { id restrictViewPlatforms locales(locale:"en") { status } preferredPlayableDub(languageSlug:"english") { id videoId published hls language { slug } downloads { url height quality } videoEdition { id subtitles { id language { slug } aiGenerated primary vttSrc } } } } }`
const catalog = JSON.parse(
  (
    await download("https://admin.jesusfilm.org/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
  ).toString(),
)
const video = z
  .object({
    id: z.string(),
    restrictViewPlatforms: z.array(z.string()),
    locales: z.array(z.object({ status: z.string() })),
    preferredPlayableDub: z.object({
      id: z.string(),
      videoId: z.string(),
      published: z.literal(true),
      hls: z.string().url(),
      language: z.object({ slug: z.literal("english") }),
      downloads: z.array(
        z.object({
          url: z.string().url(),
          height: z.number(),
          quality: z.string(),
        }),
      ),
      videoEdition: z.object({
        id: z.string(),
        subtitles: z.array(
          z.object({
            id: z.string(),
            language: z.object({ slug: z.string() }),
            aiGenerated: z.boolean().nullable(),
            primary: z.boolean().nullable(),
            vttSrc: z.string().nullable(),
          }),
        ),
      }),
    }),
  })
  .parse(catalog.data?.videoBySlug)
assert(
  !video.restrictViewPlatforms.includes("watch") &&
    video.locales.some((l) => l.status === "PUBLISHED"),
  "Source is not eligible for Watch",
)
const dub = video.preferredPlayableDub
assert.equal(dub.videoId, video.id)
const track = dub.videoEdition.subtitles.find(
  (s) =>
    s.language.slug === "english" && s.primary && !s.aiGenerated && s.vttSrc,
)
assert(track?.vttSrc, "Exact canonical English subtitle track required")
const subtitleBytes = await download(track.vttSrc)
await writeFile(join(out, "source.vtt"), subtitleBytes)
const master = (await download(dub.hls)).toString()
const lines = master.split("\n")
const lowIndex = lines.findIndex((l) => l.includes("RESOLUTION=480x270"))
assert(lowIndex >= 0, "Explicit 270p HLS rendition required; no adaptive claim")
async function stageRendition(index: number, folder: string) {
  await mkdir(folder, { recursive: true })
  const lines = (await download(master.split("\n")[index + 1]!))
    .toString()
    .split("\n")
  assert(
    !lines.some((l) =>
      /#EXT-X-(KEY|MAP|BYTERANGE|DISCONTINUITY|MEDIA):/.test(l),
    ),
    "Unsupported HLS structure",
  )
  let elapsed = 0
  let count = 0
  const local = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ]
  const segments: Array<{ name: string; digest: string; bytes: number }> = []
  for (let i = 0; i < lines.length && elapsed < 35; i++) {
    if (!lines[i]!.startsWith("#EXTINF:")) continue
    const duration = Number(lines[i]!.slice(8).split(",")[0])
    assert(Number.isFinite(duration) && duration > 0 && duration <= 6)
    const body = await download(lines[i + 1]!)
    const name = `segment-${count++}.ts`
    await writeFile(join(folder, name), body)
    local.push(lines[i]!, name)
    segments.push({ name, digest: sha256(body), bytes: body.length })
    elapsed += duration
  }
  assert(elapsed >= 32)
  local.push("#EXT-X-ENDLIST")
  const playlist = Buffer.from(local.join("\n"))
  await writeFile(join(folder, "preview.m3u8"), playlist)
  return { playlist, segments }
}
const { playlist: previewBytes, segments } = await stageRendition(
  lowIndex,
  join(out, "media"),
)
const highIndex = lines.findIndex((l) => l.includes("RESOLUTION=1920x1080"))
assert(highIndex >= 0, "Exact dub 1080p rendition required")
const high = await stageRendition(highIndex, join(out, "export-media"))
const ffmpeg = process.argv[4]
assert(ffmpeg, "Fourth argument must be an ffmpeg executable path")
try {
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-i",
      join(out, "export-media", "preview.m3u8"),
      "-t",
      "32",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-fs",
      "67108864",
      join(out, "source.mp4"),
    ],
    { stdio: "pipe", timeout: 30_000, maxBuffer: 1_048_576 },
  )
} catch {
  throw new StudioProofError("Bounded exact-dub export prefix remux failed")
}
const manifest = structuredClone(exampleManifest)
manifest.props.title = "Forge exact English source"
manifest.componentVersion = "forge-proof-v1"
manifest.asset = {
  videoId: video.id,
  dubId: dub.id,
  editionId: dub.videoEdition.id,
  languageSlug: "english",
  previewDigest: sha256(previewBytes),
  previewSegments: segments.map((s) => ({
    name: s.name,
    digest: s.digest,
    size: s.bytes,
  })),
  exportDigest: sha256(await readFile(join(out, "source.mp4"))),
  trimStartMs: 28_600,
  trimEndMs: 30_600,
  subtitle: {
    trackId: track.id,
    editionId: dub.videoEdition.id,
    languageSlug: "english",
    digest: sha256(subtitleBytes),
    cues: parseSourceVtt(subtitleBytes, {
      startMs: 28_600,
      endMs: 30_600,
    }).filter((c) => c.endMs > 28_600 && c.startMs < 30_600),
  },
}
const verified = verifyBrokerInput(
  manifest,
  {
    ...manifest.asset,
    subtitleTrackId: track.id,
    subtitleEditionId: dub.videoEdition.id,
    subtitleLanguageSlug: "english",
    eligible: true,
  },
  {
    preview: previewBytes,
    export: await readFile(join(out, "source.mp4")),
    subtitle: subtitleBytes,
    segments: Object.fromEntries(
      await Promise.all(
        segments.map(async (s) => [
          s.name,
          await readFile(join(out, "media", s.name)),
        ]),
      ),
    ),
  },
)
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest))
await writeFile(join(out, "input.json"), JSON.stringify({ manifest }))
const browser = await ensureBrowser()
assert("path" in browser)
await executeIsolated({
  jobDir: out,
  browserDir: browserDirectory(browser.path),
  script: proofChildPath,
})
const preview = await previewProof({
  out,
  browserPath: process.argv[5] ?? "/usr/bin/google-chrome",
  manifest,
})
const report = {
  fixture:
    "Forge JESUS / exact English dub and edition / canonical primary non-AI VTT",
  identity: verified.identity,
  encodedOutput: await verifyOutput(ffmpeg, join(out, "output.mp4")),
  source: manifest.asset,
  downloadedBytes,
  segments,
  exportSegments: high.segments,
  previewRendition: "480x270, fixed selected variant; no adaptive claim",
  exportRendition:
    "1920x1080 exact-dub HLS rendition, first 32s remuxed to source time zero",
  render: JSON.parse(await readFile(join(out, "result.json"), "utf8")),
  preview,
  gate: "Local runtime proof passed; separate credential-free execution service and distinct-site preview required before release",
}
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
