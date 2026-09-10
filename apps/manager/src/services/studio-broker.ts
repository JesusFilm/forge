import { adminGraphql } from "@forge/admin-graphql"
import { print } from "@apollo/client/utilities"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getDomain } from "tldts"
import { z } from "zod"
import {
  studioDocumentSchema,
  studioAssetReferenceSchema,
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
import {
  studioPreviewSchema,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
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
const reference = studioAssetReferenceSchema
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
type File = { name: string; bytes: Buffer; type: string }
type Segment = { url: string; duration: number; startMs: number; endMs: number }

export function assertDistinctPreviewSite(manager: string, preview: string) {
  const a = new URL(manager),
    b = new URL(preview)
  if (
    a.username ||
    a.password ||
    b.username ||
    b.password ||
    (b.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(b.hostname))
  )
    throw new StudioBrokerError(
      "Preview origin must be HTTPS, or loopback for local verification",
    )
  const site = (u: URL) =>
    getDomain(u.hostname, { allowPrivateDomains: true }) ?? u.hostname
  if (site(a) === site(b))
    throw new StudioBrokerError("Preview requires a distinct registrable site")
}
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

export async function releaseStudioPreview(rawUrl: string) {
  await updateStudioPreviewSession(rawUrl, "DELETE")
}
export async function renewStudioPreview(rawUrl: string) {
  await updateStudioPreviewSession(rawUrl, "PATCH")
}
async function updateStudioPreviewSession(
  rawUrl: string,
  method: "DELETE" | "PATCH",
) {
  if (
    !env.STUDIO_PREVIEW_ORIGIN ||
    !env.STUDIO_PREVIEW_SERVICE_URL ||
    !env.STUDIO_PREVIEW_API_KEY
  )
    throw new StudioBrokerError("Preview service is not configured")
  const url = new URL(rawUrl)
  if (
    url.origin !== new URL(env.STUDIO_PREVIEW_ORIGIN).origin ||
    url.search ||
    url.hash ||
    !/^\/s\/[a-f0-9]{64}\/$/.test(url.pathname)
  )
    throw new StudioBrokerError("Invalid preview session")
  const response = await fetch(
    new URL(url.pathname, env.STUDIO_PREVIEW_SERVICE_URL),
    {
      method,
      headers: { authorization: `Bearer ${env.STUDIO_PREVIEW_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  )
  if (!response.ok)
    throw new StudioBrokerError("Preview session is no longer available")
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
export async function prepareStudioPreview(
  call: StudioBrokerClient,
  projectId: string,
  rawDocument: unknown,
  signal?: AbortSignal,
) {
  if (preparing)
    throw new StudioBrokerBusyError(
      "Another preview is preparing. Try again shortly.",
    )
  preparing = true
  let directory: string | undefined
  let stagedUrl: string | undefined
  let published = false
  try {
    signal?.throwIfAborted()
    directory = await mkdtemp(join(tmpdir(), "studio-preview-"))
    if (
      !env.STUDIO_PREVIEW_ORIGIN ||
      !env.STUDIO_PREVIEW_SERVICE_URL ||
      !env.STUDIO_PREVIEW_API_KEY ||
      !env.MANAGER_BASE_URL
    )
      throw new StudioBrokerError("Preview service is not configured")
    assertDistinctPreviewSite(env.MANAGER_BASE_URL, env.STUDIO_PREVIEW_ORIGIN)
    let document = studioDocumentSchema.parse(rawDocument)
    const resolved = resolvedSchema.parse(
        await call("preview-sources", { projectId, document }),
      ),
      assets = createStudioAssetBroker(call, signal),
      files: File[] = [],
      media: StudioPreview["media"] = {},
      code: StudioPreview["code"] = {}
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
        if (retained.length === 2) {
          const { manifest, proof } = retained[0]!
          const info = z
            .object({
              playlist: reference,
              sourceStartMs: z.number().nonnegative(),
              segmentDurations: z.array(z.number().positive()),
              verification: z.literal("decoded-h264-v1"),
            })
            .parse(proof)
          // Hash-check the retained playlist, then rebuild safe local names from immutable media.
          await assets.read(info.playlist, 1048576)
          if (info.segmentDurations.length !== manifest.media.length)
            throw new StudioBrokerError("Invalid retained segment proof")
          const prefix = id.replace(/[^a-zA-Z0-9_-]/g, "_") + "-retained",
            names = manifest.media.map((_, i) => `${prefix}-${i}.ts`)
          for (let i = 0; i < manifest.media.length; i++) {
            const bytes = await assets.read(
              manifest.media[i]!,
              LIMIT - transferred,
            )
            transferred += bytes.length
            files.push({ name: names[i]!, bytes, type: "video/mp2t" })
          }
          const name = `${prefix}.m3u8`
          files.push({
            name,
            bytes: playlist(info.segmentDurations, names),
            type: "application/vnd.apple.mpegurl",
          })
          media[id] = {
            file: name,
            sourceStartMs: info.sourceStartMs,
            kind: "hls",
          }
          continue
        }
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
          if (purpose === "preview")
            files.push({ name: names[i]!, bytes, type: "video/mp2t" })
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
        if (purpose === "preview") {
          files.push({
            name: listName,
            bytes: list,
            type: "application/vnd.apple.mpegurl",
          })
          media[id] = {
            file: listName,
            sourceStartMs: segments[0]!.startMs,
            kind: "hls",
          }
        }
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
    for (const item of document.items) {
      if (item.kind !== "audio" && item.kind !== "image") continue
      const asset = studioAssetVersionSchema.parse(
        await call("asset", item.asset),
      )
      if (
        (item.kind === "image" &&
          !["image/png", "image/jpeg", "image/webp"].includes(
            asset.mimeType,
          )) ||
        (item.kind === "audio" &&
          !["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"].includes(
            asset.mimeType,
          ))
      )
        throw new StudioBrokerError("Unsupported preview asset type")
      const bytes = await assets.read(
        item.asset,
        Math.min(32 * 1024 * 1024, LIMIT - transferred),
      )
      transferred += bytes.length
      const name = `asset-${item.asset.versionId}`
      if (!files.some((f) => f.name === name))
        files.push({ name, bytes, type: asset.mimeType })
      media[item.id] = { file: name, sourceStartMs: 0, kind: item.kind }
    }
    const activeComponents = new Set(
      document.items.flatMap((item) =>
        item.kind === "component" ? [item.componentVersionId] : [],
      ),
    )
    for (const component of document.components.filter((c) =>
      activeComponents.has(c.versionId),
    )) {
      const bytes = await assets.read(
        component.code,
        Math.min(32768, LIMIT - transferred),
      )
      transferred += bytes.length
      code[component.versionId] = bytes.toString("utf8")
    }
    signal?.throwIfAborted()
    const input = studioPreviewSchema.parse({ document, media, code })
    const headers = {
      authorization: `Bearer ${env.STUDIO_PREVIEW_API_KEY}`,
      "content-type": "application/json",
    }
    const response = await fetch(
      new URL("/sessions", env.STUDIO_PREVIEW_SERVICE_URL),
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!response.ok)
      throw new StudioBrokerError("Preview service rejected preparation")
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(await response.json())
    stagedUrl = new URL(`/s/${token}/`, env.STUDIO_PREVIEW_ORIGIN).href
    const sessionUrl = stagedUrl
    signal?.addEventListener(
      "abort",
      () => {
        void releaseStudioPreview(sessionUrl).catch(() => {})
      },
      { once: true },
    )
    for (const file of files) {
      signal?.throwIfAborted()
      const res = await fetch(
        new URL(`/s/${token}/${file.name}`, env.STUDIO_PREVIEW_SERVICE_URL),
        {
          method: "PUT",
          headers: {
            authorization: headers.authorization,
            "content-type": file.type,
          },
          body: new Uint8Array(file.bytes),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      )
      if (!res.ok) throw new StudioBrokerError("Preview staging failed")
    }
    signal?.throwIfAborted()
    published = true
    return {
      url: stagedUrl,
      document,
      transferredBytes: transferred,
    }
  } finally {
    preparing = false
    if (stagedUrl && !published)
      await releaseStudioPreview(stagedUrl).catch(() => {})
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
