import { createHash } from "node:crypto"
import { readFile, writeFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioAssetUploadSchema } from "@forge/studio-contracts/assets"
import {
  studioMaterializeSourceSchema,
  studioSourceManifestSchema,
  studioSourceSnapshotSchema,
} from "@forge/studio-contracts/sources"

vi.mock("@/config/env", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { createHash } = await import("node:crypto")
  const directory = await mkdtemp(join(tmpdir(), "studio-codec-test-"))
  const low = createHash("sha256")
    .update("https://stream.mux.com/low/0.ts")
    .digest("hex")
  await writeFile(
    join(directory, "probe"),
    `#!/bin/sh\nprintf 'probe\\n' >> '${directory}/calls'\nfor arg do last="$arg"; done\nif grep -q '${low}' "$last"; then height=270; else height=1080; fi\nprintf '{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":%s}]}' "$height"\n`,
    { mode: 0o700 },
  )
  await writeFile(
    join(directory, "decode"),
    `#!/bin/sh\nprintf 'decode\\n' >> '${directory}/calls'\nif [ -f '${directory}/fail' ]; then exit 1; fi\n`,
    { mode: 0o700 },
  )
  return {
    env: {
      ADMIN_MANAGER_API_KEY: "fixture-only",
      STUDIO_PREVIEW_API_KEY: "fixture-only-proof-key",
      STUDIO_FFPROBE_PATH: join(directory, "probe"),
      STUDIO_FFMPEG_PATH: join(directory, "decode"),
      ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
    },
  }
})
import { env } from "@/config/env"
import {
  prepareStudioRenderSources,
  type StudioBrokerClient,
} from "./studio-broker"
const directory = dirname(env.STUDIO_FFMPEG_PATH!)
beforeEach(async () => {
  await writeFile(join(directory, "calls"), "")
  await rm(join(directory, "fail"), { force: true })
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => rm(directory, { recursive: true, force: true }))
async function counts() {
  const calls = (await readFile(join(directory, "calls"), "utf8"))
    .trim()
    .split("\n")
  return {
    probe: calls.filter((c) => c === "probe").length,
    decode: calls.filter((c) => c === "decode").length,
  }
}
function fixture(
  change?: "order" | "duration" | "bytes" | "height",
  onMaterialize?: () => void,
) {
  const ref = {
    assetId: "descriptor",
    versionId: "descriptor",
    digest: "a".repeat(64),
  }
  const base = studioSourceSnapshotSchema.parse({
    id: "original",
    source: {
      videoId: "video",
      dubId: "dub",
      editionId: "edition",
      language: "english",
      subtitle: null,
      preview: ref,
      export: ref,
      startMs: 0,
      endMs: 10000,
    },
    durationMs: 10000,
    downloadId: "download",
    hlsUrl: "https://stream.mux.com/a.m3u8",
    downloadUrl: "https://stream.mux.com/a.m3u8",
    subtitleUrl: null,
    catalogDigest: "b".repeat(64),
    restrictions: [],
    materialization: "descriptor",
    originalByteDigest: null,
    coveredRanges: [],
    exportHeight: 1080,
    subtitlePrimary: null,
    subtitleAiGenerated: null,
  })
  const other = studioSourceSnapshotSchema.parse({
    ...base,
    id: "other",
    hlsUrl: "https://stream.mux.com/b.m3u8",
    exportHeight: change === "height" ? 720 : 1080,
  })
  const document = studioDocumentSchema.parse({
    version: 1,
    title: "Repeated source verification",
    language: "english",
    runtimeVersion: "runtime",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 17 * 180,
    tracks: [{ id: "video", kind: "visual" }],
    components: [],
    items: Array.from({ length: 17 }, (_, i) => ({
      id: `clip-${i}`,
      kind: "video",
      trackId: "video",
      startFrame: i * 180,
      durationInFrames: change ? 180 : i % 2 ? 60 : 30,
      source: { ...base.source, endMs: change ? 6000 : i % 2 ? 2000 : 1000 },
      volume: 1,
    })),
  })
  let current: ReturnType<typeof studioAssetUploadSchema.parse> | undefined
  const retained = new Map<
    string,
    {
      input: ReturnType<typeof studioAssetUploadSchema.parse>
      body: Buffer
      reference: typeof ref
    }
  >()
  let uploaded = 0,
    materialized = 0
  const call: StudioBrokerClient = async (action, raw) => {
    if (action === "preview-sources")
      return document.items.map((item, i) => ({
        snapshot: change && i > 0 ? other : base,
        itemId: item.id,
        startMs: 0,
        endMs: change ? 6000 : i % 2 ? 2000 : 1000,
        startFrame: item.startFrame,
        eligibility: {},
      }))
    expect(action).toBe("asset-upload")
    current = studioAssetUploadSchema.parse(raw)
    return { path: `/api/shorts/assets/transfer/${"a".repeat(64)}` }
  }
  const fetcher = vi.fn(
    async (raw: string | URL | Request, init?: RequestInit) => {
      const url = String(raw)
      if (url.startsWith("https://admin.example/api/shorts/assets/transfer/")) {
        if (!current) throw new Error("Missing registration")
        const input = current,
          body = Buffer.from(await new Response(init?.body).arrayBuffer())
        expect(createHash("sha256").update(body).digest("hex")).toBe(
          input.digest,
        )
        const reference = {
          assetId: `asset-${++uploaded}`,
          versionId: `version-${uploaded}`,
          digest: input.digest,
        }
        retained.set(reference.versionId, { input, body, reference })
        return Response.json({
          reference,
          mediaAssetId: reference.assetId,
          ...input.metadata,
          byteSize: body.length,
          narration: null,
          voice: null,
          actor: { kind: "service", id: "manager_backend" },
        })
      }
      if (url === "https://admin.example/api/graphql") {
        const input = studioMaterializeSourceSchema.parse(
          JSON.parse(String(init?.body)).variables.input,
        )
        const manifest = studioSourceManifestSchema.parse(
          JSON.parse(retained.get(input.preview.versionId)!.body.toString()),
        )
        const original = input.sourceSnapshotId === "other" ? other : base
        materialized++
        onMaterialize?.()
        return Response.json({
          data: {
            materializeShortsSource: {
              ...original,
              id: `materialized-${input.preview.versionId}`,
              source: {
                ...original.source,
                preview: input.preview,
                export: input.export,
              },
              materialization: "broker-manifest",
              coveredRanges: manifest.ranges,
            },
          },
        })
      }
      if (
        url === "https://stream.mux.com/a.m3u8" ||
        url === "https://stream.mux.com/b.m3u8"
      ) {
        const suffix = url.endsWith("b.m3u8") ? "-b" : ""
        const height = suffix && change === "height" ? 720 : 1080
        return new Response(
          `#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=480x270\n/low${suffix}.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x${height}\n/high${suffix}.m3u8`,
        )
      }
      if (url.endsWith(".m3u8")) {
        const changed = url.includes("-b.m3u8"),
          purpose = url.includes("/low") ? "low" : "high"
        const names = ["0", changed && change === "bytes" ? "other" : "1"]
        if (changed && change === "order") names.reverse()
        const durations = changed && change === "duration" ? [4, 6] : [5, 5]
        return new Response(
          `#EXTM3U\n${names.map((name, i) => `#EXTINF:${durations[i]},\nhttps://stream.mux.com/${purpose}/${name}.ts`).join("\n")}\n#EXT-X-ENDLIST`,
        )
      }
      return new Response(url)
    },
  )
  vi.stubGlobal("fetch", fetcher)
  return { call, document, retained, materialized: () => materialized }
}
it("executes probe/decode once per identical rendition for 17 clips, retaining each trim", async () => {
  const f = fixture()
  const result = await prepareStudioRenderSources(f.call, "project", f.document)
  expect(await counts()).toEqual({ probe: 2, decode: 2 })
  expect(f.materialized()).toBe(17)
  expect(f.retained.size).toBe(8) // two segments/playlists and two range-specific manifest pairs
  for (const [i, item] of result.document.items.entries()) {
    if (item.kind !== "video") throw new Error("Expected video")
    const manifest = studioSourceManifestSchema.parse(
      JSON.parse(f.retained.get(item.source.export.versionId)!.body.toString()),
    )
    expect(manifest.ranges).toEqual([
      { startMs: 0, endMs: i % 2 ? 2000 : 1000 },
    ])
    expect(item.source.endMs).toBe(i % 2 ? 2000 : 1000)
  }
  await prepareStudioRenderSources(f.call, "project", f.document)
  expect(await counts()).toEqual({ probe: 4, decode: 4 })
})
it.each(["order", "duration", "bytes"] as const)(
  "verifies changed %s instead of reusing an overlapping selection",
  async (change) => {
    const f = fixture(change)
    await prepareStudioRenderSources(f.call, "project", f.document)
    expect(await counts()).toEqual({ probe: 4, decode: 4 })
  },
)
it("does not reuse verification for another expected resolution", async () => {
  const f = fixture("height")
  await expect(
    prepareStudioRenderSources(f.call, "project", f.document),
  ).rejects.toThrow("codec and resolution")
  expect(await counts()).toEqual({ probe: 3, decode: 2 })
})
it("does not reuse failed decoding or continue after cancellation", async () => {
  const f = fixture()
  await writeFile(join(directory, "fail"), "fail")
  await expect(
    prepareStudioRenderSources(f.call, "project", f.document),
  ).rejects.toThrow()
  await rm(join(directory, "fail"))
  await prepareStudioRenderSources(f.call, "project", f.document)
  expect(await counts()).toEqual({ probe: 3, decode: 3 })
  const controller = new AbortController(),
    aborted = fixture(undefined, () => controller.abort())
  await expect(
    prepareStudioRenderSources(
      aborted.call,
      "project",
      aborted.document,
      controller.signal,
    ),
  ).rejects.toThrow()
  expect(aborted.materialized()).toBe(1)
})
