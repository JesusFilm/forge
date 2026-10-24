import { createRequire } from "node:module"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
import { writeFile, mkdir } from "node:fs/promises"
const require = createRequire(resolve(repo, "apps/shorts-worker/package.json"))
const { bundle } = require("@remotion/bundler")
const {
  ensureBrowser,
  selectComposition,
  renderMedia,
  renderStill,
} = require("@remotion/renderer")
const ref = { assetId: "fixture", versionId: "v1", digest: "0".repeat(64) }
const document = {
  version: 1,
  title: "Studio feedback export QA",
  language: "english",
  runtimeVersion: "studio-proof-1",
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 390,
  tracks: [
    { id: "video", kind: "visual" },
    { id: "text", kind: "caption" },
  ],
  components: [],
  packRevisionIds: [],
  items: [0, 1, 2, 3].map((i) => ({
    id: "v" + i,
    kind: "video",
    trackId: "video",
    startFrame: i * 90,
    durationInFrames: i === 3 ? 120 : 90,
    volume: 0,
    source: {
      videoId: "fixture",
      dubId: "dub",
      editionId: "edition",
      language: "english",
      subtitle: {
        trackId: "sub",
        editionId: "edition",
        language: "english",
        asset: ref,
      },
      preview: ref,
      export: ref,
      startMs: i * 4000,
      endMs: i * 4000 + (i === 3 ? 4000 : 3000),
    },
    ...(i === 1
      ? { transition: { type: "crossfade", durationInFrames: 12 } }
      : {}),
  })),
}
document.items.push(
  ...["Inter", "Montserrat", "Apercu"].map((fontFamily, i) => ({
    id: "text" + i,
    kind: "text",
    trackId: "text",
    startFrame: i * 90,
    durationInFrames: 90,
    text: "Can being right\nbecome a trap?",
    properties: {
      fontFamily,
      fontWeight: 500,
      fontSize: 20,
      shadow: true,
      strokeWidth: 1,
      scrimOpacity: 0.6,
      scrimPadding: 8,
      entrance: "slide",
      exit: "fade",
      entranceFrames: 9,
      exitFrames: 9,
    },
  })),
)
const inputProps = {
  input: {
    document,
    code: {},
    media: Object.fromEntries(
      document.items
        .filter((i) => i.kind === "video")
        .map((i) => [
          i.id,
          { file: "source.mp4", sourceStartMs: 0, kind: "hls" },
        ]),
    ),
  },
  mode: "render",
  mediaBaseUrl: "http://127.0.0.1:4179/media/",
}
await mkdir(resolve(repo, ".tmp/studio-feedback/artifacts"), {
  recursive: true,
})
await writeFile(
  resolve(repo, ".tmp/studio-feedback/artifacts/input.json"),
  JSON.stringify(inputProps, null, 2),
)
await ensureBrowser()
const serveUrl = await bundle({
  entryPoint: resolve(
    repo,
    "packages/shorts-compositions/src/studio/entry.tsx",
  ),
})
const composition = await selectComposition({
  serveUrl,
  id: "Studio",
  inputProps,
})
await renderMedia({
  serveUrl,
  composition,
  inputProps,
  codec: "h264",
  outputLocation: resolve(repo, ".tmp/studio-feedback/artifacts/feedback.mp4"),
  concurrency: 2,
})
for (const frame of [15, 84, 90, 105, 195])
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame,
    output: resolve(repo, `.tmp/studio-feedback/artifacts/frame-${frame}.png`),
  })
console.log("Rendered 390 frames and five QA stills")
