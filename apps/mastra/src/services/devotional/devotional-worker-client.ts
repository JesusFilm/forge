import { createHash } from "node:crypto"

import { z } from "zod"
import {
  devotionalAttemptIdentitySchema,
  devotionalWorkspaceManifestSchema,
  devotionalWorkspaceTransferSchema,
  type DevotionalWorkspaceTransfer,
} from "@forge/devotional-workspace"

import { env } from "../../config/env"
import type { RenderDocument } from "./authored-data"
import { readResponseJsonCapped } from "./bounded-response"
import type { ProducedDevotionalAudio } from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"
import type { DevotionalSourceRef } from "./workspace/state-schema"
import {
  DevotionalWorkspaceArtifactRefSchema,
  devotionalAttemptRoot,
  devotionalWorkspaceArtifactKey,
  devotionalWorkspaceManifestKey,
  type DevotionalAttemptIdentity,
  type DevotionalWorkspaceArtifactRef,
  type DevotionalWorkspaceMediaStore,
  type DevotionalWorkspaceReadGrant,
  type DevotionalWorkspaceUploadGrant,
} from "./workspace/media-store"

export const DEVOTIONAL_INPUT_ARTIFACT_TYPE = "devotional-render-input-v1"
export const DEVOTIONAL_MUSIC_ARTIFACT_TYPE = "devotional-music-v1"
export const DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE = "devotional-output-portrait-v1"
export const DEVOTIONAL_WIDE_ARTIFACT_TYPE = "devotional-output-wide-v1"

const HTTP_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 5_000
// Shorts Worker deliberately keeps job state in memory. A deployment can make
// an accepted job return 404, so retry the same deterministic submission a
// bounded number of times without extending the original poll deadline.
const MAX_LOST_JOB_RESUBMITS = 2
// Keep the orchestrator ceiling strictly above the worker's 70-minute render
// deadline so the worker can persist its terminal status after cleanup.
const POLL_TIMEOUT_MS = 80 * 60_000
const ARTIFACT_STREAM_TIMEOUT_MS = 20 * 60_000
const MAX_RESPONSE_BYTES = 256 * 1024
const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const SHA256 = /^[a-f0-9]{64}$/

const AttemptSchema = devotionalAttemptIdentitySchema

