// Job state access helpers for admin and mock manager data modes.

import { AdminGraphqlClient } from "@/backend/admin-client"
import { publishJobEvent } from "@/lib/job-events"
import {
  getCmsGateway,
  readMockCmsState,
  updateMockCmsState,
} from "@/cms/gateway"
import { env } from "@/config/env"
import {
  buildShortsMetadataArtifact,
  getShortsReport,
  mergeShortsReport,
  type ShortsReportPatch,
} from "@/lib/shorts-report"
import { normalizeSubtitleValidationStepSummary } from "@/lib/subtitle-validation"
import { normalizeTranscriptScriptureCorrectionStepSummary } from "@/lib/transcript-scripture-correction"
import { buildInitialSteps } from "@/lib/workflow-steps"
import type {
  JobArtifactEntry,
  JobArtifactManifest,
  JobRecord,
  JobStatus,
  JobStepDetails,
  MastraStepCorrelation,
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

type JobUpdateFields = Partial<
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
    | "sourceLanguageId"
    | "sourceLanguageCode"
    | "sourceSelectionReason"
    | "primaryRequestedTargetLanguageCode"
    | "resolvedTargetLanguageCodes"
  >
>

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
    options: {},
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

function normalizeMastraStepCorrelation(
  raw: unknown,
): MastraStepCorrelation | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined
  }

  const candidate = raw as {
    runId?: unknown
    status?: unknown
    reason?: unknown
    retryable?: unknown
    provider?: unknown
    model?: unknown
    chunks?: unknown
    totalTokens?: unknown
    sourceContentHash?: unknown
    languages?: unknown
  }

  if (typeof candidate.runId !== "string" || candidate.runId.length === 0) {
    return undefined
  }

  const languages = Array.isArray(candidate.languages)
    ? candidate.languages.filter(
        (language): language is string =>
          typeof language === "string" && language.length > 0,
      )
    : []

  return {
    runId: candidate.runId,
    ...(typeof candidate.status === "string"
      ? { status: candidate.status }
      : {}),
    ...(typeof candidate.reason === "string"
      ? { reason: candidate.reason }
      : {}),
    ...(typeof candidate.retryable === "boolean"
      ? { retryable: candidate.retryable }
      : {}),
    ...(typeof candidate.provider === "string"
      ? { provider: candidate.provider }
      : {}),
    ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
    ...(typeof candidate.chunks === "number"
      ? { chunks: candidate.chunks }
      : {}),
    ...(typeof candidate.totalTokens === "number"
      ? { totalTokens: candidate.totalTokens }
      : {}),
    ...(typeof candidate.sourceContentHash === "string"
      ? { sourceContentHash: candidate.sourceContentHash }
      : {}),
    ...(languages.length > 0 ? { languages } : {}),
  }
}

