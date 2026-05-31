// Job state access helpers for admin and mock manager data modes.

import { AdminGraphqlClient } from "@/backend/admin-client"
import { publishJobEvent } from "@/lib/job-events"
import {
  getCmsGateway,
  readMockCmsState,
  updateMockCmsState,
} from "@/cms/gateway"
import { env } from "@/config/env"
import { readEngineStamp } from "@/lib/engine-stamp"
import {
  buildDownloadableArtifactManifest,
  resolveJobArtifactDescriptor,
} from "@/lib/job-artifacts"
import { buildInitialSteps, FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"
import type {
  EnrichmentEngine,
  JobArtifactEntry,
  JobArtifactManifest,
  JobOptions,
  JobRecord,
  JobStatus,
  JobStepDetails,
  JobStepState,
  WorkflowStepName,
  StepStatus,
  TranslationLanguageResult,
} from "@/types/job"

export type { JobRecord, JobStatus, WorkflowStepName, StepStatus }
type JobListOptions = {
  limit?: number
  offset?: number
}

export type JobLookupResult =
  | {
      status: "found"
      job: JobRecord
    }
  | {
      status: "not-found"
    }
  | {
      status: "error"
      error: unknown
    }

export type ApplyJobCallbackUpdateInput = {
  jobId: string
  runId: string
  sequence: number
  step: WorkflowStepName
  status: StepStatus
  jobStatus?: Extract<JobStatus, "completed" | "failed">
  error?: string
  details?: JobStepDetails
  artifactsDelta?: readonly string[]
}

export type ApplyJobCallbackUpdateResult =
  | { status: "applied"; job: JobRecord }
  | { status: "dropped"; reason: string }
  | { status: "invalid"; error: string }
  | { status: "not-found" }
  | { status: "error"; error: unknown }

let adminJobClient: AdminGraphqlClient | undefined

function getAdminJobClient(): AdminGraphqlClient {
  if (!env.ADMIN_GRAPHQL_URL) {
    throw new Error("ADMIN_GRAPHQL_URL is required for Manager job state")
  }
  adminJobClient ??= new AdminGraphqlClient({
    graphqlUrl: env.ADMIN_GRAPHQL_URL,
    apiKey: env.ADMIN_MANAGER_API_KEY,
  })
  return adminJobClient
}

type EnrichmentJobNode = {
  documentId: string
  muxAssetId?: string | null
  muxPlaybackId?: string | null
  video?: {
    documentId?: string | null
    title?: string | null
    parents?: Array<{ title?: string | null } | null> | null
  } | null
  languages?: string[] | null
  status?: string | null
  currentStep?: string | null
  retries?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  options?: unknown
  artifacts?: unknown
  steps?: EnrichmentJobStepNode[] | null
  errors?: JobRecord["errors"] | null
}

type EnrichmentJobStepNode = {
  name?: string | null
  status?: string | null
  retries?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  error?: string | null
  details?: unknown
} | null

function isDownloadableArtifactEntry(
  value: unknown,
): value is Extract<JobArtifactEntry, { kind: "downloadable" }> {
  return (
    typeof value === "object" &&
    value != null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "downloadable"
  )
}

function isMetadataArtifactEntry(
  value: unknown,
): value is Extract<JobArtifactEntry, { kind: "metadata" }> {
  return (
    typeof value === "object" &&
    value != null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "metadata" &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data != null &&
    !Array.isArray((value as { data?: unknown }).data)
  )
}

function normalizeMaterializationEntry(
  value: unknown,
): JobArtifactEntry | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (
        typeof parsed === "object" &&
        parsed != null &&
        !Array.isArray(parsed)
      ) {
        return {
          kind: "metadata",
          data: parsed as Record<string, unknown>,
        }
      }
    } catch {
      return null
    }
  }

  if (typeof value === "object" && value != null && !Array.isArray(value)) {
    return {
      kind: "metadata",
      data: value as Record<string, unknown>,
    }
  }

  return null
}

function readNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readNonBlankStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value
    .map((entry) => readNonBlankString(entry))
    .filter((entry): entry is string => entry != null)

  return strings.length > 0 ? strings : undefined
}

