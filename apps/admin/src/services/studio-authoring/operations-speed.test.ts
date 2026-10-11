import { expect, it } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { applyOperations } from "./operations"
it("trims a slowed clip using source time while preserving its playback rate", () => {
  const document = studioDocumentSchema.parse({
    version: 1,
    title: "Slow film",
    language: "en",
    runtimeVersion: "fixture",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    tracks: [{ id: "main", kind: "visual" }],
    packRevisionIds: [],
    components: [],
    items: [
      {
        id: "film",
        kind: "video",
        trackId: "main",
        startFrame: 0,
        durationInFrames: 300,
        playbackRate: 0.5,
        volume: 0,
        source: {
          videoId: "film",
          dubId: "dub",
          editionId: "edition",
          language: "en",
          startMs: 0,
          endMs: 5000,
          preview: {
            assetId: "source",
            versionId: "v1",
            digest: "a".repeat(64),
          },
          export: {
            assetId: "source",
            versionId: "v1",
            digest: "a".repeat(64),
          },
          subtitle: null,
        },
      },
    ],
  })
  const changed = applyOperations(document, [
    { kind: "trim-source", itemId: "film", startMs: 1000, endMs: 4000 },
  ])
  expect(changed.items[0]).toMatchObject({
    playbackRate: 0.5,
    durationInFrames: 180,
    source: { startMs: 1000, endMs: 4000 },
  })
  expect(document.items[0]?.durationInFrames).toBe(300)
})
