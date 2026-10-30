import { expect, it } from "vitest"
import type { StudioPreview } from "@forge/studio-contracts/preview"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { pausedFootageFrame } from "./preview-pause"
const ref = { assetId: "fixture", versionId: "v1", digest: "a".repeat(64) }
const input: StudioPreview = {
  code: {},
  media: { clip: { file: "clip.m3u8", kind: "hls", sourceStartMs: 4000 } },
  document: studioDocumentSchema.parse({
    version: 1,
    title: "Pause",
    language: "en",
    runtimeVersion: "v1",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 300,
    tracks: [{ id: "visual", kind: "visual" }],
    components: [],
    items: [
      {
        id: "clip",
        kind: "video",
        trackId: "visual",
        startFrame: 30,
        durationInFrames: 120,
        volume: 1,
        playbackRate: 2,
        source: {
          videoId: "video",
          dubId: "dub",
          editionId: "edition",
          language: "en",
          subtitle: null,
          preview: ref,
          export: ref,
          startMs: 5000,
          endMs: 13000,
        },
      },
    ],
  }),
}
it("preserves footage time with source offsets, timeline placement and speed", () => {
  expect(pausedFootageFrame(input, 50, () => 2.46)).toBe(51)
  expect(pausedFootageFrame(input, 50, () => 2.2)).toBe(48)
})
it("ignores premounted footage and unavailable media, clamps to active clip", () => {
  expect(pausedFootageFrame(input, 20, () => 2.46)).toBe(20)
  expect(pausedFootageFrame(input, 50, () => undefined)).toBe(50)
  expect(pausedFootageFrame(input, 50, () => NaN)).toBe(50)
  expect(pausedFootageFrame(input, 50, () => 0)).toBe(30)
  expect(pausedFootageFrame(input, 50, () => 100)).toBe(149)
})
it("chooses the visible top track in composition paint order", () => {
  const clip = input.document.items[0]!
  const layered: StudioPreview = {
    ...input,
    media: { ...input.media, upper: input.media.clip },
    document: {
      ...input.document,
      tracks: [
        { id: "visual", kind: "visual" },
        { id: "upper", kind: "visual" },
      ],
      items: [{ ...clip, id: "upper", trackId: "upper" }, clip],
    },
  }
  expect(
    pausedFootageFrame(layered, 50, (id) => (id === "upper" ? 2.46 : 2.2)),
  ).toBe(51)
  layered.document.items[0] = {
    ...layered.document.items[0]!,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0 },
  }
  expect(
    pausedFootageFrame(layered, 50, (id) => (id === "upper" ? 2.46 : 2.2)),
  ).toBe(48)
})