/** Parse a raw `options` JSON blob into a typed JobOptions, dropping unknowns. */
function normalizeJobOptions(raw: unknown): JobOptions {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return {}
  }
  const candidate = raw as Record<string, unknown>
  const options: JobOptions = {}
  if (typeof candidate.generateVoiceover === "boolean") {
    options.generateVoiceover = candidate.generateVoiceover
  }
  if (typeof candidate.uploadMux === "boolean") {
    options.uploadMux = candidate.uploadMux
  }
  if (typeof candidate.notifyCms === "boolean") {
    options.notifyCms = candidate.notifyCms
  }
  if (candidate.engine === "workflow" || candidate.engine === "mastra") {
    options.engine = candidate.engine
  }
  if (typeof candidate.currentRunId === "string") {
    options.currentRunId = candidate.currentRunId
  }
  if (typeof candidate.dispatchedAt === "string") {
    options.dispatchedAt = candidate.dispatchedAt
  }
  if (
    typeof candidate.callbackSequences === "object" &&
    candidate.callbackSequences != null &&
    !Array.isArray(candidate.callbackSequences)
  ) {
    const allowedSteps = new Set<WorkflowStepName>(FORGE_WORKFLOW_STEPS)
    const callbackSequences: Partial<Record<WorkflowStepName, number>> = {}
    for (const [key, value] of Object.entries(
      candidate.callbackSequences as Record<string, unknown>,
    )) {
      const step = key as WorkflowStepName
      if (
        allowedSteps.has(step) &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0
      ) {
        callbackSequences[step] = value
      }
    }
    if (Object.keys(callbackSequences).length > 0) {
      options.callbackSequences = callbackSequences
    }
  }
  return options
}

function buildDispatchedOptions(
  options: JobOptions,
  runId: string,
  dispatchedAt: string,
): JobOptions {
  const rest = { ...options }
  delete rest.callbackSequences

  return {
    ...rest,
    currentRunId: runId,
    dispatchedAt,
  }
}

function deriveMaterializationFields(
  artifacts: JobArtifactManifest,
): Pick<
  JobRecord,
  | "sourceLanguageId"
  | "sourceLanguageCode"
  | "sourceSelectionReason"
  | "primaryRequestedTargetLanguageCode"
  | "resolvedTargetLanguageCodes"
> {
  const materialization = artifacts.materialization
  if (materialization?.kind !== "metadata") {
    return {}
  }

  const data = materialization.data

  return {
    sourceLanguageId: readNonBlankString(data.sourceLanguageId),
    sourceLanguageCode: readNonBlankString(data.sourceLanguageCode),
    sourceSelectionReason: readNonBlankString(data.sourceSelectionReason),
    primaryRequestedTargetLanguageCode: readNonBlankString(
      data.primaryRequestedTargetLanguageCode,
    ),
    resolvedTargetLanguageCodes: readNonBlankStringArray(
      data.resolvedTargetLanguageCodes,
    ),
  }
}

