import { createRequire } from "node:module"
import { resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
const worker = createRequire(resolve("apps/shorts-worker/package.json"))
const admin = createRequire(resolve("apps/admin/package.json"))
const { bundle } = worker("@remotion/bundler")
const { selectComposition, renderStill, renderMedia } =
  worker("@remotion/renderer")
const sharp = admin("sharp")
const serveUrl = await bundle({
  entryPoint: resolve("packages/shorts-compositions/src/studio/entry.tsx"),
})
const ref = { assetId: "fixture", versionId: "v1", digest: "a".repeat(64) }
const samples = []
await mkdir(".tmp/studio-editor-feedback", { recursive: true })
for (const playbackRate of [0.5, 1, 2]) {
  const durationInFrames = Math.round(60 / playbackRate)
  const inputProps = {
    mode: "render",
    mediaBaseUrl: "http://127.0.0.1:4180/media/",
    input: {
      code: {},
      media: { film: { file: "source.mp4", sourceStartMs: 0, kind: "hls" } },
      document: {
        version: 1,
        title: "Speed",
        language: "english",
        runtimeVersion: "studio-proof-1",
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames,
        tracks: [{ id: "video", kind: "visual" }],
        components: [],
        packRevisionIds: [],
        items: [
          {
            id: "film",
            kind: "video",
            trackId: "video",
            startFrame: 0,
            durationInFrames,
            playbackRate,
            volume: 0,
            source: {
              videoId: "fixture",
              dubId: "dub",
              editionId: "edition",
              language: "english",
              preview: ref,
              export: ref,
              subtitle: null,
              startMs: 1000,
              endMs: 3000,
            },
          },
        ],
      },
    },
  }
  const composition = await selectComposition({
    serveUrl,
    id: "Studio",
    inputProps,
    browserExecutable: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  })
  const output = resolve(`.tmp/studio-editor-feedback/rate-${playbackRate}.png`)
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame: 30 / playbackRate,
    output,
    browserExecutable: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  })
  const movie = resolve(`.tmp/studio-editor-feedback/rate-${playbackRate}.mp4`)
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation: movie,
    concurrency: 2,
    browserExecutable: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  })
  const rendererRequire = createRequire(
    worker.resolve("@remotion/renderer/package.json"),
  )
  const { dir } = rendererRequire("@remotion/compositor-linux-x64-gnu")
  const probe = JSON.parse(
    execFileSync(
      resolve(dir, "ffprobe"),
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=duration,nb_frames",
        "-of",
        "json",
        movie,
      ],
      { encoding: "utf8" },
    ),
  )
  const duration = Number(probe.streams[0].duration)
  if (
    Number(probe.streams[0].nb_frames) !== durationInFrames ||
    Math.abs(duration - 2 / playbackRate) > 0.01
  )
    throw new Error("Export duration does not match clip speed")
  const pixels = await sharp(output).raw().toBuffer()
  samples.push({
    playbackRate,
    duration,
    frame: 30 / playbackRate,
    digest: createHash("sha256").update(pixels).digest("hex"),
  })
}
console.log(JSON.stringify(samples, null, 2))
if (new Set(samples.map((s) => s.digest)).size !== 1)
  throw new Error("Speed exports sampled different source frames")
console.log(
  "PASS: 0.5x, 1x and 2x exports sample the same source frame at equivalent source times",
)
