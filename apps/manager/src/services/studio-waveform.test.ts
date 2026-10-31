import { z } from "zod"
import { beforeEach, expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
const doubles = vi.hoisted(() => ({
  decode: vi.fn(),
  download: vi.fn(),
  read: vi.fn(),
}))
vi.mock("node:util", () => ({ promisify: () => doubles.decode }))
vi.mock("@/config/env", () => ({
  env: { STUDIO_FFMPEG_PATH: "/fixture/ffmpeg" },
}))
vi.mock("./studio-broker", () => ({
  createStudioSourceDownload: () => doubles.download,
  createStudioAssetBroker: () => ({ read: doubles.read }),
}))
import { prepareStudioWaveform } from "./studio-waveform"
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

beforeEach(() => {
  vi.clearAllMocks()
  doubles.decode.mockResolvedValue({ stdout: Buffer.from([0, 64, 0, 0]) })
  doubles.download.mockImplementation(async (url: string) =>
    Buffer.from(
      url.endsWith("master.m3u8")
        ? "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=480x270\nlow.m3u8"
        : url.endsWith("low.m3u8")
          ? "#EXTM3U\n#EXTINF:5,\nfirst.ts\n#EXTINF:5,\nselected.ts\n#EXTINF:5,\nlast.ts\n#EXT-X-ENDLIST"
          : "segment bytes",
    ),
  )
  doubles.read.mockResolvedValue(Buffer.from("retained audio"))
})
it("checks current authorization before consulting cached peaks", async () => {
  const call = vi.fn(async () => [
    {
      itemId: "clip",
      snapshot: { ...snapshot, hlsUrl: "https://stream.mux.com/master.m3u8" },
    },
  ])
  const value = await prepareStudioWaveform(call, "project", document, "clip")
  expect(value.peaks).toHaveLength(256)
  expect(doubles.download.mock.calls.map((c) => c[0])).toEqual([
    "https://stream.mux.com/master.m3u8",
    "https://stream.mux.com/low.m3u8",
    "https://stream.mux.com/selected.ts",
  ])
  const args = doubles.decode.mock.calls[0][1]
  expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
    "-ss",
    "0",
    "-t",
    "5",
  ])
  expect(args).toContain("file,crypto,data")
  expect(args).not.toContain(snapshot.hlsUrl)
  expect(
    await prepareStudioWaveform(call, "project", document, "clip"),
  ).toEqual(value)
  expect(call).toHaveBeenCalledTimes(2)
  expect(doubles.decode).toHaveBeenCalledTimes(1)
  await expect(
    prepareStudioWaveform(
      async () => {
        throw Error("Denied")
      },
      "project",
      document,
      "clip",
    ),
  ).rejects.toThrow("Denied")
})
it("uses project access and retained asset verification for standalone audio", async () => {
  const doc = {
    ...document,
    items: [
      {
        id: "music",
        kind: "audio" as const,
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 90,
        asset: ref,
        sourceStartMs: 1000,
        volume: 1,
      },
    ],
  }
  const call = vi.fn(async (action: string) =>
    action === "read"
      ? {}
      : {
          reference: ref,
          mediaAssetId: "media",
          filename: "music.wav",
          mimeType: "audio/wav",
          byteSize: 100,
          role: "music",
          provenance: { status: "unknown", recorded: {} },
          narration: null,
          voice: null,
          actor: { kind: "human", id: "human" },
        },
  )
  await prepareStudioWaveform(call, "project", doc, "music")
  expect(call.mock.calls.map((c) => c[0])).toEqual(["read", "asset"])
  expect(doubles.read).toHaveBeenCalledWith(ref, 32 * 1024 * 1024)
  const args = doubles.decode.mock.calls[0][1]
  expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
    "-ss",
    "1",
    "-t",
    "3",
  ])
})
it("bounds duration and reports codec failures without inventing a waveform", async () => {
  const clip = document.items[0]!
  if (clip.kind !== "video") throw Error("fixture")
  await expect(
    prepareStudioWaveform(
      vi.fn(),
      "project",
      {
        ...document,
        items: [{ ...clip, source: { ...clip.source, endMs: 400000 } }],
      },
      "clip",
    ),
  ).rejects.toThrow("five minutes")
  doubles.decode.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  )
  await expect(
    prepareStudioWaveform(
      async () => [
        {
          itemId: "clip",
          snapshot: {
            ...snapshot,
            catalogDigest: "c".repeat(64),
            hlsUrl: "https://stream.mux.com/master.m3u8",
          },
        },
      ],
      "project",
      document,
      "clip",
    ),
  ).rejects.toThrow("configured FFmpeg")
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
  const before = structuredClone(edited)
  const call = vi.fn(async (_action: string, input: unknown) => {
    const submitted = z
      .object({ document: studioDocumentSchema })
      .parse(input).document
    const clip = submitted.items[0]!
    expect(clip).not.toHaveProperty("audioFade")
    if (clip.kind !== "video") throw Error("Video fixture required")
    expect(clip.volume).toBeLessThanOrEqual(2)
    expect(clip.source).toEqual(snapshot.source)
    expect(clip.startFrame).toBe(edited.items[0]!.startFrame)
    expect(clip.durationInFrames).toBe(edited.items[0]!.durationInFrames)
    return [
      {
        itemId: "clip",
        snapshot: { ...snapshot, hlsUrl: "https://stream.mux.com/master.m3u8" },
      },
    ]
  })
  const value = await prepareStudioWaveform(call, "project", edited, "clip")
  expect(value.peaks).toHaveLength(256)
  expect(edited).toEqual(before)
})