export function normalizeJobArtifacts(raw: unknown): JobArtifactManifest {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return {}
  }

  const entries = Object.entries(raw as Record<string, unknown>)
  const normalized: JobArtifactManifest = {}

  for (const [key, value] of entries) {
    if (isDownloadableArtifactEntry(value) || isMetadataArtifactEntry(value)) {
      normalized[key] = value
      continue
    }

    if (key === "materialization") {
      const metadata = normalizeMaterializationEntry(value)
      if (metadata) {
        normalized[key] = metadata
      }
      continue
    }

    if (typeof value === "string" || value === true) {
      normalized[key] = { kind: "downloadable" }
    }
  }

  return normalized
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map a Strapi GraphQL response node to a local JobRecord. */
export function toJobRecord(node: EnrichmentJobNode): JobRecord {
  const rawVideo = "video" in node ? node.video : undefined
  const artifacts = normalizeJobArtifacts(
    "artifacts" in node ? node.artifacts : undefined,
  )
  const errors = "errors" in node ? node.errors : undefined
  const materializationFields = deriveMaterializationFields(artifacts)
  const videoDocumentId =
    rawVideo && "documentId" in rawVideo
      ? readNonBlankString(rawVideo.documentId)
      : undefined
  const videoTitle =
    rawVideo && "title" in rawVideo ? rawVideo.title : undefined
  const videoParents =
    rawVideo && "parents" in rawVideo ? rawVideo.parents : undefined
  const parentTitles = Array.from(
    new Set(
      (videoParents ?? [])
        .map((parent) => parent?.title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  )

  return {
    id: node.documentId ?? "",
    muxAssetId: node.muxAssetId ?? "",
    muxPlaybackId: node.muxPlaybackId ?? "",
    videoDocumentId: videoDocumentId ?? undefined,
    languages: (node.languages ?? []) as string[],
    ...materializationFields,
    sourceCollectionTitle:
      parentTitles.length > 0 ? parentTitles.join(", ") : undefined,
    sourceMediaTitle: videoTitle?.trim() || undefined,
    options: normalizeJobOptions(node.options),
    status: node.status as JobStatus,
    currentStep: node.currentStep as WorkflowStepName | undefined,
    retries: node.retries ?? 0,
    createdAt: String(node.createdAt ?? ""),
    updatedAt: String(node.updatedAt ?? ""),
    startedAt: node.startedAt ? String(node.startedAt) : undefined,
    completedAt: node.completedAt ? String(node.completedAt) : undefined,
    artifacts,
    steps: (node.steps ?? []).map(toStepState),
    errors: (errors ?? []) as JobRecord["errors"],
  }
}

function toStepState(s: EnrichmentJobStepNode): JobStepState {
  if (!s) {
    return {
      name: "ingest" as WorkflowStepName,
      status: "pending" as StepStatus,
      retries: 0,
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
      details: undefined,
    }
  }
  return {
    name: s.name as WorkflowStepName,
    status: s.status as StepStatus,
    retries: s.retries ?? 0,
    startedAt: s.startedAt ? String(s.startedAt) : undefined,
    finishedAt: s.finishedAt ? String(s.finishedAt) : undefined,
    error: s.error ?? undefined,
    details: normalizeStepDetails(s.details),
  }
}

type JobStepInput = {
  name: WorkflowStepName
  status: StepStatus
  retries: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  details: JobStepDetails | null
}

function toStepInput(steps: JobStepState[]): JobStepInput[] {
  return steps.map((s) => ({
    name: s.name,
    status: s.status,
    retries: s.retries,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    error: s.error ?? null,
    details: s.details ?? null,
  }))
}

function normalizeTranslationLanguageResult(
  raw: unknown,
): TranslationLanguageResult | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as {
    lang?: unknown
    status?: unknown
    error?: unknown
  }

  if (typeof candidate.lang !== "string") {
    return null
  }

  if (candidate.status !== "completed" && candidate.status !== "failed") {
    return null
  }

  return {
    lang: candidate.lang,
    status: candidate.status,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
  }
}

function normalizeStepDetails(raw: unknown): JobStepDetails | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined
  }

  const candidate = raw as { languageResults?: unknown }
  const languageResults = Array.isArray(candidate.languageResults)
    ? candidate.languageResults
        .map(normalizeTranslationLanguageResult)
        .filter((result): result is TranslationLanguageResult => result != null)
    : []

  if (languageResults.length === 0) {
    return undefined
  }

  return { languageResults }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createJob(
  muxAssetId: string,
  muxPlaybackId: string,
  languages: string[] = [],
  options?: {
    videoDocumentId?: string
    initialArtifacts?: JobArtifactManifest
    engine?: EnrichmentEngine
  },
): Promise<JobRecord> {
  const steps = buildInitialSteps()
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)

  if (mockState) {
    const now = new Date().toISOString()
    const nextJobNumber =
      mockState.readModels.jobs.reduce((max, job) => {
        const match = job.id.match(/^mock-job-(\d+)$/)
        return match ? Math.max(max, Number(match[1])) : max
      }, 0) + 1

    const sourceVideo = options?.videoDocumentId
      ? mockState.readModels.videoCoverage.find(
          (video) => video.documentId === options.videoDocumentId,
        )
      : null
    const sourceCollection = sourceVideo?.parentDocumentIds[0]
      ? mockState.readModels.videoCoverage.find(
          (video) => video.documentId === sourceVideo.parentDocumentIds[0],
        )
      : null

    const job: JobRecord = {
      id: `mock-job-${nextJobNumber}`,
      muxAssetId,
      muxPlaybackId,
      videoDocumentId: options?.videoDocumentId,
      languages,
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      resolvedTargetLanguageCodes: languages,
      sourceCollectionTitle: sourceCollection?.title ?? undefined,
      sourceMediaTitle: sourceVideo?.title ?? undefined,
      options: options?.engine ? { engine: options.engine } : {},
      status: "pending",
      retries: 0,
      createdAt: now,
      updatedAt: now,
      artifacts: options?.initialArtifacts ?? {},
      steps,
      errors: [],
    }

    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        jobs: [job, ...current.readModels.jobs],
      },
    }))

    publishJobEvent(job)
    return job
  }

  if (gateway.mode === "admin") {
    const initialArtifacts = options?.initialArtifacts ?? {}
    const job = await getAdminJobClient().createJob({
      muxAssetId,
      muxPlaybackId,
      languages,
      videoDocumentId: options?.videoDocumentId,
      options: options?.engine ? { engine: options.engine } : {},
      artifacts: initialArtifacts,
      errors: [],
      steps,
      ...deriveMaterializationFields(initialArtifacts),
    })
    publishJobEvent(job)
    return job
  }

  throw new Error("Manager job creation requires admin or mock backend mode")
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const result = await getJobLookup(id)
  return result.status === "found" ? result.job : null
}

