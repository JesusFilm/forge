import { afterEach, expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({
  env: {
    ADMIN_MANAGER_API_KEY: "fixture-only",
    STUDIO_PREVIEW_API_KEY: "fixture-only-preview-key",
    STUDIO_FFMPEG_PATH: "fixture-ffmpeg-never-executed",
    STUDIO_FFPROBE_PATH: "fixture-ffprobe-never-executed",
    ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
  },
}))
import {
  materialize,
  prepareStudioRenderSources,
  StudioBrokerError,
} from "./studio-broker"
const ref = { assetId: "asset", versionId: "version", digest: "a".repeat(64) }
const snapshot = {
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
    startMs: 0,
    endMs: 1000,
  },
  durationMs: 1000,
  downloadId: "download",
  hlsUrl: "https://stream.mux.com/a",
  downloadUrl: "https://stream.mux.com/a",
  subtitleUrl: "https://stream.mux.com/a",
  catalogDigest: "b".repeat(64),
  restrictions: [],
  materialization: "descriptor" as const,
  originalByteDigest: null,
  coveredRanges: [],
  exportHeight: 1080,
  subtitlePrimary: true,
  subtitleAiGenerated: false,
}
afterEach(() => vi.unstubAllGlobals())
it("materializes through the current Admin schema and reads its canonical response", async () => {
  const canonical = {
    ...snapshot,
    id: "materialized",
    materialization: "broker-manifest",
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(body.query).toContain("materializeShortsSource(input:")
      expect(body.variables.input.sourceSnapshotId).toBe(snapshot.id)
      return Response.json({ data: { materializeShortsSource: canonical } })
    }),
  )
  await expect(materialize(snapshot, ref, ref)).resolves.toEqual(canonical)
})

it.each(["missing-rendition", "gap", "too-many-segments", "unavailable-tail"])(
  "preserves broker HLS errors and staging bounds: %s",
  async (failure) => {
    const startMs = failure === "unavailable-tail" ? 358700 : 0
    const endMs =
      failure === "unavailable-tail"
        ? 426180
        : failure === "too-many-segments"
          ? 129000
          : 1000
    const source = { ...snapshot.source, subtitle: null, startMs, endMs }
    const document = {
      version: 1,
      title: "Staging regression",
      language: "english",
      runtimeVersion: "runtime",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: Math.round(((endMs - startMs) * 30) / 1000),
      tracks: [{ id: "video", kind: "visual" }],
      components: [],
      packRevisionIds: [],
      items: [
        {
          id: "clip",
          kind: "video",
          trackId: "video",
          startFrame: 0,
          durationInFrames: Math.round(((endMs - startMs) * 30) / 1000),
          source,
          volume: 1,
        },
      ],
    }
    const master =
      "#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=480x270\npreview.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nexport.m3u8"
    const segments =
      failure === "unavailable-tail"
        ? [...Array(85).fill(5), 1.16667]
        : Array(failure === "too-many-segments" ? 129 : 1).fill(1)
    const media = [
      "#EXTM3U",
      ...(failure === "gap" ? ["#EXT-X-GAP"] : []),
      ...segments.map((duration, i) => `#EXTINF:${duration},\n${i}.ts`),
      "#EXT-X-ENDLIST",
    ].join("\n")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: URL) =>
          new Response(
            url.href === snapshot.hlsUrl
              ? failure === "missing-rendition"
                ? "#EXTM3U"
                : master
              : media,
          ),
      ),
    )
    const client = vi.fn(async (action: string) => {
      if (action !== "preview-sources")
        throw new Error("Unexpected asset staging")
      return [
        {
          snapshot: {
            ...snapshot,
            source,
            subtitleUrl: null,
            subtitlePrimary: null,
            subtitleAiGenerated: null,
            durationMs: Math.max(endMs, 426197),
          },
          itemId: "clip",
          startMs,
          endMs,
          startFrame: 0,
          eligibility: {},
        },
      ]
    })
    const preparation = prepareStudioRenderSources(client, "project", document)
    await expect(preparation).rejects.toBeInstanceOf(StudioBrokerError)
    await expect(preparation).rejects.toThrow(
      failure === "missing-rendition"
        ? "rendition is unavailable"
        : failure === "gap"
          ? "Unsupported HLS"
          : "staging budget",
    )
    expect(client).toHaveBeenCalledTimes(1)
  },
)
