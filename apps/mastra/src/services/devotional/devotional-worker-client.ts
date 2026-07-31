import { createHash } from "node:crypto"

import { z } from "zod"

import { env } from "../../config/env"
import type { RenderDocument } from "./authored-data"
import { readResponseJsonCapped } from "./bounded-response"
import type { ProducedDevotionalAudio } from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"
import type { DevotionalSourceRef } from "./workspace/state-schema"

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
const SHA256 = /^[a-f0-9]{64}$/

const AttemptSchema = z.object({
  workspaceGeneration: z.number().int().positive(),
  attemptId: z.string().regex(SAFE_ID).max(128),
  runId: z.string().regex(SAFE_ID).max(128),
})

const WorkspaceRefSchema = z.object({
  schemaVersion: z.literal("2"),
  key: z.string().min(1),
  digest: z.string().regex(SHA256),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
  attempt: AttemptSchema,
})

const ArtifactRefSchema = z
  .object({
    assetId: z.string().regex(SAFE_ID),
    artifactType: z.string().regex(SAFE_ID),
    ext: z.string().regex(SAFE_ID),
    schemaVersion: z.literal("2").optional(),
    key: z.string().min(1).optional(),
    digest: z.string().regex(SHA256).optional(),
    size: z.number().int().positive().optional(),
    contentType: z.string().min(1).optional(),
    attempt: AttemptSchema.optional(),
  })
  .passthrough()

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
  schemaVersion?: "2"
  key?: string
  digest?: string
  size?: number
  contentType?: string
  attempt?: z.infer<typeof AttemptSchema>
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
  renderStyle: string,
  renderConfig: RenderDocument,
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
  const passage = devotional.passage as GeneratedDevotional["passage"] & {
    clipStartSec?: number
    clipLengthSec?: number
  }
  return {
    schemaVersion: "1" as const,
    renderConfig,
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
      style: renderStyle,
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
  attempt: z.infer<typeof AttemptSchema>,
  assetId: string,
  artifactType: string,
  ext: "json" | "mp3",
  body: Uint8Array | string,
): Promise<z.infer<typeof WorkspaceRefSchema>> {
  const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body)
  const digest = createHash("sha256").update(bytes).digest("hex")
  const response = await request(
    client,
    `/devotional-inputs/${encodeURIComponent(assetId)}/${encodeURIComponent(
      artifactType,
    )}.${ext}`,
    {
      method: "PUT",
      headers: {
        "content-type": ext === "json" ? "application/json" : "audio/mpeg",
        "x-devotional-workspace-generation": String(
          attempt.workspaceGeneration,
        ),
        "x-devotional-attempt-id": attempt.attemptId,
        "x-devotional-run-id": attempt.runId,
        "x-content-sha256": digest,
        "x-content-size": String(bytes.byteLength),
      },
      body: bytes,
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
  const payload = z
    .object({ artifact: WorkspaceRefSchema.passthrough() })
    .safeParse(await jsonResponse(response))
  if (!payload.success) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "shorts-worker returned an invalid Workspace artifact reference",
      false,
    )
  }
  if (
    payload.data.artifact.digest !== digest ||
    payload.data.artifact.size !== bytes.byteLength ||
    payload.data.artifact.attempt.workspaceGeneration !==
      attempt.workspaceGeneration ||
    payload.data.artifact.attempt.attemptId !== attempt.attemptId ||
    payload.data.artifact.attempt.runId !== attempt.runId
  ) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "shorts-worker returned a mismatched Workspace artifact reference",
      false,
    )
  }
  return payload.data.artifact
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
        (ref.assetId === outputAssetId || ref.assetId.startsWith("dv2o_")) &&
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
  const checked = (ref: z.infer<typeof ArtifactRefSchema>) => {
    if (ref.assetId.startsWith("dv2o_")) {
      const parsed = WorkspaceRefSchema.safeParse(ref)
      if (!parsed.success || ref.contentType !== "video/mp4") {
        throw new DevotionalWorkerError(
          "invalid_response",
          "shorts-worker returned an incomplete v2 video reference",
          false,
        )
      }
    }
    return ref as DevotionalVideoArtifact
  }
  return { portrait: checked(portrait), wide: checked(wide) }
}

export type DevotionalWorkerRenderInput = {
  runId: string
  devotional: GeneratedDevotional
  audio: ProducedDevotionalAudio
  workspaceGeneration: number
  attemptId: string
  selectedSources: readonly DevotionalSourceRef[]
  renderStyle?: string
  renderConfig: RenderDocument
}