export async function getJobLookup(id: string): Promise<JobLookupResult> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const job = mockState.readModels.jobs.find(
      (candidate) => candidate.id === id,
    )
    if (!job) {
      return { status: "not-found" }
    }

    return {
      status: "found",
      job,
    }
  }

  if (gateway.mode === "admin") {
    try {
      const job = await getAdminJobClient().getJob(id)
      return job ? { status: "found", job } : { status: "not-found" }
    } catch (err) {
      console.warn(`[state] getJob(${id}) failed:`, err)
      return {
        status: "error",
        error: err,
      }
    }
  }

  return { status: "error", error: new Error("Unsupported Manager backend") }
}

export async function listJobs(
  options: JobListOptions = {},
): Promise<JobRecord[]> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const { limit = mockState.readModels.jobs.length, offset = 0 } = options
    return mockState.readModels.jobs.slice(offset, offset + limit)
  }

  if (gateway.mode === "admin") {
    return getAdminJobClient().listJobs(options)
  }

  return []
}

export async function listJobSummaries(
  options: JobListOptions = {},
): Promise<JobRecord[]> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const { limit = mockState.readModels.jobs.length, offset = 0 } = options
    return mockState.readModels.jobs.slice(offset, offset + limit)
  }

  if (gateway.mode === "admin") {
    return getAdminJobClient().listJobs(options)
  }

  return []
}

export async function countJobs(): Promise<number> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    return mockState.readModels.jobs.length
  }

  if (gateway.mode === "admin") {
    return getAdminJobClient().countJobs()
  }

  return 0
}

export async function updateJob(
  id: string,
  updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "errors"
      | "startedAt"
      | "completedAt"
      | "retries"
      | "steps"
      | "options"
    >
  >,
): Promise<JobRecord | null> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        jobs: current.readModels.jobs.map((job) =>
          job.id === id
            ? {
                ...job,
                ...updates,
                updatedAt: new Date().toISOString(),
              }
            : job,
        ),
      },
    }))

    const job = nextState?.readModels.jobs.find(
      (candidate) => candidate.id === id,
    )
    if (job) {
      publishJobEvent(job)
    }

    return job ?? null
  }

  if (gateway.mode === "admin") {
    try {
      const adminUpdates =
        updates.artifacts !== undefined
          ? {
              ...updates,
              ...deriveMaterializationFields(updates.artifacts),
            }
          : updates
      const job = await getAdminJobClient().updateJob(
        id,
        buildJobUpdateData(adminUpdates) as Parameters<
          AdminGraphqlClient["updateJob"]
        >[1],
      )
      if (job) {
        publishJobEvent(job)
      }
      return job
    } catch (err) {
      console.warn(`[state] updateJob(${id}) failed:`, err)
      return null
    }
  }

  return null
}