const WorkspaceRefSchema = DevotionalWorkspaceArtifactRefSchema
const WorkspaceManifestSchema = devotionalWorkspaceManifestSchema
const WorkspacePlaybackManifestSchema = WorkspaceManifestSchema.extend({
  // Pre-cutover Worker-owned manifests included render diagnostics here.
  // Playback ignores them but must keep serving already-issued v2 asset IDs.
  report: z.unknown().optional(),
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
    etag: z.string().min(1).max(256).optional(),
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

function parseWorkspaceRef(ref: z.infer<typeof ArtifactRefSchema>) {
  return WorkspaceRefSchema.safeParse({
    schemaVersion: ref.schemaVersion,
    key: ref.key,
    digest: ref.digest,
    size: ref.size,
    contentType: ref.contentType,
    etag: ref.etag,
    attempt: ref.attempt,
  })
}

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
  etag?: string
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
  workspaceMediaStore?: DevotionalWorkspaceMediaStore
}

type SignedWorkspaceTransfer = DevotionalWorkspaceTransfer

let configuredWorkspaceMediaStore: DevotionalWorkspaceMediaStore | undefined

export function configureDevotionalWorkerWorkspaceMediaStore(
  mediaStore: DevotionalWorkspaceMediaStore,
): void {
  configuredWorkspaceMediaStore = mediaStore
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

async function uploadLegacy(
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

async function writeWorkspaceInput(options: {
  store: DevotionalWorkspaceMediaStore
  attempt: DevotionalAttemptIdentity
  artifactType: string
  ext: "json" | "mp3"
  body: Uint8Array | string
}): Promise<{
  artifactType: string
  ext: "json" | "mp3"
  ref: DevotionalWorkspaceArtifactRef
  grant: DevotionalWorkspaceReadGrant
}> {
  const body =
    typeof options.body === "string"
      ? Buffer.from(options.body)
      : Buffer.from(options.body)
  const digest = createHash("sha256").update(body).digest("hex")
  const ref = await options.store.writeImmutableArtifact({
    key: devotionalWorkspaceArtifactKey({
      attempt: options.attempt,
      area: "run-input",
      digest,
      fileName: `${options.artifactType}.${options.ext}`,
    }),
    body,
    contentType: options.ext === "json" ? "application/json" : "audio/mpeg",
    attempt: options.attempt,
  })
  return {
    artifactType: options.artifactType,
    ext: options.ext,
    ref,
    grant: await options.store.createReadGrant(ref),
  }
}

function workspaceAssetId(options: {
  kind: "input" | "output"
  attempt: DevotionalAttemptIdentity
  manifest: DevotionalWorkspaceArtifactRef
}): string {
  const prefix = options.kind === "input" ? "dv2i" : "dv2o"
  const token = devotionalAttemptRoot(options.attempt).split("/").at(-1)
  return `${prefix}_g${options.attempt.workspaceGeneration}_${token}_${options.manifest.digest}_${options.manifest.size}`
}

function parseWorkspaceAssetId(assetId: string): {
  kind: "input" | "output"
  workspaceGeneration: number
  attemptToken: string
  manifestDigest: string
  manifestSize: number
} | null {
  const match = /^(dv2i|dv2o)_g(\d+)_([a-f0-9]{24})_([a-f0-9]{64})_(\d+)$/.exec(
    assetId,
  )
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
    return null
  }
  const workspaceGeneration = Number(match[2])
  const manifestSize = Number(match[5])
  if (
    !Number.isSafeInteger(workspaceGeneration) ||
    workspaceGeneration <= 0 ||
    !Number.isSafeInteger(manifestSize) ||
    manifestSize <= 0
  ) {
    return null
  }
  return {
    kind: match[1] === "dv2i" ? "input" : "output",
    workspaceGeneration,
    attemptToken: match[3],
    manifestDigest: match[4],
    manifestSize,
  }
}

async function finalizeSignedOutputs(options: {
  store: DevotionalWorkspaceMediaStore
  attempt: DevotionalAttemptIdentity
  outputAssetId: string
  refs: z.infer<typeof ArtifactRefSchema>[]
  grants: readonly DevotionalWorkspaceUploadGrant[]
}): Promise<DevotionalVideoArtifacts> {
  const find = (artifactType: string) =>
    options.refs.find(
      (ref) =>
        ref.assetId === options.outputAssetId &&
        ref.artifactType === artifactType &&
        ref.ext === "mp4",
    )
  const portrait = find(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE)
  const wide = find(DEVOTIONAL_WIDE_ARTIFACT_TYPE)
  if (!portrait || !wide) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "shorts-worker completed without both devotional video uploads",
      false,
    )
  }
  const finalize = async (
    ref: typeof portrait,
    fileName: "portrait.mp4" | "wide.mp4",
  ) => {
    const parsed = parseWorkspaceRef(ref)
    const grant = options.grants.find((entry) => entry.key === ref.key)
    if (
      !parsed.success ||
      !grant ||
      parsed.data.contentType !== "video/mp4" ||
      parsed.data.attempt.workspaceGeneration !==
        options.attempt.workspaceGeneration ||
      parsed.data.attempt.attemptId !== options.attempt.attemptId ||
      parsed.data.attempt.runId !== options.attempt.runId
    ) {
      throw new DevotionalWorkerError(
        "invalid_response",
        "shorts-worker returned an invalid signed upload reference",
        false,
      )
    }
    return options.store.finalizeUpload({
      grant,
      digest: parsed.data.digest,
      size: parsed.data.size,
      attempt: options.attempt,
      fileName,
    })
  }
  const [portraitRef, wideRef] = await Promise.all([
    finalize(portrait, "portrait.mp4"),
    finalize(wide, "wide.mp4"),
  ])
  const manifestJson = JSON.stringify({
    schemaVersion: "2",
    kind: "attempt-output",
    attempt: options.attempt,
    artifacts: [
      {
        artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        ext: "mp4",
        ref: portraitRef,
      },
      {
        artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
        ext: "mp4",
        ref: wideRef,
      },
    ],
  })
  const manifest = await options.store.writeImmutableArtifact({
    key: devotionalWorkspaceManifestKey({
      attempt: options.attempt,
      area: "attempt-output",
    }),
    body: manifestJson,
    contentType: "application/json",
    attempt: options.attempt,
  })
  const assetId = workspaceAssetId({
    kind: "output",
    attempt: options.attempt,
    manifest,
  })
  return {
    portrait: {
      assetId,
      artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      ext: "mp4",
      ...portraitRef,
    },
    wide: {
      assetId,
      artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
      ext: "mp4",
      ...wideRef,
    },
  }
}

