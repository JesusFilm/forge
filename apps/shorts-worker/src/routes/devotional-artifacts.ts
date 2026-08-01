import type { IncomingMessage, ServerResponse } from "node:http"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { validateBearer, type ValidateBearerOptions } from "../auth.js"
import {
  DEVOTIONAL_INPUT_ARTIFACT_TYPE,
  DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
  DEVOTIONAL_WIDE_ARTIFACT_TYPE,
  devotionalRenderInputSchema,
} from "../devotional-render.js"
import { sendJson } from "../http.js"
import {
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  createDevotionalStorage,
  createStorage,
  devotionalManifestKey,
  devotionalManifestRefFromAssetId,
  devotionalWorkspaceKey,
  type Storage,
  type WorkspaceArtifactRef,
} from "../storage.js"

const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const NARRATION_ARTIFACT = /^devotional-narration-[a-zA-Z0-9_-]{1,64}-v1$/
const JSON_BODY_CAP_BYTES = 1_000_000
const NARRATION_BODY_CAP_BYTES = 25 * 1024 * 1024
const MUSIC_BODY_CAP_BYTES = 50 * 1024 * 1024
export const DEVOTIONAL_INPUT_MANIFEST_ARTIFACT_TYPE =
  "devotional-input-manifest-v2"

const attemptSchema = z.object({
  workspaceGeneration: z.number().int().positive(),
  attemptId: z.string().regex(SAFE_ID).max(128),
  runId: z.string().regex(SAFE_ID).max(128),
})
const workspaceRefSchema = z.object({
  schemaVersion: z.literal("2"),
  key: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
  attempt: attemptSchema,
})
const manifestSchema = z.object({
  schemaVersion: z.literal("2"),
  kind: z.enum(["run-input", "attempt-output"]),
  attempt: attemptSchema,
  artifacts: z.array(
    z.object({
      artifactType: z.string().regex(SAFE_ID),
      ext: z.string().regex(SAFE_ID),
      ref: workspaceRefSchema,
    }),
  ),
  selectedSources: z
    .array(
      z.object({
        path: z.string().startsWith("/inputs/"),
        category: z.string().min(1).max(128),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative(),
        modifiedAt: z.string().datetime(),
        etag: z.string().optional(),
        title: z.string().min(1).max(500),
      }),
    )
    .max(500)
    .optional(),
})

type InputArtifact = {
  artifactType: string
  ext: "json" | "mp3"
  maxBytes: number
  contentTypes: string[]
}

function inputArtifact(
  artifactType: string,
  ext: string,
): InputArtifact | null {
  if (artifactType === DEVOTIONAL_INPUT_ARTIFACT_TYPE && ext === "json") {
    return {
      artifactType,
      ext,
      maxBytes: JSON_BODY_CAP_BYTES,
      contentTypes: ["application/json"],
    }
  }
  if (
    artifactType === DEVOTIONAL_INPUT_MANIFEST_ARTIFACT_TYPE &&
    ext === "json"
  ) {
    return {
      artifactType,
      ext,
      maxBytes: JSON_BODY_CAP_BYTES,
      contentTypes: ["application/json"],
    }
  }
  if (artifactType === DEVOTIONAL_MUSIC_ARTIFACT_TYPE && ext === "mp3") {
    return {
      artifactType,
      ext,
      maxBytes: MUSIC_BODY_CAP_BYTES,
      contentTypes: ["audio/mpeg", "audio/mp3", "application/octet-stream"],
    }
  }
  if (NARRATION_ARTIFACT.test(artifactType) && ext === "mp3") {
    return {
      artifactType,
      ext,
      maxBytes: NARRATION_BODY_CAP_BYTES,
      contentTypes: ["audio/mpeg", "audio/mp3", "application/octet-stream"],
    }
  }
  return null
}