/**
 * Merge-aware engine re-stamp for the transcription-rerun path. A rerun
 * re-stamps the job to the engine selected at rerun time WITHOUT clobbering
 * sibling JobOptions (generateVoiceover / uploadMux / notifyCms). Always merges
 * onto the existing options object — never writes a bare `{ engine }`, because
 * the Admin `updateManagerJob` mutation replaces the whole `options` column.
 */
export async function restampEngine(
  id: string,
  engine: EnrichmentEngine,
): Promise<JobRecord | null> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        jobs: current.readModels.jobs.map((job) =>
          job.id === id
            ? {
                ...job,
                options: { ...job.options, engine },
                updatedAt: new Date().toISOString(),
              }
            : job,
        ),
      },
    }))
    const job = nextState?.readModels.jobs.find(
      (candidate) => candidate.id === id,
    )
    if (job) {
      publishJobEvent(job)
    }
    return job ?? null
  }

  if (gateway.mode === "admin") {
    try {
      const current = await getAdminJobClient().getJob(id)
      if (!current) {
        return null
      }
      const job = await getAdminJobClient().updateJob(id, {
        options: { ...current.options, engine },
      })
      if (job) {
        publishJobEvent(job)
      }
      return job
    } catch (err) {
      console.warn(`[state] restampEngine(${id}) failed:`, err)
      return null
    }
  }

  return null
}

export async function markEnrichmentDispatched(
  id: string,
  runId: string,
  dispatchedAt = new Date().toISOString(),
): Promise<JobRecord | null> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        jobs: current.readModels.jobs.map((job) =>
          job.id === id
            ? {
                ...job,
                options: buildDispatchedOptions(
                  job.options,
                  runId,
                  dispatchedAt,
                ),
                status: "running",
                currentStep: undefined,
                completedAt: undefined,
                updatedAt: dispatchedAt,
              }
            : job,
        ),
      },
    }))
    const job = nextState?.readModels.jobs.find(
      (candidate) => candidate.id === id,
    )
    if (job) {
      publishJobEvent(job)
    }
    return job ?? null
  }

  if (gateway.mode === "admin") {
    try {
      const current = await getAdminJobClient().getJob(id)
      if (!current) {
        return null
      }
      const job = await getAdminJobClient().updateJob(
        id,
        buildJobUpdateData({
          options: buildDispatchedOptions(current.options, runId, dispatchedAt),
          status: "running",
          currentStep: undefined,
          completedAt: undefined,
        }) as Parameters<AdminGraphqlClient["updateJob"]>[1],
      )
      if (job) {
        publishJobEvent(job)
      }
      return job
    } catch (err) {
      console.warn(`[state] markEnrichmentDispatched(${id}) failed:`, err)
      return null
    }
  }

  return null
}

export function buildJobUpdateData(
  updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "errors"
      | "startedAt"
      | "completedAt"
      | "retries"
      | "steps"
      | "options"
      | "sourceLanguageId"
      | "sourceLanguageCode"
      | "sourceSelectionReason"
      | "primaryRequestedTargetLanguageCode"
      | "resolvedTargetLanguageCodes"
      | "sourceCollectionTitle"
      | "sourceMediaTitle"
      | "requestedLanguageAbbreviations"
    >
  >,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (updates.status !== undefined) data.status = updates.status
  if ("currentStep" in updates) data.currentStep = updates.currentStep ?? null
  if (updates.artifacts !== undefined) data.artifacts = updates.artifacts
  if (updates.errors !== undefined) data.errors = updates.errors
  if ("startedAt" in updates) data.startedAt = updates.startedAt ?? null
  if ("completedAt" in updates) data.completedAt = updates.completedAt ?? null
  if (updates.retries !== undefined) data.retries = updates.retries
  if (updates.steps !== undefined) data.steps = toStepInput(updates.steps)
  if (updates.options !== undefined) data.options = updates.options
  if ("sourceLanguageId" in updates) {
    data.sourceLanguageId = updates.sourceLanguageId ?? null
  }
  if ("sourceLanguageCode" in updates) {
    data.sourceLanguageCode = updates.sourceLanguageCode ?? null
  }
  if ("sourceSelectionReason" in updates) {
    data.sourceSelectionReason = updates.sourceSelectionReason ?? null
  }
  if ("primaryRequestedTargetLanguageCode" in updates) {
    data.primaryRequestedTargetLanguageCode =
      updates.primaryRequestedTargetLanguageCode ?? null
  }
  if (updates.resolvedTargetLanguageCodes !== undefined) {
    data.resolvedTargetLanguageCodes = updates.resolvedTargetLanguageCodes
  }
  if ("sourceCollectionTitle" in updates) {
    data.sourceCollectionTitle = updates.sourceCollectionTitle ?? null
  }
  if ("sourceMediaTitle" in updates) {
    data.sourceMediaTitle = updates.sourceMediaTitle ?? null
  }
  if (updates.requestedLanguageAbbreviations !== undefined) {
    data.requestedLanguageAbbreviations = updates.requestedLanguageAbbreviations
  }

  return data
}

