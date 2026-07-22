import { createHash } from "node:crypto"

import { z } from "zod"

import { env } from "../../config/env"
import { readResponseJsonCapped } from "./bounded-response"
import type { ProducedDevotionalAudio } from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"
import { passageForChapter } from "./jesus-film-passages"
import { rotateFilter } from "./voice-rotation"

export const DEVOTIONAL_INPUT_ARTIFACT_TYPE = "devotional-render-input-v1"
export const DEVOTIONAL_MUSIC_ARTIFACT_TYPE = "devotional-music-v1"
export const DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE = "devotional-output-portrait-v1"
export const DEVOTIONAL_WIDE_ARTIFACT_TYPE = "devotional-output-wide-v1"

const HTTP_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 5_000
// Keep the orchestrator ceiling strictly above the worker's 70-minute render
// deadline so the worker can persist its terminal status after cleanup.
const POLL_TIMEOUT_MS = 80 * 60_000
const ARTIFACT_STREAM_TIMEOUT_MS = 20 * 60_000
const MAX_RESPONSE_BYTES = 256 * 1024
const SAFE_ID = /^[a-zA-Z0-9_-]+$/

const ArtifactRefSchema = z
  .object({
    assetId: z.string().regex(SAFE_ID),
    artifactType: z.string().regex(SAFE_ID),
    ext: z.string().regex(SAFE_ID),
  })
  .strict()