async function readBodyCapped(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(request.headers["content-length"])
  if (Number.isFinite(declared) && declared > maxBytes) {
    request.resume()
    return null
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maxBytes) return null
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

function parseArtifactPath(
  pathname: string,
  prefix: string,
): { assetId: string; artifactType: string; ext: string } | null {
  const match = new RegExp(`^/${prefix}/([^/]+)/([^/.]+)\\.([^/.]+)$`).exec(
    pathname,
  )
  if (!match?.[1] || !match[2] || !match[3]) return null
  let assetId: string
  let artifactType: string
  let ext: string
  try {
    assetId = decodeURIComponent(match[1])
    artifactType = decodeURIComponent(match[2])
    ext = decodeURIComponent(match[3])
  } catch {
    return null
  }
  if (
    !SAFE_ID.test(assetId) ||
    !SAFE_ID.test(artifactType) ||
    !SAFE_ID.test(ext) ||
    assetId.length > 128 ||
    artifactType.length > 128 ||
    ext.length > 16
  ) {
    return null
  }
  return { assetId, artifactType, ext }
}

export type DevotionalArtifactsRouteOptions = {
  /** Backwards-compatible test injection. When supplied it drives both stores. */
  storage?: Storage
  workspaceStorage?: Storage
  legacyStorage?: Storage
  auth?: ValidateBearerOptions
}

export function createDevotionalArtifactsRoute({
  storage,
  workspaceStorage = storage ?? createDevotionalStorage(),
  legacyStorage = storage ?? createStorage(),
  auth = {},
}: DevotionalArtifactsRouteOptions = {}) {
  function authorize(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    const outcome = validateBearer(request.headers.authorization, auth)
    if (outcome === "ok") return true
    sendJson(response, outcome === "config_missing" ? 503 : 401, {
      error: outcome,
    })
    return false
  }

  return async function handleDevotionalArtifactsRoute(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method === "PUT") {
      const parsedPath = parseArtifactPath(url.pathname, "devotional-inputs")
      if (!parsedPath) return false
      if (!authorize(request, response)) return true
      const allowed = inputArtifact(parsedPath.artifactType, parsedPath.ext)
      if (!allowed) {
        sendJson(response, 400, { error: "invalid_artifact" })
        return true
      }
      const header = request.headers["content-type"]
      const contentType = (Array.isArray(header) ? header[0] : (header ?? ""))
        .split(";", 1)[0]!
        .trim()
        .toLowerCase()
      if (!allowed.contentTypes.includes(contentType)) {
        sendJson(response, 400, { error: "invalid_content_type" })
        return true
      }
      const body = await readBodyCapped(request, allowed.maxBytes)
      if (!body) {
        sendJson(response, 413, { error: "body_too_large" })
        return true
      }
      if (body.byteLength === 0) {
        sendJson(response, 400, { error: "invalid_body" })
        return true
      }
      let persisted: Buffer = body
      if (allowed.ext === "json") {
        let payload: unknown
        try {
          payload = JSON.parse(body.toString("utf8"))
        } catch {
          sendJson(response, 400, { error: "invalid_body" })
          return true
        }
        const parsed =
          allowed.artifactType === DEVOTIONAL_INPUT_MANIFEST_ARTIFACT_TYPE
            ? manifestSchema.safeParse(payload)
            : devotionalRenderInputSchema.safeParse(payload)
        if (!parsed.success) {
          sendJson(response, 400, { error: "invalid_body" })
          return true
        }
        // Validate the submitted JSON but retain the exact bytes. The digest is
        // the content identity; schema defaults must not silently rewrite it.
        persisted = body
      }
      const workspaceGeneration = Number(
        request.headers["x-devotional-workspace-generation"],
      )
      const attemptId = request.headers["x-devotional-attempt-id"]
      const runId = request.headers["x-devotional-run-id"]
      const digest = request.headers["x-content-sha256"]
      const declaredSize = Number(request.headers["x-content-size"])
      if (
        !Number.isSafeInteger(workspaceGeneration) ||
        workspaceGeneration <= 0 ||
        typeof attemptId !== "string" ||
        typeof runId !== "string" ||
        typeof digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(digest) ||
        !Number.isSafeInteger(declaredSize) ||
        declaredSize <= 0
      ) {
        sendJson(response, 400, { error: "invalid_workspace_identity" })
        return true
      }
      const attempt = { workspaceGeneration, attemptId, runId }
      const key =
        allowed.artifactType === DEVOTIONAL_INPUT_MANIFEST_ARTIFACT_TYPE
          ? devotionalManifestKey(attempt, "run-input")
          : devotionalWorkspaceKey(
              attempt,
              "run-input",
              digest,
              `${allowed.artifactType}.${allowed.ext}`,
            )
      let ref: WorkspaceArtifactRef
      try {
        ref = await workspaceStorage.writeWorkspaceArtifact({
          key,
          body: persisted,
          digest,
          size: declaredSize,
          contentType:
            allowed.ext === "json" ? "application/json" : "audio/mpeg",
          attempt,
        })
      } catch (error) {
        if (error instanceof ArtifactIntegrityError) {
          sendJson(response, 409, { error: error.reason })
          return true
        }
        throw error
      }
      sendJson(response, 201, {
        artifact: {
          assetId: parsedPath.assetId,
          artifactType: allowed.artifactType,
          ext: allowed.ext,
          ...ref,
        },
      })
      return true
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const parsedPath = parseArtifactPath(url.pathname, "artifacts")
      if (!parsedPath) return false
      if (!authorize(request, response)) return true
      const allowedOutput =
        parsedPath.ext === "mp4" &&
        (parsedPath.artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE ||
          parsedPath.artifactType === DEVOTIONAL_WIDE_ARTIFACT_TYPE)
      if (!allowedOutput) {
        sendJson(response, 404, { error: "not_found" })
        return true
      }
      try {
        const rangeHeader = request.headers.range
        const manifestRef = devotionalManifestRefFromAssetId(parsedPath.assetId)
        let artifact
        if (manifestRef?.key.includes("/attempt-output/")) {
          const manifestBytes =
            await workspaceStorage.readWorkspaceArtifact(manifestRef)
          let manifestPayload: unknown
          try {
            manifestPayload = JSON.parse(
              Buffer.from(manifestBytes).toString("utf8"),
            )
          } catch {
            throw new ArtifactIntegrityError("output manifest is not JSON")
          }
          const manifest = manifestSchema.safeParse(manifestPayload)
          if (!manifest.success || manifest.data.kind !== "attempt-output") {
            throw new ArtifactIntegrityError("output manifest is incomplete")
          }
          const output = manifest.data.artifacts.find(
            (entry) =>
              entry.artifactType === parsedPath.artifactType &&
              entry.ext === parsedPath.ext,
          )
          if (!output) {
            throw new ArtifactIntegrityError("output manifest is incomplete")
          }
          if (request.method === "HEAD") {
            await workspaceStorage.verifyWorkspaceArtifact(output.ref)
            response.writeHead(200, {
              "Content-Type": "video/mp4",
              "Content-Length": String(output.ref.size),
              "X-Content-Sha256": output.ref.digest,
            })
            response.end()
            return true
          }
          artifact = await workspaceStorage.readWorkspaceArtifactStream(
            output.ref,
            Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader,
          )
        } else {
          if (request.method === "HEAD") {
            const exists = await legacyStorage.artifactExists(
              parsedPath.assetId,
              parsedPath.artifactType,
              parsedPath.ext,
            )
            if (!exists) throw new ArtifactNotFoundError(parsedPath.assetId)
            response.writeHead(200, { "Content-Type": "video/mp4" })
            response.end()
            return true
          }
          artifact = await legacyStorage.readArtifactStream(
            parsedPath.assetId,
            parsedPath.artifactType,
            parsedPath.ext,
            Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader,
          )
        }
        response.writeHead(artifact.contentRange ? 206 : 200, {
          "Content-Type": "video/mp4",
          "Cache-Control": "private, max-age=31536000, immutable",
          "Accept-Ranges": "bytes",
          "Content-Length": String(artifact.contentLength),
          ...(artifact.contentRange
            ? { "Content-Range": artifact.contentRange }
            : {}),
        })
        await pipeline(artifact.stream, response)
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          sendJson(response, 404, { error: "not_found" })
          return true
        }
        if (error instanceof ArtifactRangeNotSatisfiableError) {
          response.writeHead(416, {
            "Content-Range": `bytes */${error.totalSize}`,
          })
          response.end()
          return true
        }
        if (error instanceof ArtifactIntegrityError) {
          sendJson(response, 409, { error: error.reason })
          return true
        }
        throw error
      }
      return true
    }

    return false
  }
}