export async function renderDevotionalOnWorker(
  input: DevotionalWorkerRenderInput,
  options: DevotionalWorkerClientOptions = {},
): Promise<DevotionalVideoArtifacts> {
  const client = resolveClient(options)
  const safeRunId = input.runId
  if (!SAFE_ID.test(safeRunId)) {
    throw new DevotionalWorkerError("invalid_response", "invalid run id", false)
  }
  if (
    !input.workspaceGeneration ||
    !input.attemptId ||
    !input.renderConfig ||
    !input.selectedSources?.length
  ) {
    throw new DevotionalWorkerError(
      "config_missing",
      "workspaceGeneration, attemptId, selectedSources, and renderConfig are required for devotional rendering",
      false,
    )
  }
  const renderStyle = input.renderStyle ?? "grain"
  if (!Object.hasOwn(input.renderConfig.filters, renderStyle)) {
    throw new DevotionalWorkerError(
      "invalid_response",
      `render style ${renderStyle} is not present in the Workspace render config`,
      false,
    )
  }
  const safeAttemptId = input.attemptId
  if (!SAFE_ID.test(safeAttemptId) || safeAttemptId.length > 128) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "invalid attempt id",
      false,
    )
  }
  const attempt = {
    workspaceGeneration: input.workspaceGeneration,
    attemptId: safeAttemptId,
    runId: safeRunId,
  }
  const attemptToken = createHash("sha256")
    .update(safeAttemptId)
    .digest("hex")
    .slice(0, 24)
  const stagingAssetId = `dv2s_g${input.workspaceGeneration}_${attemptToken}`
  const outputAssetId = `dv2o_g${input.workspaceGeneration}_${attemptToken}`
  const spec = buildWorkerInput(
    input.devotional,
    input.audio,
    renderStyle,
    input.renderConfig,
  )
  const specJson = JSON.stringify(spec)
  const hash = createHash("sha256").update(specJson)

  const uploaded: Array<{
    artifactType: string
    ext: "json" | "mp3"
    ref: z.infer<typeof WorkspaceRefSchema>
  }> = []
  for (const segment of input.audio.segments) {
    hash.update(segment.audio.bytes)
    const artifactType = narrationArtifactType(segment.id)
    const ref = await upload(
      client,
      attempt,
      stagingAssetId,
      artifactType,
      "mp3",
      segment.audio.bytes,
    )
    uploaded.push({ artifactType, ext: "mp3", ref })
  }
  if (input.audio.music) {
    hash.update(input.audio.music.audio.bytes)
    const ref = await upload(
      client,
      attempt,
      stagingAssetId,
      DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
      "mp3",
      input.audio.music.audio.bytes,
    )
    uploaded.push({
      artifactType: DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
      ext: "mp3",
      ref,
    })
  }
  const specRef = await upload(
    client,
    attempt,
    stagingAssetId,
    DEVOTIONAL_INPUT_ARTIFACT_TYPE,
    "json",
    specJson,
  )
  uploaded.push({
    artifactType: DEVOTIONAL_INPUT_ARTIFACT_TYPE,
    ext: "json",
    ref: specRef,
  })
  const manifestJson = JSON.stringify({
    schemaVersion: "2",
    kind: "run-input",
    attempt,
    artifacts: uploaded,
    selectedSources: input.selectedSources ?? [],
  })
  const manifestRef = await upload(
    client,
    attempt,
    stagingAssetId,
    "devotional-input-manifest-v2",
    "json",
    manifestJson,
  )
  const inputAssetId = `dv2i_g${input.workspaceGeneration}_${attemptToken}_${manifestRef.digest}_${manifestRef.size}`

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

export async function verifyDevotionalWorkerArtifacts(
  artifacts: DevotionalVideoArtifacts,
  options: DevotionalWorkerClientOptions = {},
): Promise<void> {
  const client = resolveClient(options)
  for (const artifact of [artifacts.portrait, artifacts.wide]) {
    const response = await request(
      client,
      `/artifacts/${encodeURIComponent(artifact.assetId)}/${encodeURIComponent(
        artifact.artifactType,
      )}.${artifact.ext}`,
      { method: "HEAD" },
      HTTP_TIMEOUT_MS,
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new DevotionalWorkerError(
        "job_failed",
        `devotional artifact integrity verification failed with HTTP ${response.status}`,
        false,
      )
    }
    if (
      artifact.digest &&
      response.headers.get("x-content-sha256") !== artifact.digest
    ) {
      throw new DevotionalWorkerError(
        "job_failed",
        "devotional artifact digest changed after rendering",
        false,
      )
    }
    await response.body?.cancel().catch(() => undefined)
  }
}

export const _internals = { buildWorkerInput, expectedArtifacts, headerDate }
