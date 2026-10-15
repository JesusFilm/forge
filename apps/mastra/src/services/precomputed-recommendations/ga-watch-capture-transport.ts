import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"

import { env } from "../../config/env"
import { MAX_GA_CAPTURE_ARTIFACT_BYTES } from "./ga-watch-capture-artifact"
import { HistoricalAnalyticsError } from "./historical-analytics"
import { assertPrivateUrl } from "./source-generation"

const CONTENT_TYPE = "application/vnd.forge.ga-capture-v1"
const HEX = /^[a-f0-9]{64}$/u

export type GaCaptureSnapshotRef = {
  version: "ga_watch_capture_v1"
  storageKey: string
  artifactSha256: string
  artifactBytes: number
  headerSha256: string
  generationId: string
  generationInputDigest: string
  sourceSetDigest: string
  inputCutoff: string
  selectedCorpusDigest: string
  candidatePoolDigest: string
  routeMappingDigest: string
  querySpecDigest: string
  sourcePatternTableDigest: string
  baseQualificationDigest: string
  propertyId: string
  propertyTimeZone: string
  requestedStart: string
  requestedEnd: string
  usableStart: string
  usableEnd: string
  sourceAvailability: unknown
  captureStartedAt: string
  captureCompletedAt: string
  verification: "two_matching_passes"
  startRows: number
  referrerRows: number
  startPages: number
  referrerPages: number
  physicalHttpAttempts: number
  physicalSucceededCalls: number
}

export type GaCaptureTransport = {
  upload(input: {
    generationId: string
    generationInputDigest: string
    path: string
    artifactSha256: string
    artifactBytes: number
  }): Promise<GaCaptureSnapshotRef>
  download(input: {
    generationId: string
    generationInputDigest: string
    artifactSha256: string
    artifactBytes: number
    directory: string
  }): Promise<string>
}

function privateCaptureEndpoint(): { url: string; key: string } {
  const key = env.ADMIN_MASTRA_RECOMMENDATION_API_KEY
  const ingestUrl = env.ADMIN_RECOMMENDATION_INGEST_URL
  if (!key || !ingestUrl)
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const url = new URL(
    "/api/internal/mastra/precomputed-recommendations/ga-capture",
    assertPrivateUrl(ingestUrl),
  )
  return { url: assertPrivateUrl(url.toString()), key }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body)
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16_384)
        throw new HistoricalAnalyticsError("analytics_unavailable")
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new HistoricalAnalyticsError("analytics_unavailable")
  }
}

export function parseGaCaptureSnapshotRef(
  value: unknown,
): GaCaptureSnapshotRef {
  if (typeof value !== "object" || value === null)
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const ref = value as Record<string, unknown>
  if (
    ref.version !== "ga_watch_capture_v1" ||
    typeof ref.artifactSha256 !== "string" ||
    !HEX.test(ref.artifactSha256) ||
    typeof ref.headerSha256 !== "string" ||
    !HEX.test(ref.headerSha256) ||
    !Number.isSafeInteger(ref.artifactBytes) ||
    (ref.artifactBytes as number) > MAX_GA_CAPTURE_ARTIFACT_BYTES ||
    typeof ref.storageKey !== "string"
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  return ref as GaCaptureSnapshotRef
}

export function createAdminGaCaptureTransport(options?: {
  endpoint: { url: string; key: string }
  fetchImpl?: typeof fetch
}): GaCaptureTransport {
  const { url, key } = options?.endpoint ?? privateCaptureEndpoint()
  const fetchImpl = options?.fetchImpl ?? fetch
  return {
    async upload(input) {
      if (
        !HEX.test(input.artifactSha256) ||
        !Number.isSafeInteger(input.artifactBytes) ||
        input.artifactBytes > MAX_GA_CAPTURE_ARTIFACT_BYTES ||
        (await stat(input.path)).size !== input.artifactBytes
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const stream = createReadStream(input.path)
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": CONTENT_TYPE,
            "content-length": String(input.artifactBytes),
            "x-forge-generation-id": input.generationId,
            "x-forge-input-digest": input.generationInputDigest,
            "x-forge-artifact-sha256": input.artifactSha256,
          },
          body: Readable.toWeb(stream) as BodyInit,
          duplex: "half",
          redirect: "error",
          signal: AbortSignal.timeout(10 * 60_000),
        } as RequestInit & { duplex: "half" })
      } finally {
        stream.destroy()
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new HistoricalAnalyticsError("analytics_unavailable")
      }
      const envelope = (await boundedJson(response)) as {
        snapshotRef?: unknown
      }
      const ref = parseGaCaptureSnapshotRef(envelope.snapshotRef)
      if (
        ref.generationId !== input.generationId ||
        ref.generationInputDigest !== input.generationInputDigest ||
        ref.artifactSha256 !== input.artifactSha256 ||
        ref.artifactBytes !== input.artifactBytes
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      return ref
    },
    async download(input) {
      if (
        !HEX.test(input.artifactSha256) ||
        !Number.isSafeInteger(input.artifactBytes) ||
        input.artifactBytes < 1 ||
        input.artifactBytes > MAX_GA_CAPTURE_ARTIFACT_BYTES
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      await mkdir(input.directory, { recursive: true, mode: 0o700 })
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${key}`,
          "x-forge-generation-id": input.generationId,
          "x-forge-input-digest": input.generationInputDigest,
        },
        redirect: "error",
        signal: AbortSignal.timeout(10 * 60_000),
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined)
        throw new HistoricalAnalyticsError("analytics_unavailable")
      }
      if (
        response.headers.get("content-type")?.split(";")[0] !== CONTENT_TYPE ||
        Number(response.headers.get("content-length")) !==
          input.artifactBytes ||
        response.headers.get("x-forge-artifact-sha256") !== input.artifactSha256
      ) {
        await response.body.cancel().catch(() => undefined)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      }
      const path = join(input.directory, `sealed-${randomUUID()}.bin`)
      const reader = response.body.getReader()
      let handle
      try {
        handle = await open(path, "wx", 0o600)
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        throw error
      }
      const hash = createHash("sha256")
      let bytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const data = Buffer.from(value)
          bytes += data.length
          if (
            bytes > MAX_GA_CAPTURE_ARTIFACT_BYTES ||
            bytes > input.artifactBytes
          )
            throw new HistoricalAnalyticsError("analytics_incomplete")
          hash.update(data)
          await handle.writeFile(data)
        }
        await handle.sync()
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        await handle.close()
        await unlink(path).catch(() => undefined)
        throw error
      }
      await handle.close()
      if (
        bytes !== input.artifactBytes ||
        hash.digest("hex") !== input.artifactSha256
      ) {
        await unlink(path).catch(() => undefined)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      }
      return path
    },
  }
}
