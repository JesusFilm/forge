// Job state manager backed by Strapi CMS via GraphQL.
// Uses typed operations from @forge/graphql with gql.tada.

import { graphql, type ResultOf, type VariablesOf } from "@forge/graphql"
import getClient from "@/cms/client"
import { publishJobEvent } from "@/lib/job-events"
import { cmsPost } from "@/services/cmsClient"
import { buildInitialSteps } from "@/lib/workflow-steps"
import type {
  JobArtifactEntry,
  JobArtifactManifest,
  JobRecord,
  JobStatus,
  JobStepDetails,
  JobStepState,
  WorkflowStepName,
  StepStatus,
  TranslationLanguageResult,
} from "@/types/job"

export type { JobRecord, JobStatus, WorkflowStepName, StepStatus }
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

// ---------------------------------------------------------------------------
// GraphQL fragments & operations (typed via gql.tada)
// ---------------------------------------------------------------------------

const JOB_CORE_FIELDS = graphql(`
  fragment JobCoreFields on EnrichmentJob @_unmask {
    documentId
    muxAssetId
    muxPlaybackId
    languages
    status
    currentStep
    retries
    createdAt
    updatedAt
    startedAt
    completedAt
    artifacts
    errors
    video {
      documentId
      title
      parents(pagination: { limit: -1 }) {
        title
      }
    }
    steps {
      name
      status
      retries
      startedAt
      finishedAt
      error
      details
    }
  }
`)

const JOB_SOURCE_FIELDS = graphql(`
  fragment JobSourceFields on EnrichmentJob @_unmask {
    video {
      title
      parents(pagination: { limit: -1 }) {
        title
      }
    }
  }
`)

const JOB_SUMMARY_FIELDS = graphql(`
  fragment JobSummaryFields on EnrichmentJob @_unmask {
    documentId
    muxAssetId
    muxPlaybackId
    languages
    status
    currentStep
    retries
    createdAt
    updatedAt
    startedAt
    completedAt
    artifacts
    errors
    steps {
      name
      status
      retries
      startedAt
      finishedAt
      error
      details
    }
  }
`)

const CREATE_JOB = graphql(
  `
    mutation CreateEnrichmentJob($data: EnrichmentJobInput!) {
      createEnrichmentJob(data: $data) {
        ...JobCoreFields
      }
    }
  `,
  [JOB_CORE_FIELDS],
)

const UPDATE_JOB = graphql(
  `
    mutation UpdateEnrichmentJob($documentId: ID!, $data: EnrichmentJobInput!) {
      updateEnrichmentJob(documentId: $documentId, data: $data) {
        ...JobCoreFields
      }
    }
  `,
  [JOB_CORE_FIELDS],
)

const GET_JOB = graphql(
  `
    query GetEnrichmentJob($documentId: ID!) {
      enrichmentJob(documentId: $documentId) {
        ...JobCoreFields
        ...JobSourceFields
      }
    }
  `,
  [JOB_CORE_FIELDS, JOB_SOURCE_FIELDS],
)

const LIST_JOBS = graphql(
  `
    query ListEnrichmentJobs {
      enrichmentJobs(sort: "createdAt:desc", pagination: { pageSize: 50 }) {
        ...JobCoreFields
      }
    }
  `,
  [JOB_CORE_FIELDS],
)

const LIST_JOB_SUMMARIES = graphql(
  `
    query ListEnrichmentJobSummaries {
      enrichmentJobs(sort: "createdAt:desc", pagination: { pageSize: 50 }) {
        ...JobSummaryFields
        ...JobSourceFields
      }
    }
  `,
  [JOB_SUMMARY_FIELDS, JOB_SOURCE_FIELDS],
)

const COUNT_JOBS = graphql(`
  query CountEnrichmentJobs {
    enrichmentJobs_connection(pagination: { pageSize: 1 }) {
      pageInfo {
        total
      }
    }
  }
`)

// ---------------------------------------------------------------------------
// Types inferred from the fragment
// ---------------------------------------------------------------------------

type OptionalVideoField<T> = Omit<T, "video"> & {
  video?: T extends { video?: infer V } ? V : never
}

