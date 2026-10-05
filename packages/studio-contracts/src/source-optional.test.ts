import { expect, it } from "vitest"
import { studioSourceSchema, studioDocumentSchema } from "./index"
import { studioCaptureSourceSchema } from "./sources"
const ref = { assetId: "media", versionId: "v1", digest: "a".repeat(64) }
const source = {
  videoId: "6_GOLuke2611",
  dubId: "dub",
  editionId: "edition",
  language: "english",
  subtitle: null,
  preview: ref,
  export: ref,
  startMs: 0,
  endMs: 1000,
}
it("captures exact downloadable footage without inventing subtitle identity", () => {
  expect(
    studioCaptureSourceSchema.parse({
      videoId: source.videoId,
      dubId: "dub",
      editionId: "edition",
      language: "english",
      trackId: null,
      downloadId: "download",
      startMs: 0,
      endMs: 1000,
      idempotencyKey: "capture",
    }).trackId,
  ).toBeNull()
  expect(studioSourceSchema.parse(source).subtitle).toBeNull()
})
it("authors and trims subtitle-free footage with a bounded source focus", () => {
  const doc = {
    version: 1,
    runtimeVersion: "v1",
    title: "LUMO",
    language: "english",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 30,
    components: [],
    packRevisionIds: [],
    tracks: [{ id: "video", kind: "visual" }],
    items: [
      {
        id: "clip",
        trackId: "video",
        kind: "video",
        startFrame: 0,
        durationInFrames: 30,
        source,
        volume: 1,
        focus: { x: 0, y: 1 },
      },
    ],
  }
  expect(studioDocumentSchema.safeParse(doc).success).toBe(true)
  expect(
    studioDocumentSchema.safeParse({
      ...doc,
      items: [{ ...doc.items[0], focus: { x: 1.1, y: 0.5 } }],
    }).success,
  ).toBe(false)
})