async function existingSignedOutputs(
  store: DevotionalWorkspaceMediaStore,
  attempt: DevotionalAttemptIdentity,
): Promise<DevotionalVideoArtifacts | null> {
  const existing = await store.readAttemptOutput(attempt)
  if (!existing) return null
  const find = (artifactType: string) =>
    existing.manifest.artifacts.find(
      (entry) => entry.artifactType === artifactType && entry.ext === "mp4",
    )?.ref
  const portrait = find(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE)
  const wide = find(DEVOTIONAL_WIDE_ARTIFACT_TYPE)
  if (!portrait || !wide) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "existing devotional output manifest is incomplete",
      false,
    )
  }
  const assetId = workspaceAssetId({
    kind: "output",
    attempt,
    manifest: existing.manifestRef,
  })
  return {
    portrait: {
      assetId,
      artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      ext: "mp4",
      ...portrait,
    },
    wide: {
      assetId,
      artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
      ext: "mp4",
      ...wide,
    },
  }
}

async function jsonResponse(response: Response): Promise<unknown> {
  return readResponseJsonCapped(response, MAX_RESPONSE_BYTES)
}

function expectedArtifacts(
  outputAssetId: string,
  refs: z.infer<typeof ArtifactRefSchema>[],
  attempt: z.infer<typeof AttemptSchema>,
): DevotionalVideoArtifacts {
  const attemptToken = createHash("sha256")
    .update(attempt.attemptId)
    .digest("hex")
    .slice(0, 24)
  const assetPattern = new RegExp(
    `^dv2o_g${attempt.workspaceGeneration}_${attemptToken}_[a-f0-9]{64}_[1-9][0-9]*$`,
  )
  const find = (artifactType: string) =>
    refs.find(
      (ref) =>
        (ref.assetId === outputAssetId || assetPattern.test(ref.assetId)) &&
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
      const parsed = parseWorkspaceRef(ref)
      const filename =
        ref.artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
          ? "portrait.mp4"
          : "wide.mp4"
      const expectedKey = parsed.success
        ? `runs/g${attempt.workspaceGeneration}/${attemptToken}/attempt-output/${parsed.data.digest}/${filename}`
        : ""
      if (
        !parsed.success ||
        !assetPattern.test(ref.assetId) ||
        ref.contentType !== "video/mp4" ||
        ref.key !== expectedKey ||
        ref.attempt?.workspaceGeneration !== attempt.workspaceGeneration ||
        ref.attempt?.attemptId !== attempt.attemptId ||
        ref.attempt?.runId !== attempt.runId
      ) {
        throw new DevotionalWorkerError(
          "invalid_response",
          "shorts-worker returned an incomplete v2 video reference",
          false,
        )
      }
    }
    return ref as DevotionalVideoArtifact
  }
  const checkedPortrait = checked(portrait)
  const checkedWide = checked(wide)
  if (checkedPortrait.assetId !== checkedWide.assetId) {
    throw new DevotionalWorkerError(
      "invalid_response",
      "shorts-worker returned video references from different output manifests",
      false,
    )
  }
  return { portrait: checkedPortrait, wide: checkedWide }
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

  const inputBodies: Array<{
    artifactType: string
    ext: "json" | "mp3"
    body: Uint8Array | string
  }> = input.audio.segments.map((segment) => ({
    artifactType: narrationArtifactType(segment.id),
    ext: "mp3",
    body: segment.audio.bytes,
  }))
  if (input.audio.music) {
    inputBodies.push({
      artifactType: DEVOTIONAL_MUSIC_ARTIFACT_TYPE,
      ext: "mp3",
      body: input.audio.music.audio.bytes,
    })
  }
  inputBodies.push({
    artifactType: DEVOTIONAL_INPUT_ARTIFACT_TYPE,
    ext: "json",
    body: specJson,
  })
  for (const artifact of inputBodies.filter(({ ext }) => ext === "mp3")) {
    hash.update(artifact.body)
  }
  const inputHash = hash.digest("hex")

  const workspaceMediaStore =
    options.workspaceMediaStore ?? configuredWorkspaceMediaStore
  const signedTransfer = workspaceMediaStore?.supportsSignedTransfers === true
  let inputAssetId: string
  let workspaceTransfer: SignedWorkspaceTransfer | undefined
  let outputGrants:
    | [DevotionalWorkspaceUploadGrant, DevotionalWorkspaceUploadGrant]
    | undefined
  if (signedTransfer && workspaceMediaStore) {
    const existing = await existingSignedOutputs(workspaceMediaStore, attempt)
    if (existing) return existing
    const inputs = await Promise.all(
      inputBodies.map((artifact) =>
        writeWorkspaceInput({
          store: workspaceMediaStore,
          attempt,
          ...artifact,
        }),
      ),
    )
    const manifestJson = JSON.stringify({
      schemaVersion: "2",
      kind: "run-input",
      attempt,
      artifacts: inputs.map(({ artifactType, ext, ref }) => ({
        artifactType,
        ext,
        ref,
      })),
      selectedSources: input.selectedSources ?? [],
    })
    const manifestRef = await workspaceMediaStore.writeImmutableArtifact({
      key: devotionalWorkspaceManifestKey({ attempt, area: "run-input" }),
      body: manifestJson,
      contentType: "application/json",
      attempt,
    })
    const manifest = await workspaceMediaStore.createReadGrant(manifestRef)
    // The Worker dedupes active jobs by outputAssetId + inputHash. Reattached
    // callers must therefore mint fresh URLs for the same temporary keys.
    const uploadId = inputHash
    const [portraitUploadGrant, wideUploadGrant] = await Promise.all([
      workspaceMediaStore.createUploadGrant({
        attempt,
        uploadId,
        fileName: "portrait.mp4",
      }),
      workspaceMediaStore.createUploadGrant({
        attempt,
        uploadId,
        fileName: "wide.mp4",
      }),
    ])
    outputGrants = [portraitUploadGrant, wideUploadGrant]
    inputAssetId = workspaceAssetId({
      kind: "input",
      attempt,
      manifest: manifestRef,
    })
    workspaceTransfer = devotionalWorkspaceTransferSchema.parse({
      schemaVersion: "1",
      attempt,
      manifest,
      inputs: inputs.map(({ artifactType, ext, grant }) => ({
        artifactType,
        ext,
        ...grant,
      })),
      outputs: [
        {
          artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
          ext: "mp4",
          ...portraitUploadGrant,
        },
        {
          artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
          ext: "mp4",
          ...wideUploadGrant,
        },
      ],
    })
  } else {
    const uploaded: Array<{
      artifactType: string
      ext: "json" | "mp3"
      ref: z.infer<typeof WorkspaceRefSchema>
    }> = []
    for (const artifact of inputBodies) {
      const ref = await uploadLegacy(
        client,
        attempt,
        stagingAssetId,
        artifact.artifactType,
        artifact.ext,
        artifact.body,
      )
      uploaded.push({
        artifactType: artifact.artifactType,
        ext: artifact.ext,
        ref,
      })
    }
    const manifestJson = JSON.stringify({
      schemaVersion: "2",
      kind: "run-input",
      attempt,
      artifacts: uploaded,
      selectedSources: input.selectedSources ?? [],
    })
    const manifestRef = await uploadLegacy(
      client,
      attempt,
      stagingAssetId,
      "devotional-input-manifest-v2",
      "json",
      manifestJson,
    )
    inputAssetId = workspaceAssetId({
      kind: "input",
      attempt,
      manifest: manifestRef,
    })
  }

  const submissionBody = JSON.stringify({
    kind: "devotional-render",
    runId: safeRunId,
    inputAssetId,
    outputAssetId,
    inputHash,
    ...(workspaceTransfer ? { workspaceTransfer } : {}),
  })
  const submitWorkerJob = async () => {
    const response = await request(client, "/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: submissionBody,
    })
    const body = await jsonResponse(response)
    const workerJobId =
      body &&
      typeof body === "object" &&
      "workerJobId" in body &&
      typeof body.workerJobId === "string"
        ? body.workerJobId
        : null
    return { response, workerJobId }
  }

  const submitted = await submitWorkerJob()
  if (!submitted.response.ok || !submitted.workerJobId) {
    if (workspaceMediaStore && outputGrants) {
      await Promise.allSettled(
        outputGrants.map((grant) => workspaceMediaStore.discardUpload(grant)),
      )
    }
    throw new DevotionalWorkerError(
      "upstream_failed",
      `shorts-worker job submission failed with HTTP ${submitted.response.status}`,
      submitted.response.status >= 500 || submitted.response.status === 409,
    )
  }
  let workerJobId = submitted.workerJobId

  const intervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const timeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs
  const discardOutputGrants = async (retry: boolean) => {
    if (!workspaceMediaStore || !outputGrants) return
    const discard = () =>
      Promise.allSettled(
        outputGrants.map((grant) => workspaceMediaStore.discardUpload(grant)),
      )
    await discard()
    if (retry) {
      await sleep(250)
      await discard()
    }
  }
  const cancelWorkerJob = async (): Promise<boolean> => {
    const response = await request(
      client,
      `/jobs/${encodeURIComponent(workerJobId)}`,
      { method: "DELETE" },
    ).catch(() => null)
    return response?.ok === true
  }
  const cancelled = async (): Promise<never> => {
    if (await cancelWorkerJob()) await discardOutputGrants(true)
    throw new DevotionalWorkerError(
      "job_failed",
      "shorts-worker devotional render was cancelled",
      false,
    )
  }
  const waitForNextPoll = async (): Promise<void> => {
    if (!options.abortSignal) {
      await sleep(intervalMs)
      return
    }
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
  }
  let lostJobResubmits = 0
  while (Date.now() <= deadline) {
    if (options.abortSignal?.aborted) {
      await cancelled()
    }
    let response: Response
    try {
      response = await request(
        client,
        `/jobs/${encodeURIComponent(workerJobId)}`,
        { method: "GET" },
        HTTP_TIMEOUT_MS,
        options.abortSignal,
      )
    } catch {
      if (options.abortSignal?.aborted) await cancelled()
      if (Date.now() > deadline) break
      await waitForNextPoll()
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => undefined)
      await waitForNextPoll()
      continue
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      if (lostJobResubmits >= MAX_LOST_JOB_RESUBMITS) {
        await discardOutputGrants(true)
        throw new DevotionalWorkerError(
          "invalid_response",
          "shorts-worker lost the devotional render after bounded resubmissions",
          false,
        )
      }
      const resubmitted = await submitWorkerJob()
      if (!resubmitted.response.ok || !resubmitted.workerJobId) {
        await discardOutputGrants(false)
        throw new DevotionalWorkerError(
          "upstream_failed",
          `shorts-worker job resubmission failed with HTTP ${resubmitted.response.status}`,
          resubmitted.response.status >= 500 ||
            resubmitted.response.status === 409,
        )
      }
      workerJobId = resubmitted.workerJobId
      lostJobResubmits += 1
      continue
    }
    const parsed = JobStatusSchema.safeParse(await jsonResponse(response))
    if (!response.ok || !parsed.success) {
      if (await cancelWorkerJob()) await discardOutputGrants(true)
      throw new DevotionalWorkerError(
        "invalid_response",
        `shorts-worker job status returned HTTP ${response.status}`,
        response.status >= 500,
      )
    }
    if (parsed.data.status === "completed" && parsed.data.result) {
      if (workspaceTransfer && workspaceMediaStore && outputGrants) {
        try {
          return await finalizeSignedOutputs({
            store: workspaceMediaStore,
            attempt,
            outputAssetId,
            refs: parsed.data.result.artifacts,
            grants: outputGrants,
          })
        } catch (error) {
          await discardOutputGrants(false)
          throw error
        }
      }
      return expectedArtifacts(
        outputAssetId,
        parsed.data.result.artifacts,
        attempt,
      )
    }
    if (parsed.data.status === "failed" || parsed.data.status === "cancelled") {
      await discardOutputGrants(false)
      throw new DevotionalWorkerError(
        "job_failed",
        parsed.data.error?.messages.join("; ") ?? "shorts-worker job failed",
        parsed.data.error?.retryable ?? false,
      )
    }
    await waitForNextPoll()
  }
  if (await cancelWorkerJob()) await discardOutputGrants(true)
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
  const workspaceMediaStore =
    options.workspaceMediaStore ?? configuredWorkspaceMediaStore
  const parsedAsset = parseWorkspaceAssetId(artifact.assetId)
  if (
    parsedAsset?.kind === "output" &&
    workspaceMediaStore?.supportsSignedTransfers
  ) {
    let payload: unknown
    try {
      payload = JSON.parse(
        (
          await workspaceMediaStore.readManifest({
            workspaceGeneration: parsedAsset.workspaceGeneration,
            attemptToken: parsedAsset.attemptToken,
            kind: "attempt-output",
            digest: parsedAsset.manifestDigest,
            size: parsedAsset.manifestSize,
          })
        ).toString("utf8"),
      )
    } catch {
      throw new DevotionalWorkerError(
        "job_failed",
        "devotional output manifest is unavailable or invalid",
        false,
      )
    }
    const manifest = WorkspacePlaybackManifestSchema.safeParse(payload)
    const expectedRoot = `runs/g${parsedAsset.workspaceGeneration}/${parsedAsset.attemptToken}/attempt-output`
    const manifestMatchesAsset =
      manifest.success &&
      manifest.data.kind === "attempt-output" &&
      manifest.data.attempt.workspaceGeneration ===
        parsedAsset.workspaceGeneration &&
      devotionalAttemptRoot(manifest.data.attempt) ===
        `runs/g${parsedAsset.workspaceGeneration}/${parsedAsset.attemptToken}`
    const ref = manifestMatchesAsset
      ? manifest.data.artifacts.find(
          (entry) =>
            entry.artifactType === artifact.artifactType &&
            entry.ext === artifact.ext,
        )?.ref
      : undefined
    const expectedFileName =
      artifact.artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
        ? "portrait.mp4"
        : artifact.artifactType === DEVOTIONAL_WIDE_ARTIFACT_TYPE
          ? "wide.mp4"
          : null
    if (
      !manifestMatchesAsset ||
      !ref ||
      !expectedFileName ||
      ref.attempt.workspaceGeneration !==
        manifest.data.attempt.workspaceGeneration ||
      ref.attempt.attemptId !== manifest.data.attempt.attemptId ||
      ref.attempt.runId !== manifest.data.attempt.runId ||
      ref.contentType !== "video/mp4" ||
      ref.key !== `${expectedRoot}/${ref.digest}/${expectedFileName}`
    ) {
      throw new DevotionalWorkerError(
        "job_failed",
        "devotional output manifest is incomplete",
        false,
      )
    }
    return workspaceMediaStore.fetchArtifact(ref, range)
  }
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
  const workspaceMediaStore =
    options.workspaceMediaStore ?? configuredWorkspaceMediaStore
  if (
    workspaceMediaStore &&
    [artifacts.portrait, artifacts.wide].every(
      (artifact) =>
        artifact.schemaVersion === "2" &&
        artifact.key &&
        artifact.digest &&
        artifact.size &&
        artifact.contentType &&
        artifact.attempt,
    )
  ) {
    const refs = [artifacts.portrait, artifacts.wide].map((artifact) => {
      const parsed = parseWorkspaceRef(artifact)
      if (!parsed.success) {
        throw new DevotionalWorkerError(
          "invalid_response",
          "devotional v2 artifact reference is incomplete",
          false,
        )
      }
      return parsed.data
    })
    await Promise.all(
      refs.map((ref) => workspaceMediaStore.verifyArtifact(ref)),
    )
    return
  }
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