function normalizeStepDetails(raw: unknown): JobStepDetails | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined
  }

  const candidate = raw as {
    languageResults?: unknown
    subtitleValidation?: unknown
    transcriptCorrection?: unknown
    mastra?: unknown
    progress?: unknown
    message?: unknown
  }
  const languageResults = Array.isArray(candidate.languageResults)
    ? candidate.languageResults
        .map(normalizeTranslationLanguageResult)
        .filter((result): result is TranslationLanguageResult => result != null)
    : []
  const progress =
    typeof candidate.progress === "number" ? candidate.progress : undefined
  const message =
    typeof candidate.message === "string" ? candidate.message : undefined
  const mastra = normalizeMastraStepCorrelation(candidate.mastra)
  const subtitleValidation = normalizeSubtitleValidationStepSummary(
    candidate.subtitleValidation,
  )
  const transcriptCorrection =
    normalizeTranscriptScriptureCorrectionStepSummary(
      candidate.transcriptCorrection,
    )

  if (
    languageResults.length === 0 &&
    subtitleValidation === undefined &&
    transcriptCorrection === undefined &&
    mastra === undefined &&
    progress === undefined &&
    !message
  ) {
    return undefined
  }

  return {
    ...(languageResults.length > 0 ? { languageResults } : {}),
    ...(subtitleValidation !== undefined ? { subtitleValidation } : {}),
    ...(transcriptCorrection !== undefined ? { transcriptCorrection } : {}),
    ...(mastra !== undefined ? { mastra } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(message !== undefined ? { message } : {}),
  }
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
    sourceCollectionTitle?: string
    sourceMediaTitle?: string
    initialArtifacts?: JobArtifactManifest
    // Persisted JobOptions (e.g. options.smartCrop discriminator) and a
    // custom step inventory (smart-crop jobs persist smart_crop_* steps
    // instead of the enrichment FORGE_WORKFLOW_STEPS).
    jobOptions?: JobRecord["options"]
    steps?: JobStepState[]
  },
): Promise<JobRecord> {
  const steps = options?.steps ?? buildInitialSteps()
  const jobOptions = options?.jobOptions ?? {}
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
      options: jobOptions,
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
      sourceCollectionTitle: options?.sourceCollectionTitle,
      sourceMediaTitle: options?.sourceMediaTitle,
      options: jobOptions,
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
      const updatesWithDerivedFields =
        updates.artifacts !== undefined
          ? {
              ...updates,
              ...deriveMaterializationFields(updates.artifacts),
            }
          : updates
      const adminUpdates = buildJobUpdateData(updatesWithDerivedFields)
      const job = await getAdminJobClient().updateJob(id, adminUpdates)
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

export function buildJobUpdateData(
  updates: JobUpdateFields,
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
  if (updates.sourceLanguageId !== undefined) {
    data.sourceLanguageId = updates.sourceLanguageId
  }
  if (updates.sourceLanguageCode !== undefined) {
    data.sourceLanguageCode = updates.sourceLanguageCode
  }
  if (updates.sourceSelectionReason !== undefined) {
    data.sourceSelectionReason = updates.sourceSelectionReason
  }
  if (updates.primaryRequestedTargetLanguageCode !== undefined) {
    data.primaryRequestedTargetLanguageCode =
      updates.primaryRequestedTargetLanguageCode
  }
  if (updates.resolvedTargetLanguageCodes !== undefined) {
    data.resolvedTargetLanguageCodes = updates.resolvedTargetLanguageCodes
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

// ---------------------------------------------------------------------------
// Per-job mutex for serializing step updates (read-then-write)
// ---------------------------------------------------------------------------

const jobUpdateLocks = new Map<string, Promise<unknown>>()

export async function mergeJobArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<JobRecord | null> {
  const previous = jobUpdateLocks.get(jobId) ?? Promise.resolve()
  const next = previous.then(() => doMergeJobArtifacts(jobId, artifacts))
  jobUpdateLocks.set(
    jobId,
    next.catch(() => {}),
  )
  return next
}

export async function updateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
  details?: JobStepDetails,
): Promise<JobRecord | null> {
  // Serialize per-job to avoid read-then-write race conditions.
  const previous = jobUpdateLocks.get(jobId) ?? Promise.resolve()
  const next = previous.then(() =>
    doUpdateStepStatus(jobId, stepName, status, error, details),
  )
  jobUpdateLocks.set(
    jobId,
    next.catch(() => {}),
  )
  return next
}

// Field-level merge of the shorts report entry INSIDE the per-job write
// lock: the CURRENT persisted entry is re-read at write time and the patch
// is layered onto it via mergeShortsReport, so callers holding a stale
// snapshot cannot clobber concurrent writers. Two races this closes:
// a draft save (patching ONLY draftVersion) racing a render workflow must
// never revert the workflow-owned phase, and a workflow persist landing
// after a multi-minute step must not erase an interim draftVersion mirror.
export async function mergeShortsReportEntry(
  jobId: string,
  patch: ShortsReportPatch,
): Promise<JobRecord | null> {
  const previous = jobUpdateLocks.get(jobId) ?? Promise.resolve()
  const next = previous.then(() => doMergeShortsReportEntry(jobId, patch))
  jobUpdateLocks.set(
    jobId,
    next.catch(() => {}),
  )
  return next
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

async function doMergeShortsReportEntry(
  jobId: string,
  patch: ShortsReportPatch,
): Promise<JobRecord | null> {
  const job = await getJob(jobId)
  if (!job) return null

  const merged = mergeShortsReport(getShortsReport(job.artifacts), patch)
  return updateJob(jobId, {
    artifacts: mergeArtifactEntries(
      job.artifacts,
      buildShortsMetadataArtifact(merged),
    ),
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