export function mergeArtifactEntries(
  existing: JobArtifactManifest,
  incoming: JobArtifactManifest,
): JobArtifactManifest {
  return {
    ...existing,
    ...incoming,
  }
}

const STATUS_RANK: Record<StepStatus, number> = {
  pending: 0,
  running: 1,
  skipped: 2,
  failed: 3,
  completed: 4,
}

const CALLBACK_ARTIFACT_KEYS_BY_STEP: Partial<
  Record<WorkflowStepName, readonly string[]>
> = {
  transcription: ["transcript", "subtitles", "subtitlesVtt"],
  translation: ["translations"],
  chapters: ["chapters", "chapters-vtt"],
  metadata: ["metadata"],
  embeddings: ["embeddings"],
  audio_cleanup: ["original-audio", "cleaned-audio"],
}

const ARTIFACT_LANGUAGE_SUFFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i

function serializeJobUpdate<T>(
  jobId: string,
  update: () => Promise<T>,
): Promise<T> {
  const previous = jobUpdateLocks.get(jobId) ?? Promise.resolve()
  const next = previous.then(update)
  jobUpdateLocks.set(
    jobId,
    next.catch(() => {}),
  )
  return next
}

function isStaleStatus(current: StepStatus | undefined, next: StepStatus) {
  if (!current) return false
  return STATUS_RANK[next] < STATUS_RANK[current]
}

function isStaleSequence(current: number | undefined, next: number): boolean {
  return current != null && next <= current
}

function collectArtifactLanguageCodes(job: JobRecord): Set<string> {
  const values = [
    ...job.languages,
    ...(job.resolvedTargetLanguageCodes ?? []),
    ...(job.requestedLanguageAbbreviations ?? []),
    job.primaryRequestedTargetLanguageCode,
    job.sourceLanguageCode,
  ]

  return new Set(
    values
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => LANGUAGE_CODE_RE.test(value)),
  )
}

function readTranslationArtifactLanguage(key: string): string | null {
  const language = key.startsWith("subtitles-")
    ? key.slice("subtitles-".length)
    : key.startsWith("translation-")
      ? key.slice("translation-".length)
      : null

  if (!language || !ARTIFACT_LANGUAGE_SUFFIX_RE.test(language)) {
    return null
  }

  return language.toLowerCase()
}

function validateCallbackArtifactKeys(
  job: JobRecord,
  step: WorkflowStepName,
  keys: readonly string[] | undefined,
) {
  if (!keys?.length) return { ok: true as const, keys: [] as string[] }

  const allowedExactKeys = new Set(CALLBACK_ARTIFACT_KEYS_BY_STEP[step] ?? [])
  const jobLanguageCodes = collectArtifactLanguageCodes(job)
  const invalid: string[] = []

  for (const key of keys) {
    if (!resolveJobArtifactDescriptor(key)) {
      invalid.push(key)
      continue
    }

    if (allowedExactKeys.has(key)) {
      continue
    }

    const artifactLanguage = readTranslationArtifactLanguage(key)
    const languageMatchesJob =
      jobLanguageCodes.size === 0 ||
      jobLanguageCodes.has(artifactLanguage ?? "")
    if (step === "translation" && artifactLanguage && languageMatchesJob) {
      continue
    }

    invalid.push(key)
  }

  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: `Unsupported artifact keys for ${step}: ${invalid.join(", ")}`,
    }
  }

  return { ok: true as const, keys: [...new Set(keys)] }
}

