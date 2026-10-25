import { afterEach, expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
vi.mock("@/config/env", () => ({ env: {} }))
import { prepareBrowserPreview } from "./shorts-browser-preview"
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
  packRevisionIds: [],
})
afterEach(() => vi.unstubAllGlobals())
it("previews descriptors with no service/key/codec, download, registration or document mutation", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  const call = vi.fn(async () => [{ itemId: "clip", snapshot }])
  const result = await prepareBrowserPreview(call, "project", document)
  expect(call.mock.calls).toEqual([
    ["preview-sources", { projectId: "project", document }],
  ])
  expect(fetch).not.toHaveBeenCalled()
  expect(result.input.document).toEqual(document)
  expect(result.input.media.clip.sourceStartMs).toBe(0)
  expect(result.urls["source-clip"]).toBe(snapshot.hlsUrl)
  expect(result.files).toEqual([])
})
it("propagates canonical eligibility rejection before loading any media", async () => {
  const error = new TypeError("Source no longer eligible")
  await expect(
    prepareBrowserPreview(
      async () => {
        throw error
      },
      "project",
      document,
    ),
  ).rejects.toBe(error)
})
it("refuses a noncanonical source host", async () => {
  await expect(
    prepareBrowserPreview(
      async () => [
        {
          itemId: "clip",
          snapshot: { ...snapshot, hlsUrl: "https://manager.example/private" },
        },
      ],
      "project",
      document,
    ),
  ).rejects.toThrow("Unapproved canonical media host")
})
