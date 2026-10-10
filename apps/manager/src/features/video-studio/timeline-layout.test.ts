import { expect, it } from "vitest"
import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"
import { timelineRows } from "./timeline-layout"

const text = (id: string, startFrame: number): StudioTimelineItem => ({
  id,
  kind: "text",
  trackId: "mixed",
  startFrame,
  durationInFrames: 30,
  text: id,
  properties: {},
})
const document: StudioDocument = {
  version: 1,
  title: "Legacy mixed tracks",
  language: "en",
  runtimeVersion: "fixture",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  tracks: [
    { id: "mixed", kind: "visual" },
    { id: "audio", kind: "audio" },
  ],
  packRevisionIds: [],
  components: [],
  items: [
    text("first", 0),
    text("overlap", 15),
    text("next", 30),
    {
      id: "image",
      kind: "image",
      trackId: "mixed",
      startFrame: 0,
      durationInFrames: 90,
      asset: { assetId: "image", versionId: "v1", digest: "a".repeat(64) },
    },
  ],
}

it("separates legacy mixed tracks into ordered groups without changing compositing order", () => {
  const before = structuredClone(document)
  const rows = timelineRows(document)
  expect(rows.map((r) => r.group)).toEqual(["Video", "Audio", "Text", "Text"])
  expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
    ["image"],
    [],
    ["first", "next"],
    ["overlap"],
  ])
  expect(rows.filter((r) => r.group === "Text").map((r) => r.trackId)).toEqual([
    "mixed",
    "mixed",
  ])
  expect(document).toEqual(before)
})

it("always shows the three group targets, including a completely empty document", () => {
  expect(
    timelineRows({ ...document, tracks: [], items: [] }).map((r) => r.group),
  ).toEqual(["Video", "Audio", "Text"])
})