function buildCallbackUpdatedJob(
  job: JobRecord,
  input: ApplyJobCallbackUpdateInput,
  now: string,
): ApplyJobCallbackUpdateResult {
  if (readEngineStamp(job.options) !== "mastra") {
    return { status: "dropped", reason: "engine_mismatch" }
  }
  if (job.options.currentRunId !== input.runId) {
    return { status: "dropped", reason: "stale_run" }
  }

  const currentStep = job.steps.find((step) => step.name === input.step)
  if (isStaleStatus(currentStep?.status, input.status)) {
    return { status: "dropped", reason: "stale_status" }
  }
  if (
    isStaleSequence(job.options.callbackSequences?.[input.step], input.sequence)
  ) {
    return { status: "dropped", reason: "stale_sequence" }
  }

  const artifacts = validateCallbackArtifactKeys(
    job,
    input.step,
    input.artifactsDelta,
  )
  if (!artifacts.ok) {
    return { status: "invalid", error: artifacts.error }
  }

  const steps = job.steps.map((step) => {
    if (step.name !== input.step) return step

    const updated = { ...step, status: input.status }
    if (input.status === "running" && !step.startedAt) {
      updated.startedAt = now
    }
    if (input.status === "completed" || input.status === "failed") {
      updated.finishedAt = now
    }
    if (input.error) {
      updated.error = input.error
    }
    if (input.details !== undefined) {
      updated.details = input.details
    }
    return updated
  })

  const errors = input.error
    ? [...job.errors, { step: input.step, message: input.error, at: now }]
    : job.errors
  const callbackSequences = {
    ...(job.options.callbackSequences ?? {}),
    [input.step]: input.sequence,
  }
  let updatedJob: JobRecord = {
    ...job,
    artifacts:
      artifacts.keys.length > 0
        ? mergeArtifactEntries(
            job.artifacts,
            buildDownloadableArtifactManifest(artifacts.keys),
          )
        : job.artifacts,
    errors,
    options: {
      ...job.options,
      callbackSequences,
    },
    steps,
    updatedAt: now,
  }

  if (input.status === "running") {
    updatedJob = {
      ...updatedJob,
      status: "running",
      currentStep: input.step,
    }
  } else if (input.jobStatus) {
    updatedJob = {
      ...updatedJob,
      status: input.jobStatus,
      currentStep: undefined,
      completedAt: input.jobStatus === "completed" ? now : undefined,
    }
  }

  return { status: "applied", job: updatedJob }
}

function buildCallbackJobUpdates(
  current: JobRecord,
  updated: JobRecord,
  input: ApplyJobCallbackUpdateInput,
): Partial<
  Pick<
    JobRecord,
    | "status"
    | "currentStep"
    | "artifacts"
    | "errors"
    | "completedAt"
    | "steps"
    | "options"
  >
> {
  const updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "errors"
      | "completedAt"
      | "steps"
      | "options"
    >
  > = {
    artifacts: updated.artifacts,
    errors: updated.errors,
    options: updated.options,
    steps: updated.steps,
  }

  if (input.status === "running" || updated.status !== current.status) {
    updates.status = updated.status
  }
  if (input.status === "running" || input.jobStatus) {
    updates.currentStep = updated.currentStep
  }
  if (input.jobStatus) {
    updates.completedAt = updated.completedAt
  }

  return updates
}

// ---------------------------------------------------------------------------
// Per-job mutex for serializing step updates (read-then-write)
// ---------------------------------------------------------------------------

const jobUpdateLocks = new Map<string, Promise<unknown>>()

export async function mergeJobArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<JobRecord | null> {
  return serializeJobUpdate(jobId, () => doMergeJobArtifacts(jobId, artifacts))
}

export async function updateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
  details?: JobStepDetails,
): Promise<JobRecord | null> {
  // Serialize per-job to avoid read-then-write race conditions.
  return serializeJobUpdate(jobId, () =>
    doUpdateStepStatus(jobId, stepName, status, error, details),
  )
}

