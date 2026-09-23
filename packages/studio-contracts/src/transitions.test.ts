import { expect, it } from "vitest"
import { studioDocumentSchema } from "./index"
import {
  studioCuts,
  studioMediaStartTimes,
  transitionPresentation,
} from "./transitions"

const asset = { assetId: "asset", versionId: "v1", digest: "a".repeat(64) }
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Cuts",
  language: "en",
  runtimeVersion: "fixture",
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 180,
  tracks: [{ id: "video", kind: "visual" }],
  components: [],
  packRevisionIds: [],
  items: [0, 1].map((i) => ({
    id: `v${i}`,
    kind: "video",
    trackId: "video",
    startFrame: i * 90,
    durationInFrames: 90,
    volume: 1,
    source: {
      videoId: "source",
      dubId: "dub",
      editionId: "edition",
      language: "en",
      preview: asset,
      export: asset,
      subtitle: { trackId: "sub", editionId: "edition", language: "en", asset },
      startMs: i * 4000,
      endMs: i * 4000 + 3000,
    },
    ...(i === 1
      ? { transition: { type: "crossfade", durationInFrames: 12 } }
      : {}),
  })),
})

it("crossfades using retained pre-roll without moving source trims, clips, or audio", () => {
  const before = structuredClone(document)
  const cuts = studioCuts(document)
  expect(cuts).toEqual([
    {
      incomingId: "v1",
      outgoingId: "v0",
      type: "crossfade",
      frames: 12,
      cutFrame: 90,
      incomingOnTop: true,
    },
  ])
  expect(studioMediaStartTimes(document).get("v1")).toBe(3600)
  expect(transitionPresentation(cuts, "v1", 78)).toEqual({
    opacity: 0,
    brightness: 1,
    preRoll: 12,
  })
  expect(transitionPresentation(cuts, "v1", 84).opacity).toBe(0.5)
  expect(transitionPresentation(cuts, "v1", 90).opacity).toBe(1)
  expect(transitionPresentation(cuts, "v0", 84).opacity).toBe(1)
  expect(document).toEqual(before)
})

it("respects persisted compositing order even if incoming video was inserted first", () => {
  const reversed = { ...document, items: [...document.items].reverse() }
  const cuts = studioCuts(reversed)
  expect(transitionPresentation(cuts, "v1", 84).opacity).toBe(1)
  expect(transitionPresentation(cuts, "v0", 84).opacity).toBe(0.5)
})

it("does not crossfade beyond source start or across gaps and ambiguous stacked footage", () => {
  const noHandle = structuredClone(document)
  const item = noHandle.items[1]!
  if (item.kind !== "video") throw new Error("Video fixture required")
  item.source.startMs = 0
  item.source.endMs = 3000
  expect(studioCuts(noHandle)).toEqual([])
  item.source.startMs = 100
  item.source.endMs = 3100
  expect(studioCuts(noHandle)[0]?.frames).toBe(3)
  item.startFrame++
  expect(studioCuts(noHandle)).toEqual([])
  const stacked = {
    ...document,
    items: [...document.items, { ...document.items[0]!, id: "stacked" }],
  }
  expect(studioCuts(stacked)).toEqual([])
})

it("offers a fade through black without extra source footage", () => {
  const faded = structuredClone(document)
  const item = faded.items[1]!
  if (item.kind !== "video") throw new Error("Video fixture required")
  item.transition = { type: "fade-black", durationInFrames: 12 }
  const cuts = studioCuts(faded)
  expect(studioMediaStartTimes(faded).get("v1")).toBe(4000)
  expect(transitionPresentation(cuts, "v0", 89).brightness).toBe(0)
  expect(transitionPresentation(cuts, "v1", 90).brightness).toBe(0)
  expect(transitionPresentation(cuts, "v1", 96).brightness).toBe(0.5)
  expect(transitionPresentation(cuts, "v1", 102).brightness).toBe(1)
})