type EnrichmentJobNode =
  | OptionalVideoField<NonNullable<ResultOf<typeof GET_JOB>["enrichmentJob"]>>
  | OptionalVideoField<
      NonNullable<ResultOf<typeof LIST_JOBS>["enrichmentJobs"][number]>
    >
  | OptionalVideoField<
      NonNullable<ResultOf<typeof LIST_JOB_SUMMARIES>["enrichmentJobs"][number]>
    >

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
        .map((parent: { title: string | null } | null) => parent?.title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  )

  return {
    id: node.documentId,
    muxAssetId: node.muxAssetId,
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

function toStepState(
  s: NonNullable<EnrichmentJobNode["steps"]>[number],
): JobStepState {
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

type StrapiStepInput = NonNullable<
  NonNullable<VariablesOf<typeof CREATE_JOB>["data"]>["steps"]
>[number]

/** Convert local step objects into the shape Strapi expects for the repeatable component. */
function toStepInput(steps: JobStepState[]): StrapiStepInput[] {
  return steps.map(
    (s) =>
      ({
        name: s.name,
        status: s.status,
        retries: s.retries,
        startedAt: s.startedAt ?? null,
        finishedAt: s.finishedAt ?? null,
        error: s.error ?? null,
        details: s.details ?? null,
      }) as StrapiStepInput,
  )
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
  },
): Promise<JobRecord> {
  const steps = buildInitialSteps()

  if (options?.videoDocumentId) {
    const response = await cmsPost<{ documentId: string }>(
      "/enrichment-job/internal-create",
      {
        muxAssetId,
        muxPlaybackId,
        languages,
        status: "pending",
        retries: 0,
        artifacts: options.initialArtifacts ?? {},
        errors: [],
        steps: toStepInput(steps),
        videoDocumentId: options.videoDocumentId,
      },
    )

    const job = await getJob(response.documentId)
    if (!job) {
      throw new Error("Failed to load enrichment job after CMS creation")
    }
    publishJobEvent(job)
    return job
  }

  const client = getClient()

  const result = await client.mutate({
    mutation: CREATE_JOB,
    variables: {
      data: {
        muxAssetId,
        muxPlaybackId,
        languages,
        status: "pending",
        retries: 0,
        artifacts: options?.initialArtifacts ?? {},
        errors: [],
        video: options?.videoDocumentId,
        steps: toStepInput(steps),
      },
    },
  })

  const data = result.data
  if (!data?.createEnrichmentJob) {
    throw new Error("Failed to create enrichment job")
  }
  const job = toJobRecord(data.createEnrichmentJob)
  publishJobEvent(job)
  return job
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const result = await getJobLookup(id)
  return result.status === "found" ? result.job : null
}

export async function getJobLookup(id: string): Promise<JobLookupResult> {
  const client = getClient()

  try {
    const result = await client.query({
      query: GET_JOB,
      variables: { documentId: id },
      fetchPolicy: "no-cache",
    })

    if (!result.data?.enrichmentJob) {
      return { status: "not-found" }
    }

    return {
      status: "found",
      job: toJobRecord(result.data.enrichmentJob),
    }
  } catch (err) {
    console.warn(`[state] getJob(${id}) failed:`, err)
    return {
      status: "error",
      error: err,
    }
  }
}

export async function listJobs(): Promise<JobRecord[]> {
  const client = getClient()

  const result = await client.query({
    query: LIST_JOBS,
    fetchPolicy: "no-cache",
  })

  return (result.data?.enrichmentJobs ?? [])
    .filter((node): node is NonNullable<typeof node> => node != null)
    .map((node) => toJobRecord(node))
}

export async function listJobSummaries(): Promise<JobRecord[]> {
  const client = getClient()

  const result = await client.query({
    query: LIST_JOB_SUMMARIES,
    fetchPolicy: "no-cache",
  })

  return (result.data?.enrichmentJobs ?? [])
    .filter((node): node is NonNullable<typeof node> => node != null)
    .map((node) => toJobRecord(node))
}

export async function countJobs(): Promise<number> {
  const client = getClient()

  const result = await client.query({
    query: COUNT_JOBS,
    fetchPolicy: "no-cache",
  })

  return result.data?.enrichmentJobs_connection?.pageInfo.total ?? 0
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
  const client = getClient()

  const data = buildJobUpdateData(updates)

  try {
    const mutResult = await client.mutate({
      mutation: UPDATE_JOB,
      variables: { documentId: id, data },
    })

    const result = mutResult.data
    if (!result?.updateEnrichmentJob) return null
    const job = toJobRecord(result.updateEnrichmentJob)
    publishJobEvent(job)
    return job
  } catch (err) {
    console.warn(`[state] updateJob(${id}) failed:`, err)
    return null
  }
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
  // We need to read-then-write because Strapi replaces the entire repeatable
  // component array on update — there is no patch-single-item operation.
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

  const client = getClient()

  try {
    const mutResult = await client.mutate({
      mutation: UPDATE_JOB,
      variables: {
        documentId: jobId,
        data: {
          steps: toStepInput(steps),
          errors,
        },
      },
    })

    const resultData = mutResult.data
    if (!resultData?.updateEnrichmentJob) return null
    const jobRecord = toJobRecord(resultData.updateEnrichmentJob)
    publishJobEvent(jobRecord)
    return jobRecord
  } catch (err) {
    console.warn(`[state] updateStepStatus(${jobId}, ${stepName}) failed:`, err)
    return null
  }
}
