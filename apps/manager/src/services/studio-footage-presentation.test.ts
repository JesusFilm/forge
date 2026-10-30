import { z } from "zod"
import { expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
vi.mock("@/config/env", () => ({ env: {} }))
import { prepareFootagePresentation } from "./studio-footage-presentation"
import {
  footageKey,
  footageFrames,
  footageSampleTimes,
} from "@/features/video-studio/footage-presentation"
const ref = { assetId: "asset", versionId: "version", digest: "a".repeat(64) }
const snapshot = studioSourceSnapshotSchema.parse({
  id: "snapshot",
  source: {
    videoId: "video",
    dubId: "dub",
    editionId: "edition",
    language: "english",
    subtitle: {
      trackId: "track",
      editionId: "edition",
      language: "english",
      asset: ref,
    },
    preview: ref,
    export: ref,
    startMs: 5000,
    endMs: 10000,
  },
  durationMs: 10000,
  downloadId: "download",
  hlsUrl: "https://stream.mux.com/source.m3u8",
  downloadUrl: "https://stream.mux.com/source.mp4",
  subtitleUrl: "https://stream.mux.com/source.vtt",
  catalogDigest: "b".repeat(64),
  restrictions: [],
  materialization: "descriptor",
  originalByteDigest: null,
  coveredRanges: [],
  exportHeight: 1080,
  subtitlePrimary: true,
  subtitleAiGenerated: false,
})
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Preview",
  language: "english",
  runtimeVersion: STUDIO_RUNTIME_VERSION,
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 150,
  tracks: [{ id: "visual", kind: "visual" }],
  items: [
    {
      id: "clip",
      kind: "video",
      trackId: "visual",
      startFrame: 0,
      durationInFrames: 150,
      source: snapshot.source,
      volume: 0.5,
    },
  ],
  components: [],
})

const item = document.items[0]!
if (item.kind !== "video") throw Error("Expected footage")
const key = footageKey(item)
it("authorizes the document, resolves the title, and samples source time", async () => {
  const call = vi.fn(async () => [{ itemId: "clip", snapshot }])
  const catalog = vi.fn(async () => [
    { documentId: "video", title: "Bartimaeus" },
  ])
  const sign = vi.fn(async () => "signed")
  const before = JSON.stringify(document)
  const result = await prepareFootagePresentation(
    call,
    "project",
    document,
    catalog,
    sign,
  )
  expect(call).toHaveBeenCalledWith("preview-sources", {
    projectId: "project",
    document,
  })
  expect(catalog).toHaveBeenCalledWith(["video"])
  expect(result[key].name).toBe("Bartimaeus")
  expect(result[key].frames).toHaveLength(16)
  expect(result[key].frames[0]).toBe(
    "https://image.mux.com/source/thumbnail.webp?width=160&time=5",
  )
  expect(result[key].frames[15]).toContain("time=9.688")
  expect(sign).not.toHaveBeenCalled()
  expect(JSON.stringify(document)).toBe(before)
})
it("uses thumbnail-specific signed tokens rather than reusing video authorization", async () => {
  const sign = vi.fn(async (_id: string, time: number) => `image-${time}`)
  const result = await prepareFootagePresentation(
    async () => [
      {
        itemId: "clip",
        snapshot: {
          ...snapshot,
          hlsUrl: snapshot.hlsUrl + "?token=video-only",
        },
      },
    ],
    "project",
    document,
    async () => [],
    sign,
  )
  expect(sign).toHaveBeenCalledWith("source", 5)
  expect(result[key].frames[0]).toBe(
    "https://image.mux.com/source/thumbnail.webp?token=image-5",
  )
  expect(result[key].name).toBe("video")
})
it("retains the name if signing fails and rejects unauthorized sources", async () => {
  const result = await prepareFootagePresentation(
    async () => [
      {
        itemId: "clip",
        snapshot: { ...snapshot, hlsUrl: snapshot.hlsUrl + "?token=video" },
      },
    ],
    "project",
    document,
    async () => [{ documentId: "video", title: "Film" }],
    async () => {
      throw Error("No key")
    },
  )
  expect(result[key]).toEqual({ name: "Film", frames: [] })
  const videos = vi.fn(async () => [])
  await expect(
    prepareFootagePresentation(
      async () => {
        throw Error("Denied")
      },
      "project",
      document,
      videos,
      async () => "",
    ),
  ).rejects.toThrow("Denied")
  expect(videos).not.toHaveBeenCalled()
})
it("ignores non-Mux source URLs and tolerates unavailable catalog metadata", async () => {
  const sign = vi.fn(async () => "")
  const result = await prepareFootagePresentation(
    async () => [
      {
        itemId: "clip",
        snapshot: { ...snapshot, hlsUrl: "https://other.example/source.m3u8" },
      },
    ],
    "project",
    document,
    async () => {
      throw Error("Offline")
    },
    sign,
  )
  expect(result[key]).toEqual({ name: "video", frames: [] })
  expect(sign).not.toHaveBeenCalled()
})
it("fills narrow and wide clips with bounded chronological samples", () => {
  const frames = Array.from({ length: 16 }, (_, i) => String(i))
  expect(footageFrames(frames, 350)).toEqual(["0", "5", "10"])
  expect(footageFrames(frames, 12)).toEqual(["0"])
  expect(footageFrames(frames, 20000)).toHaveLength(16)
  expect(footageFrames([], 500)).toEqual([])
  expect(footageSampleTimes(1000, 9000)).toEqual(
    Array.from({ length: 16 }, (_, i) => 1 + i / 2),
  )
  expect(footageKey({ ...item, startFrame: 20, playbackRate: 2 })).toBe(key)
  expect(
    footageKey({ ...item, source: { ...item.source, startMs: 6000 } }),
  ).not.toBe(key)
})

