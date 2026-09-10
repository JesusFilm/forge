import { adminGraphql } from "@forge/admin-graphql"
import { print } from "@apollo/client/utilities"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"
import {
  studioDocumentSchema,
  type StudioAssetReference,
} from "@forge/studio-contracts"
import {
  studioAssetVersionSchema,
  type ShortAssetVersion,
  studioAssetUploadSchema,
} from "@forge/studio-contracts/assets"
import {
  studioSourceManifestSchema,
  studioSourceSnapshotSchema,
  type ShortSourceSnapshot,
} from "@forge/studio-contracts/sources"
import type { StudioAction } from "@forge/studio-contracts/transport"
export type StudioBrokerClient = (
  action: StudioAction,
  input: unknown,
) => Promise<unknown>
import { env } from "@/config/env"

export class StudioBrokerError extends Error {}
export class StudioBrokerBusyError extends StudioBrokerError {}
const boundedSignal = (ms: number, parent?: AbortSignal) =>
  parent
    ? AbortSignal.any([parent, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms)
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex")
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}
const exec = promisify(execFile)
export function canonicalMediaUrl(raw: string): URL {
  const url = new URL(raw)
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !(
      url.hostname === "api-media-core.jesusfilm.org" ||
      url.hostname === "mux.com" ||
      url.hostname.endsWith(".mux.com")
    )
  )
    throw new StudioBrokerError("Unapproved canonical media host")
  return url
}
const LIMIT = 256 * 1024 * 1024
const resolvedSchema = z.array(
  z.object({
    snapshot: studioSourceSnapshotSchema,
    itemId: z.string(),
    startMs: z.number(),
    endMs: z.number(),
    startFrame: z.number(),
    eligibility: z.unknown(),
  }),
)
type Segment = { url: string; duration: number; startMs: number; endMs: number }