export async function applyJobCallbackUpdate(
  input: ApplyJobCallbackUpdateInput,
): Promise<ApplyJobCallbackUpdateResult> {
  return serializeJobUpdate(input.jobId, () => doApplyJobCallbackUpdate(input))
}

async function doApplyJobCallbackUpdate(
  input: ApplyJobCallbackUpdateInput,
): Promise<ApplyJobCallbackUpdateResult> {
  const now = new Date().toISOString()
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)

  if (mockState) {
    let result: ApplyJobCallbackUpdateResult = { status: "not-found" }
    let appliedJob: JobRecord | null = null
    const nextState = await updateMockCmsState(gateway, (current) => {
      const currentJob = current.readModels.jobs.find(
        (candidate) => candidate.id === input.jobId,
      )
      if (!currentJob) {
        result = { status: "not-found" }
        return current
      }

      const updateResult = buildCallbackUpdatedJob(currentJob, input, now)
      result = updateResult
      if (updateResult.status !== "applied") {
        return current
      }

      appliedJob = updateResult.job
      return {
        ...current,
        readModels: {
          ...current.readModels,
          jobs: current.readModels.jobs.map((candidate) =>
            candidate.id === input.jobId ? updateResult.job : candidate,
          ),
        },
      }
    })

    if (appliedJob) {
      const job =
        nextState?.readModels.jobs.find(
          (candidate) => candidate.id === input.jobId,
        ) ?? appliedJob
      publishJobEvent(job)
      return { status: "applied", job }
    }

    return result
  }

  if (gateway.mode === "admin") {
    try {
      const current = await getAdminJobClient().getJob(input.jobId)
      if (!current) {
        return { status: "not-found" }
      }

      const result = buildCallbackUpdatedJob(current, input, now)
      if (result.status !== "applied") {
        return result
      }

      const updates = buildCallbackJobUpdates(current, result.job, input)
      const job = await getAdminJobClient().updateJob(
        input.jobId,
        buildJobUpdateData(updates) as Parameters<
          AdminGraphqlClient["updateJob"]
        >[1],
      )
      if (!job) {
        return { status: "not-found" }
      }

      publishJobEvent(job)
      return { status: "applied", job }
    } catch (err) {
      console.warn(
        `[state] applyJobCallbackUpdate(${input.jobId}) failed:`,
        err,
      )
      return { status: "error", error: err }
    }
  }

  return {
    status: "error",
    error: new Error("Unsupported Manager backend"),
  }
}

async function doMergeJobArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<JobRecord | null> {
  const job = await getJob(jobId)
  if (!job) return null

  return updateJob(jobId, {
    artifacts: mergeArtifactEntries(job.artifacts, artifacts),
  })
}

async function doUpdateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
  details?: JobStepDetails,
): Promise<JobRecord | null> {
  // Step updates are read-then-write so the full workflow state stays coherent.
  const job = await getJob(jobId)
  if (!job) return null

  const now = new Date().toISOString()
  const steps = job.steps.map((s) => {
    if (s.name !== stepName) return s
    const updated = { ...s, status }
    if (status === "running" && !s.startedAt) {
      updated.startedAt = now
    }
    if (status === "completed" || status === "failed") {
      updated.finishedAt = now
    }
    if (error) {
      updated.error = error
    }
    if (details !== undefined) {
      updated.details = details
    }
    return updated
  })

  const errors = [...job.errors]
  if (error) {
    errors.push({ step: stepName, message: error, at: now })
  }

  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        jobs: current.readModels.jobs.map((candidate) =>
          candidate.id === jobId
            ? {
                ...candidate,
                steps,
                errors,
                updatedAt: now,
              }
            : candidate,
        ),
      },
    }))

    const jobRecord =
      nextState?.readModels.jobs.find((candidate) => candidate.id === jobId) ??
      null
    if (jobRecord) {
      publishJobEvent(jobRecord)
    }

    return jobRecord
  }

  if (gateway.mode === "admin") {
    return updateJob(jobId, { steps, errors })
  }

  return null
}