const JobStatusSchema = z
  .object({
    workerJobId: z.string(),
    kind: z.literal("devotional-render"),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    error: z
      .object({
        reason: z.string(),
        messages: z.array(z.string()),
        retryable: z.boolean(),
      })
      .nullable(),
    result: z
      .object({
        artifacts: z.array(ArtifactRefSchema),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough()

export type DevotionalVideoArtifact = {
  assetId: string
  artifactType:
    | typeof DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
    | typeof DEVOTIONAL_WIDE_ARTIFACT_TYPE
  ext: "mp4"
}

export type DevotionalVideoArtifacts = {
  portrait: DevotionalVideoArtifact
  wide: DevotionalVideoArtifact
}

export type DevotionalWorkerClientOptions = {
  baseUrl?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  abortSignal?: AbortSignal
}

export class DevotionalWorkerError extends Error {
  override readonly name = "DevotionalWorkerError"

  constructor(
    readonly code:
      | "config_missing"
      | "invalid_response"
      | "job_failed"
      | "job_timeout"
      | "upstream_failed",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

type ResolvedClient = {
  baseUrl: string
  apiKey: string
  fetchImpl: typeof fetch
}

function resolveClient(options: DevotionalWorkerClientOptions): ResolvedClient {
  const baseUrl = options.baseUrl ?? env.SHORTS_WORKER_BASE_URL
  const apiKey = options.apiKey ?? env.SHORTS_WORKER_API_KEY
  if (!baseUrl || !apiKey) {
    throw new DevotionalWorkerError(
      "config_missing",
      "SHORTS_WORKER_BASE_URL and SHORTS_WORKER_API_KEY are required",
      false,
    )
  }
  const parsed = new URL(baseUrl)
  if (
    env.NODE_ENV === "production" &&
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new DevotionalWorkerError(
      "config_missing",
      "SHORTS_WORKER_BASE_URL must use https in production",
      false,
    )
  }
  return { baseUrl, apiKey, fetchImpl: options.fetchImpl ?? fetch }
}

function narrationArtifactType(segmentId: string): string {
  if (!SAFE_ID.test(segmentId) || segmentId.length > 64) {
    throw new DevotionalWorkerError(
      "invalid_response",
      `invalid narration segment id ${segmentId}`,
      false,
    )
  }
  return `devotional-narration-${segmentId}-v1`
}

function headerDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    throw new DevotionalWorkerError(
      "invalid_response",
      `invalid devotional date ${date}`,
      false,
    )
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() !== Number(match[2]) - 1 ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new DevotionalWorkerError(
      "invalid_response",
      `invalid devotional date ${date}`,
      false,
    )
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(parsed)
    .replace(",", " ·")
}

function buildWorkerInput(
  devotional: GeneratedDevotional,
  audio: ProducedDevotionalAudio,
) {
  const cards: Record<string, unknown>[] = []
  const byId = new Map(audio.segments.map((segment) => [segment.id, segment]))
  if (byId.has("cover")) {
    cards.push({ kind: "cover", title: devotional.title, narrationId: "cover" })
  }
  if (byId.has("scripture")) {
    cards.push({
      kind: "scripture",
      verse: devotional.scripture.text,
      citation: devotional.scripture.reference,
      narrationId: "scripture",
    })
  }
  cards.push({ kind: "video" })
  for (const segment of audio.segments
    .filter(({ id }) => /^reflection-\d+$/.test(id))
    .sort((a, b) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]))) {
    const index = Number(segment.id.split("-")[1]) - 1
    cards.push({
      kind: "reflection-focus",
      ...(index > 0 ? { sectionLabel: "" } : {}),
      text: segment.text.replace(/^Reflect on this\.\s*/, ""),
      ...(devotional.reflectionHighlights?.[index]
        ? { highlight: devotional.reflectionHighlights[index] }
        : {}),
      narrationId: segment.id,
    })
  }
  if (byId.has("conclusion")) {
    cards.push({
      kind: "conclusion",
      text: devotional.conclusion,
      highlight: devotional.conclusion,
      holdSec: 2,
      narrationId: "conclusion",
    })
  }
  if (byId.has("questions")) {
    cards.push({
      kind: "questions",
      questions: [devotional.question],
      prayer: devotional.prayer,
      holdSec: 5,
      narrationId: "questions",
    })
  }
  const passage = passageForChapter(devotional.clip.index)
  return {
    schemaVersion: "1" as const,
    headerDate: headerDate(devotional.date),
    ...(devotional.reflection.attribution
      ? { attribution: devotional.reflection.attribution }
      : {}),
    media: {
      mediaId: devotional.clip.id,
      clipStartSec: passage?.clipStartSec ?? 0,
      clipLengthSec: passage?.clipLengthSec ?? 18,
      videoCardSec: passage?.clipLengthSec ?? 18,
    },
    cards,
    music: audio.music != null,
    render: {
      style: rotateFilter(devotional.sequence),
      layout: "grounded" as const,
      musicVolume: 0.12,
      xfadeSec: 1.2,
      videoAudioLevel: 0.55,
    },
  }
}

async function request(
  client: ResolvedClient,
  pathname: string,
  init: RequestInit,
  timeoutMs = HTTP_TIMEOUT_MS,
  abortSignal?: AbortSignal,
): Promise<Response> {
  try {
    return await client.fetchImpl(new URL(pathname, client.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${client.apiKey}`,
        ...init.headers,
      },
      redirect: "error",
      signal: abortSignal
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), abortSignal])
        : AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    throw new DevotionalWorkerError(
      "upstream_failed",
      cause instanceof Error ? cause.message : "shorts-worker request failed",
      true,
    )
  }
}

async function upload(
  client: ResolvedClient,
  assetId: string,
  artifactType: string,
  ext: "json" | "mp3",
  body: Uint8Array | string,
): Promise<void> {
  const response = await request(
    client,
    `/devotional-inputs/${encodeURIComponent(assetId)}/${encodeURIComponent(
      artifactType,
    )}.${ext}`,
    {
      method: "PUT",
      headers: {
        "content-type": ext === "json" ? "application/json" : "audio/mpeg",
      },
      body: typeof body === "string" ? body : new Uint8Array(body).buffer,
    },
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new DevotionalWorkerError(
      "upstream_failed",
      `shorts-worker artifact upload returned HTTP ${response.status}`,
      response.status >= 500 || response.status === 429,
    )
  }
  await response.body?.cancel().catch(() => undefined)
}

async function jsonResponse(response: Response): Promise<unknown> {
  return readResponseJsonCapped(response, MAX_RESPONSE_BYTES)
}

function expectedArtifacts(
  outputAssetId: string,
  refs: z.infer<typeof ArtifactRefSchema>[],
): DevotionalVideoArtifacts {
  const find = (artifactType: string) =>
    refs.find(
      (ref) =>
        ref.assetId === outputAssetId &&
        ref.artifactType === artifactType &&
        ref.ext === "mp4",
    )
  const portrait = find(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE)
  const wide = find(DEVOTIONAL_WIDE_ARTIFACT_TYPE)
  if (!portrait || !wide) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "shorts-worker completed without both devotional video artifacts",
      false,
    )
  }
  return {
    portrait: {
      assetId: portrait.assetId,
      artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      ext: "mp4",
    },
    wide: {
      assetId: wide.assetId,
      artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
      ext: "mp4",
    },
  }
}

export async function renderDevotionalOnWorker(
  input: {
    runId: string
    devotional: GeneratedDevotional
    audio: ProducedDevotionalAudio
  },
  options: DevotionalWorkerClientOptions = {},
): Promise<DevotionalVideoArtifacts> {
  const client = resolveClient(options)
  const safeRunId = input.runId.replaceAll("-", "_")
  if (!SAFE_ID.test(safeRunId)) {
    throw new DevotionalWorkerError("invalid_response", "invalid run id", false)
  }
  const inputAssetId = `devotional_input_${safeRunId}`
  const outputAssetId = `devotional_output_${safeRunId}`
  const spec = buildWorkerInput(input.devotional, input.audio)
  const specJson = JSON.stringify(spec)
  const hash = createHash("sha256").update(specJson)

  for (const segment of input.audio.segments) {
    hash.update(segment.audio.bytes)
    await upload(
      client,
      inputAssetId,
      narrationArtifactType(segment.id),
      "mp3",
      segment.audio.bytes,
    )
  }
  if (input.audio.music) {
    hash.update(input.audio.music.audio.bytes)
    await upload(
      client,
      inputAssetId,
      DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
      "mp3",
      input.audio.music.audio.bytes,
    )
  }
  await upload(
    client,
    inputAssetId,
    DEVOTIONAL_INPUT_ARTIFACT_TYPE,
    "json",
    specJson,
  )

  const submitted = await request(client, "/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "devotional-render",
      runId: safeRunId,
      inputAssetId,
      outputAssetId,
      inputHash: hash.digest("hex"),
    }),
  })
  const submitBody = await jsonResponse(submitted)
  const workerJobId =
    submitBody &&
    typeof submitBody === "object" &&
    "workerJobId" in submitBody &&
    typeof submitBody.workerJobId === "string"
      ? submitBody.workerJobId
      : null
  if (!submitted.ok || !workerJobId) {
    throw new DevotionalWorkerError(
      "upstream_failed",
      `shorts-worker job submission failed with HTTP ${submitted.status}`,
      submitted.status >= 500 || submitted.status === 409,
    )
  }

  const intervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const timeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs
  const cancelWorkerJob = async () => {
    await request(client, `/jobs/${encodeURIComponent(workerJobId)}`, {
      method: "DELETE",
    }).catch(() => undefined)
  }
  const cancelled = async (): Promise<never> => {
    await cancelWorkerJob()
    throw new DevotionalWorkerError(
      "job_failed",
      "shorts-worker devotional render was cancelled",
      false,
    )
  }
  while (Date.now() <= deadline) {
    if (options.abortSignal?.aborted) {
      await cancelled()
    }
    const response = await request(
      client,
      `/jobs/${encodeURIComponent(workerJobId)}`,
      { method: "GET" },
      HTTP_TIMEOUT_MS,
      options.abortSignal,
    ).catch(async (error) => {
      if (options.abortSignal?.aborted) await cancelled()
      throw error
    })
    const parsed = JobStatusSchema.safeParse(await jsonResponse(response))
    if (!response.ok || !parsed.success) {
      throw new DevotionalWorkerError(
        "invalid_response",
        `shorts-worker job status returned HTTP ${response.status}`,
        response.status >= 500,
      )
    }
    if (parsed.data.status === "completed" && parsed.data.result) {
      return expectedArtifacts(outputAssetId, parsed.data.result.artifacts)
    }
    if (parsed.data.status === "failed" || parsed.data.status === "cancelled") {
      throw new DevotionalWorkerError(
        "job_failed",
        parsed.data.error?.messages.join("; ") ?? "shorts-worker job failed",
        parsed.data.error?.retryable ?? false,
      )
    }
    if (options.abortSignal) {
      await new Promise<void>((resolve) => {
        const signal = options.abortSignal!
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort)
          resolve()
        }, intervalMs)
        signal.addEventListener("abort", onAbort, { once: true })
      })
    } else {
      await sleep(intervalMs)
    }
  }
  await cancelWorkerJob()
  throw new DevotionalWorkerError(
    "job_timeout",
    `shorts-worker devotional render exceeded ${timeoutMs}ms`,
    true,
  )
}

export function devotionalArtifactProxyPath(
  artifact: DevotionalVideoArtifact,
): string {
  return `/forge-video-first-devotional/assets/${encodeURIComponent(
    artifact.assetId,
  )}/${encodeURIComponent(artifact.artifactType)}/${artifact.ext}`
}

export async function fetchDevotionalWorkerArtifact(
  artifact: DevotionalVideoArtifact,
  range?: string,
  options: DevotionalWorkerClientOptions = {},
): Promise<Response> {
  const client = resolveClient(options)
  return request(
    client,
    `/artifacts/${encodeURIComponent(artifact.assetId)}/${encodeURIComponent(
      artifact.artifactType,
    )}.${artifact.ext}`,
    {
      method: "GET",
      ...(range ? { headers: { range } } : {}),
    },
    ARTIFACT_STREAM_TIMEOUT_MS,
  )
}

export const _internals = { buildWorkerInput, expectedArtifacts, headerDate }
