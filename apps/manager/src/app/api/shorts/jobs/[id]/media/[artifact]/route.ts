// GET/HEAD /api/shorts/jobs/[id]/media/[artifact] — Range-capable STREAMING
// media route (plan 2026-06-11-002 decision 6). Serves the two shorts MP4s
// only, via fixed logical literals:
//   clip   → shorts-clip-v1.mp4   (preview <Player> source)
//   output → shorts-output-v1.mp4 (rendered short download)
// No client-supplied storage keys ever reach storage; the prefix resolved
// from the job is re-validated against SAFE_KEY_PATTERN (defense in depth).
//
// The legacy buffering artifact route (/api/jobs/[id]/artifacts/[artifact])
// is NOT used for shorts media — readArtifact buffers whole objects and the
// output MP4 is 180–360MB. This route streams (S3 GetObject Range → web
// stream; local createReadStream) and never buffers.
//
// Range semantics: single ranges only (bytes=a-b / bytes=a- / bytes=-n) →
// 206 + Content-Range; multi-range and syntactically invalid ranges → 416
// with `Content-Range: bytes */size`; no Range header → 200 full stream.
// Always `Accept-Ranges: bytes` + `Cache-Control: private, max-age=3600`
// (artifacts are immutable per prepare/render) + ETag passthrough.
//
// Auth model: ANY authenticated operator (or the MANAGER_API_KEY bearer) may
// stream shorts media — deliberately matching the smart-crop artifact
// access model; manager is a shared internal tool with a single operator
// role, so per-job ACLs add nothing.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  SHORTS_CLIP_ARTIFACT_TYPE,
  SHORTS_OUTPUT_ARTIFACT_TYPE,
} from "@/lib/shorts-artifacts"
import { resolveShortsMediaPrefix } from "@/lib/shorts-media-prefix"
import {
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  openArtifactStream,
  statArtifact,
  type ArtifactStreamRange,
} from "@/services/storage"

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

// Fixed literals only — the [artifact] segment is a logical name, never a
// storage key. Anything else 404s before touching storage.
const MEDIA_ARTIFACTS: Record<string, { artifactType: string; ext: "mp4" }> = {
  clip: { artifactType: SHORTS_CLIP_ARTIFACT_TYPE, ext: "mp4" },
  output: { artifactType: SHORTS_OUTPUT_ARTIFACT_TYPE, ext: "mp4" },
}

const CACHE_CONTROL = "private, max-age=3600"
const CONTENT_TYPE = "video/mp4"

type ParsedRangeHeader =
  | { kind: "none" }
  | { kind: "single"; range: ArtifactStreamRange }
  | { kind: "multi" }
  | { kind: "invalid" }

function parseRangeHeader(header: string | null): ParsedRangeHeader {
  if (header === null) {
    return { kind: "none" }
  }

  const match = /^bytes=(.+)$/.exec(header.trim())
  if (!match) {
    return { kind: "invalid" }
  }

  const spec = match[1].trim()
  if (spec.includes(",")) {
    // Multi-range responses need multipart/byteranges encoding; rejecting
    // with 416 is the simplest correct behavior and video elements never
    // send them.
    return { kind: "multi" }
  }

  const bounded = /^(\d+)-(\d+)$/.exec(spec)
  if (bounded) {
    const start = Number(bounded[1])
    const end = Number(bounded[2])
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    ) {
      return { kind: "invalid" }
    }
    return { kind: "single", range: { start, end } }
  }

  const openEnded = /^(\d+)-$/.exec(spec)
  if (openEnded) {
    const start = Number(openEnded[1])
    if (!Number.isSafeInteger(start)) {
      return { kind: "invalid" }
    }
    return { kind: "single", range: { start } }
  }

  const suffix = /^-(\d+)$/.exec(spec)
  if (suffix) {
    const length = Number(suffix[1])
    if (!Number.isSafeInteger(length)) {
      return { kind: "invalid" }
    }
    // bytes=-0 is unsatisfiable per RFC 9110 — resolveRange throws the
    // typed 416 error carrying the object size.
    return { kind: "single", range: { suffix: length } }
  }

  return { kind: "invalid" }
}

function baseHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": CONTENT_TYPE,
    ...extra,
  })
}

function rangeNotSatisfiable(totalSize: number): NextResponse {
  return new NextResponse(null, {
    status: 416,
    headers: baseHeaders({ "Content-Range": `bytes */${totalSize}` }),
  })
}

function isArtifactNotFound(error: unknown): boolean {
  return (
    error instanceof ArtifactNotFoundError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "ArtifactNotFoundError")
  )
}

function isRangeNotSatisfiable(
  error: unknown,
): error is ArtifactRangeNotSatisfiableError {
  return (
    error instanceof ArtifactRangeNotSatisfiableError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "ArtifactRangeNotSatisfiableError")
  )
}

type ResolvedMediaTarget =
  | { ok: true; prefix: string; artifactType: string; ext: "mp4" }
  | { ok: false; response: NextResponse }

async function resolveMediaTarget(
  jobId: string,
  artifact: string,
): Promise<ResolvedMediaTarget> {
  const descriptor = MEDIA_ARTIFACTS[artifact]
  if (!descriptor) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unknown media artifact" },
        { status: 404 },
      ),
    }
  }

  // 60s in-process cache: jobId → storage prefix (or null for unknown /
  // non-shorts jobs) so per-Range-request playback doesn't pay a getJob
  // round trip per seek.
  const prefix = await resolveShortsMediaPrefix(jobId)
  if (prefix === null || !SAFE_KEY_PATTERN.test(prefix)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Job not found" }, { status: 404 }),
    }
  }

  return {
    ok: true,
    prefix,
    artifactType: descriptor.artifactType,
    ext: descriptor.ext,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifact: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id, artifact } = await params
  const target = await resolveMediaTarget(id, artifact)
  if (!target.ok) return target.response

  const parsedRange = parseRangeHeader(request.headers.get("range"))

  if (parsedRange.kind === "multi" || parsedRange.kind === "invalid") {
    // The 416 needs the object size for `Content-Range: bytes */size`.
    try {
      const info = await statArtifact(
        target.prefix,
        target.artifactType,
        target.ext,
      )
      return rangeNotSatisfiable(info.size)
    } catch (error) {
      if (isArtifactNotFound(error)) {
        return NextResponse.json(
          { error: "Artifact not found" },
          { status: 404 },
        )
      }
      throw error
    }
  }

  let stream
  try {
    stream = await openArtifactStream({
      assetId: target.prefix,
      artifactType: target.artifactType,
      ext: target.ext,
      ...(parsedRange.kind === "single" ? { range: parsedRange.range } : {}),
    })
  } catch (error) {
    if (isArtifactNotFound(error)) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 })
    }
    if (isRangeNotSatisfiable(error)) {
      return rangeNotSatisfiable(error.totalSize)
    }
    throw error
  }

  const headers = baseHeaders({
    "Content-Length": String(stream.contentLength),
    ...(stream.etag ? { ETag: stream.etag } : {}),
    ...(parsedRange.kind === "single"
      ? {
          "Content-Range": `bytes ${stream.rangeStart}-${stream.rangeEnd}/${stream.totalSize}`,
        }
      : {}),
  })

  // Stream the body — never buffer (App Router accepts a web ReadableStream
  // Response body and pipes it through).
  return new NextResponse(stream.body, {
    status: parsedRange.kind === "single" ? 206 : 200,
    headers,
  })
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ id: string; artifact: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id, artifact } = await params
  const target = await resolveMediaTarget(id, artifact)
  if (!target.ok) {
    // HEAD responses carry no body.
    return new NextResponse(null, { status: target.response.status })
  }

  try {
    const info = await statArtifact(
      target.prefix,
      target.artifactType,
      target.ext,
    )
    return new NextResponse(null, {
      status: 200,
      headers: baseHeaders({
        "Content-Length": String(info.size),
        ...(info.etag ? { ETag: info.etag } : {}),
      }),
    })
  } catch (error) {
    if (isArtifactNotFound(error)) {
      return new NextResponse(null, { status: 404 })
    }
    throw error
  }
}
