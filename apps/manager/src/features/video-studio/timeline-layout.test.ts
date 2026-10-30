import { expect, it } from "vitest"
import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"
import { timelineRows, tracksForGroup } from "./timeline-layout"

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

it("shows mixed visuals in painter order without mutating the document", () => {
  const before = structuredClone(document)
  const rows = timelineRows(document)
  expect(rows.map((r) => r.group)).toEqual([
    "Visual",
    "Visual",
    "Visual",
    "Visual",
    "Audio",
  ])
  expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
    ["image"],
    ["next"],
    ["overlap"],
    ["first"],
    [],
  ])
  expect(document).toEqual(before)
})

it("shows only Visual and Audio targets in an empty document", () => {
  expect(
    timelineRows({ ...document, tracks: [], items: [] }).map((r) => r.group),
  ).toEqual(["Visual", "Audio"])
})

it("shares visual and legacy caption tracks with foreground tracks first", () => {
  const doc = {
    ...document,
    tracks: [
      { id: "background", kind: "visual" as const },
      { id: "caption", kind: "caption" as const },
      { id: "foreground", kind: "visual" as const },
      { id: "audio", kind: "audio" as const },
    ],
    items: [
      { ...text("text-under-video", 0), trackId: "background" },
      {
        ...document.items[3]!,
        id: "foreground-video-placeholder",
        trackId: "foreground",
      },
    ],
  }
  expect(tracksForGroup(doc, "Visual").map((t) => t.id)).toEqual([
    "foreground",
    "caption",
    "background",
  ])
  expect(timelineRows(doc).map((r) => [r.group, r.trackId])).toEqual([
    ["Visual", "foreground"],
    ["Visual", "caption"],
    ["Visual", "background"],
    ["Audio", "audio"],
  ])
})

it("keeps audio separate even when a legacy track contains mixed item kinds", () => {
  const doc = {
    ...document,
    items: [
      ...document.items,
      {
        id: "music",
        kind: "audio" as const,
        trackId: "mixed",
        startFrame: 0,
        durationInFrames: 90,
        asset: { assetId: "music", versionId: "v1", digest: "a".repeat(64) },
        sourceStartMs: 0,
        volume: 1,
      },
    ],
  }
  const rows = timelineRows(doc)
  expect(
    rows
      .filter((r) => r.group === "Visual")
      .flatMap((r) => r.items)
      .every((i) => i.kind !== "audio"),
  ).toBe(true)
  expect(
    rows
      .filter((r) => r.group === "Audio")
      .flatMap((r) => r.items)
      .map((i) => i.id),
  ).toEqual(["music"])
})

const footage: StudioTimelineItem = {
  id: "footage",
  kind: "video",
  trackId: "mixed",
  startFrame: 0,
  durationInFrames: 60,
  volume: 1,
  source: {
    videoId: "video",
    dubId: "dub",
    editionId: "edition",
    language: "en",
    subtitle: null,
    startMs: 1000,
    endMs: 3000,
    preview: { assetId: "preview", versionId: "v1", digest: "a".repeat(64) },
    export: { assetId: "export", versionId: "v1", digest: "a".repeat(64) },
  },
}

it("shows linked source audio using the original video identity without duplicating media", () => {
  const doc = { ...document, items: [footage] }
  const before = structuredClone(doc)
  const rows = timelineRows(doc)
  const linked = rows.filter((row) => row.linkedSourceAudio)
  expect(linked).toHaveLength(1)
  expect(linked[0]!.group).toBe("Audio")
  expect(linked[0]!.trackId).toBeNull()
  expect(linked[0]!.items[0]).toBe(footage)
  expect(rows.find((row) => row.group === "Visual")!.items[0]).toBe(footage)
  expect(tracksForGroup(doc, "Audio").map((track) => track.id)).toEqual([
    "audio",
  ])
  expect(doc).toEqual(before)
})

it("keeps overlapping and muted source audio visible, synchronized and outside standalone tracks", () => {
  const muted = { ...footage, id: "muted", startFrame: 15, volume: 0 }
  const doc = { ...document, items: [footage, muted] }
  const linked = timelineRows(doc).filter((row) => row.linkedSourceAudio)
  expect(linked).toHaveLength(2)
  expect(linked.flatMap((row) => row.items).map((item) => item.id)).toEqual([
    "muted",
    "footage",
  ])
  expect(linked[0]!.items[0]).toBe(muted)
  expect(linked[0]!.items[0]!.startFrame).toBe(15)
  expect(doc.items).toHaveLength(2)
})