it("loads media after audio edits against a source validator with legacy audio fields", async () => {
  const edited = studioDocumentSchema.parse({
    ...document,
    items: document.items.map((item) => ({
      ...item,
      volume: 10 ** 1.5,
      audioFade: {
        fadeInFrames: 10,
        fadeOutFrames: 10,
        fadeInCurve: 0.5,
        fadeOutCurve: -0.5,
        fadeInCurvePosition: 0.75,
        fadeOutCurvePosition: 0.25,
      },
    })),
  })
  edited.items.push({
    id: "music",
    kind: "audio",
    trackId: "visual",
    startFrame: 0,
    durationInFrames: 150,
    sourceStartMs: 1000,
    asset: ref,
    volume: 10 ** 1.5,
    audioFade: {
      fadeInFrames: 10,
      fadeOutFrames: 10,
      fadeInCurve: 0,
      fadeOutCurve: 0,
    },
  })
  const before = structuredClone(edited)
  const call = vi.fn(async (_action: string, input: unknown) => {
    const submitted = z
      .object({ document: studioDocumentSchema })
      .parse(input).document
    for (const audio of submitted.items) {
      expect(audio).not.toHaveProperty("audioFade")
      if (audio.kind === "video" || audio.kind === "audio")
        expect(audio.volume).toBeLessThanOrEqual(2)
    }
    expect(submitted.items[1]).toMatchObject({
      asset: ref,
      sourceStartMs: 1000,
    })
    const clip = submitted.items[0]!
    expect(clip).not.toHaveProperty("audioFade")
    if (clip.kind !== "video") throw Error("Video fixture required")
    expect(clip.volume).toBeLessThanOrEqual(2)
    expect(clip.source).toEqual(snapshot.source)
    expect(clip.startFrame).toBe(edited.items[0]!.startFrame)
    expect(clip.durationInFrames).toBe(edited.items[0]!.durationInFrames)
    return [{ itemId: "clip", snapshot: snapshot }]
  })
  const value = await prepareFootagePresentation(
    call,
    "project",
    edited,
    async () => [],
    async () => "signed",
  )
  expect(value[key].frames).toHaveLength(16)
  expect(edited).toEqual(before)
})