async function readBounded(response: Response, max: number) {
  if (!response.ok || !response.body)
    throw new StudioBrokerError(`Media transfer failed (${response.status})`)
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max)
        throw new StudioBrokerError("Preview transfer exceeds its byte budget")
      chunks.push(value)
    }
  } catch (e) {
    await reader.cancel().catch(() => {})
    throw e
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
export function createStudioAssetBroker(
  call: StudioBrokerClient,
  signal?: AbortSignal,
) {
  return {
    async read(ref: StudioAssetReference, max = LIMIT) {
      const grant = z
        .object({ path: z.string() })
        .parse(await call("asset-read", ref))
      if (!/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/.test(grant.path))
        throw new StudioBrokerError("Invalid read capability")
      const bytes = await readBounded(
        await fetch(new URL(grant.path, env.ADMIN_GRAPHQL_URL!), {
          redirect: "error",
          signal: boundedSignal(30000, signal),
        }),
        max,
      )
      if (hash(bytes) !== ref.digest)
        throw new StudioBrokerError("Retained asset digest changed")
      return bytes
    },
    async register(
      filename: string,
      type: string,
      role: ShortAssetVersion["role"],
      bytes: Buffer,
      dependencies: StudioAssetReference[] = [],
      recorded: Record<
        string,
        string | number | number[] | StudioAssetReference
      > = {},
    ) {
      const input = studioAssetUploadSchema.parse({
        metadata: {
          idempotencyKey: `broker-${hash(bytes)}-${hash(JSON.stringify({ filename, type, role, dependencies, recorded })).slice(0, 24)}`,
          filename,
          mimeType: type,
          role,
          dependencies,
          provenance: { status: "recorded", recorded },
        },
        digest: hash(bytes),
        byteSize: bytes.length,
      })
      const grant = z
        .object({ path: z.string() })
        .parse(await call("asset-upload", input))
      if (!/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/.test(grant.path))
        throw new StudioBrokerError("Invalid upload capability")
      const response = await fetch(
        new URL(grant.path, env.ADMIN_GRAPHQL_URL!),
        {
          method: "PUT",
          body: new Uint8Array(bytes),
          redirect: "error",
          signal: boundedSignal(30000, signal),
        },
      )
      if (!response.ok)
        throw new StudioBrokerError("Could not retain preview media")
      return studioAssetVersionSchema.parse(await response.json()).reference
    },
  }
}
function rendition(
  master: string,
  base: string,
  target: number,
  exact: boolean,
) {
  const lines = master.trim().split(/\r?\n/),
    choices: { url: string; height: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const resolution = lines[i]!.match(
      /^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/,
    )
    if (resolution && lines[i + 1] && !lines[i + 1]!.startsWith("#"))
      choices.push({
        url: new URL(lines[i + 1]!, base).href,
        height: Number(resolution[2]),
      })
  }
  const selected = exact
    ? choices.find((c) => c.height === target)
    : (choices
        .filter((c) => c.height <= target)
        .sort((a, b) => b.height - a.height)[0] ??
      choices.sort((a, b) => a.height - b.height)[0])
  if (!selected)
    throw new StudioBrokerError("The admitted source rendition is unavailable")
  return selected
}
function playlistSegments(
  text: string,
  base: string,
  startMs: number,
  endMs: number,
) {
  if (
    /#EXT-X-(KEY|MAP|BYTERANGE|DISCONTINUITY|MEDIA)(?::|\r?$)/m.test(text) ||
    !text.includes("#EXT-X-ENDLIST")
  )
    throw new StudioBrokerError(
      "Unsupported HLS structure; select another catalog source",
    )
  const lines = text.trim().split(/\r?\n/)
  let elapsed = 0
  const all: Segment[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith("#EXTINF:")) continue
    const duration = Number(lines[i]!.slice(8).split(",")[0])
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 30 ||
      !lines[i + 1] ||
      lines[i + 1]!.startsWith("#")
    )
      throw new StudioBrokerError("Invalid HLS segment")
    const segment = {
      url: new URL(lines[i + 1]!, base).href,
      duration,
      startMs: elapsed,
      endMs: elapsed + duration * 1000,
    }
    elapsed = segment.endMs
    if (segment.endMs > startMs && segment.startMs < endMs) all.push(segment)
  }
  if (
    !all.length ||
    all.length > 128 ||
    all[0]!.startMs > startMs ||
    all.at(-1)!.endMs + 1 < endMs
  )
    throw new StudioBrokerError(
      "Selected source range exceeds the preview staging budget",
    )
  return all
}
function playlist(durations: number[], names: string[]) {
  return Buffer.from(
    [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durations))}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      ...durations.flatMap((d, i) => [`#EXTINF:${d},`, names[i]!]),
      "#EXT-X-ENDLIST",
    ].join("\n"),
  )
}
export async function materialize(
  snapshot: ShortSourceSnapshot,
  preview: StudioAssetReference,
  exportRef: StudioAssetReference,
) {
  if (!env.ADMIN_MANAGER_API_KEY)
    throw new StudioBrokerError(
      "Trusted source materialization is not configured",
    )
  const response = await fetch(env.ADMIN_GRAPHQL_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.ADMIN_MANAGER_API_KEY}`,
    },
    body: JSON.stringify({
      query: print(
        adminGraphql(
          `mutation MaterializeStudioPreviewSource($input: JSON!) { materializeShortsSource(input:$input) { id source durationMs downloadId hlsUrl downloadUrl subtitleUrl catalogDigest restrictions materialization originalByteDigest coveredRanges exportHeight subtitlePrimary subtitleAiGenerated } }`,
        ),
      ),
      variables: {
        input: {
          sourceSnapshotId: snapshot.id,
          preview,
          export: exportRef,
          idempotencyKey: `materialize-${preview.versionId}-${exportRef.versionId}`,
        },
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  const payload = (await response.json()) as {
    data?: { materializeShortsSource: unknown }
    errors?: unknown
  }
  if (!response.ok || payload.errors)
    throw new StudioBrokerError("Source materialization was rejected")
  return studioSourceSnapshotSchema.parse(payload.data?.materializeShortsSource)
}

/** Validates retained media authority, independently of interactive attribution.
 * The caller resolves current source eligibility before invoking this reader. */
export async function readRetainedStudioSource(
  call: StudioBrokerClient,
  assets: ReturnType<typeof createStudioAssetBroker>,
  snapshot: ShortSourceSnapshot,
  entry: { startMs: number; endMs: number },
  proofKey: string,
) {
  const retained = []
  for (const [purpose, ref] of [
    ["preview", snapshot.source.preview],
    ["export", snapshot.source.export],
  ] as const) {
    const asset = studioAssetVersionSchema.parse(await call("asset", ref))
    const { proofSignature, ...proof } = asset.provenance.recorded
    const expected = createHmac("sha256", proofKey)
      .update(`${ref.digest}:${canonical(proof)}`)
      .digest("hex")
    if (
      typeof proofSignature !== "string" ||
      proofSignature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(proofSignature), Buffer.from(expected))
    )
      break
    const manifest = studioSourceManifestSchema.parse(
      JSON.parse((await assets.read(ref, 1048576)).toString()),
    )
    const admitted = studioSourceSnapshotSchema.parse(
      await call("source", manifest.sourceSnapshotId),
    )
    const identity = (s: ShortSourceSnapshot) =>
      canonical({
        catalogDigest: s.catalogDigest,
        downloadId: s.downloadId,
        source: {
          ...s.source,
          preview: null,
          export: null,
          startMs: 0,
          endMs: 0,
        },
      })
    if (
      identity(admitted) !== identity(snapshot) ||
      manifest.catalogDigest !== snapshot.catalogDigest ||
      manifest.purpose !== purpose ||
      !manifest.ranges.some(
        (r) => r.startMs <= entry.startMs && r.endMs >= entry.endMs,
      )
    )
      throw new StudioBrokerError(
        "Retained codec proof does not cover this source",
      )
    retained.push({ manifest, proof })
  }
  return retained
}

// One active preparation per Manager process bounds aggregate memory and extraction work.
let preparing = false
export async function prepareStudioRenderSources(
  call: StudioBrokerClient,
  projectId: string,
  rawDocument: unknown,
  signal?: AbortSignal,
) {
  if (preparing)
    throw new StudioBrokerBusyError(
      "Another render is preparing. Try again shortly.",
    )
  preparing = true
  let directory: string | undefined
  try {
    signal?.throwIfAborted()
    directory = await mkdtemp(join(tmpdir(), "studio-preview-"))
    let document = studioDocumentSchema.parse(rawDocument)
    const resolved = resolvedSchema.parse(
        await call("preview-sources", { projectId, document }),
      ),
      assets = createStudioAssetBroker(call, signal)
    let transferred = 0
    async function download(raw: string, max = LIMIT) {
      const url = canonicalMediaUrl(raw)
      const bytes = await readBounded(
        await fetch(url, {
          redirect: "error",
          signal: boundedSignal(20000, signal),
        }),
        Math.min(max, LIMIT - transferred),
      )
      transferred += bytes.length
      return bytes
    }
    for (const entry of resolved) {
      if (!env.STUDIO_PREVIEW_API_KEY)
        throw new StudioBrokerError(
          "Render source verification key is not configured",
        )
      signal?.throwIfAborted()
      const snapshot = entry.snapshot,
        id = entry.itemId
      // Reuse only this broker's signed, immutable codec proof, after current eligibility
      // was resolved above. User-written provenance is never codec authority.
      if (
        snapshot.materialization === "broker-manifest" &&
        snapshot.coveredRanges.some(
          (r) => r.startMs <= entry.startMs && r.endMs >= entry.endMs,
        )
      ) {
        const retained = await readRetainedStudioSource(
          call,
          assets,
          snapshot,
          entry,
          env.STUDIO_PREVIEW_API_KEY,
        )
        if (retained.length === 2) continue
      }

      if (!env.STUDIO_FFMPEG_PATH || !env.STUDIO_FFPROBE_PATH)
        throw new StudioBrokerError(
          "Source codec verification is not configured",
        )
      const master = (await download(snapshot.hlsUrl, 1048576)).toString(),
        low = rendition(master, snapshot.hlsUrl, 270, false),
        high = rendition(
          master,
          snapshot.hlsUrl,
          snapshot.exportHeight ?? 0,
          true,
        )
      const manifests: StudioAssetReference[] = []
      for (const [purpose, variant] of [
        ["preview", low],
        ["export", high],
      ] as const) {
        const segments = playlistSegments(
          (await download(variant.url, 1048576)).toString(),
          variant.url,
          entry.startMs,
          entry.endMs,
        )
        const prefix = `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${purpose}`,
          names = segments.map((_, i) => `${prefix}-${i}.ts`),
          refs: StudioAssetReference[] = []
        for (let i = 0; i < segments.length; i++) {
          const bytes = await download(segments[i]!.url)
          await writeFile(join(directory, names[i]!), bytes)
          refs.push(
            await assets.register(
              names[i]!,
              "video/mp2t",
              "source",
              bytes,
              [],
              {
                sourceSnapshotId: snapshot.id,
                catalogDigest: snapshot.catalogDigest,
                sourceStartMs: segments[i]!.startMs,
                durationMs: segments[i]!.duration * 1000,
              },
            ),
          )
        }
        const list = playlist(
            segments.map((s) => s.duration),
            names,
          ),
          listName = `${prefix}.m3u8`
        await writeFile(join(directory, listName), list)
        const { stdout } = await exec(
          env.STUDIO_FFPROBE_PATH,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,crypto,data",
            "-show_streams",
            "-of",
            "json",
            join(directory, listName),
          ],
          { timeout: 30000, maxBuffer: 262144, signal },
        )
        const probe = z
          .object({
            streams: z.array(
              z.object({
                codec_type: z.string(),
                codec_name: z.string().optional(),
                height: z.number().optional(),
                width: z.number().optional(),
              }),
            ),
          })
          .parse(JSON.parse(stdout))
        const video = probe.streams.find((s) => s.codec_type === "video")
        if (
          video?.codec_name !== "h264" ||
          video.height !== variant.height ||
          !video.width
        )
          throw new StudioBrokerError(
            "Selected media does not match the admitted codec and resolution",
          )
        // Decode the complete bounded segment selection; no MP4 movie/render prerequisite.
        await exec(
          env.STUDIO_FFMPEG_PATH,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,crypto,data",
            "-i",
            join(directory, listName),
            "-map",
            "0:v:0",
            "-f",
            "null",
            "-",
          ],
          { timeout: 60000, maxBuffer: 262144, signal },
        )
        const listRef = await assets.register(
          listName,
          "application/vnd.apple.mpegurl",
          "manifest",
          list,
          refs,
        )
        const manifest = {
          sourceSnapshotId: snapshot.id,
          catalogDigest: snapshot.catalogDigest,
          purpose,
          height: variant.height,
          ranges: [{ startMs: entry.startMs, endMs: entry.endMs }],
          media: refs,
        }
        const bytes = Buffer.from(JSON.stringify(manifest)),
          proof = {
            playlist: listRef,
            sourceStartMs: segments[0]!.startMs,
            segmentDurations: segments.map((s) => s.duration),
            width: video.width,
            height: video.height,
            codec: video.codec_name,
            verification: "decoded-h264-v1",
          }
        const proofSignature = createHmac("sha256", env.STUDIO_PREVIEW_API_KEY)
          .update(`${hash(bytes)}:${canonical(proof)}`)
          .digest("hex")
        manifests.push(
          await assets.register(
            `${prefix}.json`,
            "application/json",
            "manifest",
            bytes,
            [...refs, listRef],
            { ...proof, proofSignature },
          ),
        )
      }

      const verified = await materialize(snapshot, manifests[0]!, manifests[1]!)
      document = {
        ...document,
        items: document.items.map((i) =>
          i.id === id && i.kind === "video"
            ? {
                ...i,
                source: {
                  ...verified.source,
                  startMs: i.source.startMs,
                  endMs: i.source.endMs,
                },
              }
            : i,
        ),
      }
    }
    signal?.throwIfAborted()
    return { document }
  } finally {
    preparing = false
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
