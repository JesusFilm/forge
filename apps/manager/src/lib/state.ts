// Job state manager backed by Strapi CMS via GraphQL.
// Uses typed operations from @forge/graphql with gql.tada.

import { graphql, type ResultOf, type VariablesOf } from "@forge/graphql"
import getClient from "@/cms/client"
import { buildInitialSteps } from "@/lib/workflow-steps"
import type {
  JobRecord,
  JobStatus,
  JobStepState,
  JobOptions,
  WorkflowStepName,
  StepStatus,
} from "@/types/job"

export type { JobRecord, JobStatus, WorkflowStepName, StepStatus }

// ---------------------------------------------------------------------------
// GraphQL fragments & operations (typed via gql.tada)
// ---------------------------------------------------------------------------

const JOB_FIELDS = graphql(`
  fragment JobFields on EnrichmentJob @_unmask {
    documentId
    muxAssetId
    muxPlaybackId
    options
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
    }
    video {
      documentId
      coreId
      title
    }
  }
`)

const CREATE_JOB = graphql(
  `
    mutation CreateEnrichmentJob($data: EnrichmentJobInput!) {
      createEnrichmentJob(data: $data) {
        ...JobFields
      }
    }
  `,
  [JOB_FIELDS],
)

const UPDATE_JOB = graphql(
  `
    mutation UpdateEnrichmentJob($documentId: ID!, $data: EnrichmentJobInput!) {
      updateEnrichmentJob(documentId: $documentId, data: $data) {
        ...JobFields
      }
    }
  `,
  [JOB_FIELDS],
)

const GET_JOB = graphql(
  `
    query GetEnrichmentJob($documentId: ID!) {
      enrichmentJob(documentId: $documentId) {
        ...JobFields
      }
    }
  `,
  [JOB_FIELDS],
)

const LIST_JOBS = graphql(
  `
    query ListEnrichmentJobs {
      enrichmentJobs(sort: "createdAt:desc", pagination: { pageSize: 50 }) {
        ...JobFields
      }
    }
  `,
  [JOB_FIELDS],
)

// ---------------------------------------------------------------------------
// Types inferred from the fragment
// ---------------------------------------------------------------------------

type EnrichmentJobNode = NonNullable<ResultOf<typeof GET_JOB>["enrichmentJob"]>
type CreateJobContext = {
  options?: JobOptions
  videoDocumentId?: string
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map a Strapi GraphQL response node to a local JobRecord. */
export function toJobRecord(node: EnrichmentJobNode): JobRecord {
  return {
    id: node.documentId,
    muxAssetId: node.muxAssetId,
    muxPlaybackId: node.muxPlaybackId ?? "",
    videoDocumentId: node.video?.documentId,
    videoCoreId: node.video?.coreId ?? undefined,
    languages: (node.languages ?? []) as string[],
    sourceMediaTitle: node.video?.title ?? undefined,
    options: toJobOptions(node.options),
    status: node.status as JobStatus,
    currentStep: node.currentStep as WorkflowStepName | undefined,
    retries: node.retries ?? 0,
    createdAt: String(node.createdAt ?? ""),
    updatedAt: String(node.updatedAt ?? ""),
    startedAt: node.startedAt ? String(node.startedAt) : undefined,
    completedAt: node.completedAt ? String(node.completedAt) : undefined,
    artifacts: (node.artifacts ?? {}) as Record<string, string>,
    steps: (node.steps ?? []).map(toStepState),
    errors: (node.errors ?? []) as JobRecord["errors"],
  }
}

function toJobOptions(value: unknown): JobOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const raw = value as Record<string, unknown>
  const options: JobOptions = {}
  if (typeof raw.generateVoiceover === "boolean") {
    options.generateVoiceover = raw.generateVoiceover
  }
  if (typeof raw.uploadMux === "boolean") {
    options.uploadMux = raw.uploadMux
  }
  if (typeof raw.notifyCms === "boolean") {
    options.notifyCms = raw.notifyCms
  }
  return options
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
    }
  }
  return {
    name: s.name as WorkflowStepName,
    status: s.status as StepStatus,
    retries: s.retries ?? 0,
    startedAt: s.startedAt ? String(s.startedAt) : undefined,
    finishedAt: s.finishedAt ? String(s.finishedAt) : undefined,
    error: s.error ?? undefined,
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
      }) as StrapiStepInput,
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createJob(
  muxAssetId: string,
  muxPlaybackId: string,
  languages: string[] = [],
  context: CreateJobContext = {},
): Promise<JobRecord> {
  const client = getClient()
  const steps = buildInitialSteps()
  const options: JobOptions = { ...context.options }
  if (options.notifyCms && !context.videoDocumentId) {
    options.notifyCms = false
  }

  const result = await client.mutate({
    mutation: CREATE_JOB,
    variables: {
      data: {
        muxAssetId,
        muxPlaybackId,
        languages,
        options,
        ...(context.videoDocumentId ? { video: context.videoDocumentId } : {}),
        status: "pending",
        retries: 0,
        artifacts: {},
        errors: [],
        steps: toStepInput(steps),
      },
    },
  })

  const data = result.data
  if (!data?.createEnrichmentJob) {
    throw new Error("Failed to create enrichment job")
  }
  return toJobRecord(data.createEnrichmentJob)
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const client = getClient()

  try {
    const result = await client.query({
      query: GET_JOB,
      variables: { documentId: id },
      fetchPolicy: "no-cache",
    })

    if (!result.data?.enrichmentJob) return null
    return toJobRecord(result.data.enrichmentJob)
  } catch (err) {
    console.warn(`[state] getJob(${id}) failed:`, err)
    return null
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

export async function updateJob(
  id: string,
  updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "startedAt"
      | "completedAt"
      | "retries"
    >
  >,
): Promise<JobRecord | null> {
  const client = getClient()

  // Build only the fields that were actually provided.
  const data: Record<string, unknown> = {}
  if (updates.status !== undefined) data.status = updates.status
  if (updates.currentStep !== undefined) data.currentStep = updates.currentStep
  if (updates.artifacts !== undefined) data.artifacts = updates.artifacts
  if (updates.startedAt !== undefined) data.startedAt = updates.startedAt
  if (updates.completedAt !== undefined) data.completedAt = updates.completedAt
  if (updates.retries !== undefined) data.retries = updates.retries

  try {
    const mutResult = await client.mutate({
      mutation: UPDATE_JOB,
      variables: { documentId: id, data },
    })

    const result = mutResult.data
    if (!result?.updateEnrichmentJob) return null
    return toJobRecord(result.updateEnrichmentJob)
  } catch (err) {
    console.warn(`[state] updateJob(${id}) failed:`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Per-job mutex for serializing step updates (read-then-write)
// ---------------------------------------------------------------------------

const jobUpdateLocks = new Map<string, Promise<unknown>>()

export async function updateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
): Promise<JobRecord | null> {
  // Serialize per-job to avoid read-then-write race conditions.
  const previous = jobUpdateLocks.get(jobId) ?? Promise.resolve()
  const next = previous.then(() =>
    doUpdateStepStatus(jobId, stepName, status, error),
  )
  jobUpdateLocks.set(
    jobId,
    next.catch(() => {}),
  )
  return next
}

async function doUpdateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
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
    return toJobRecord(resultData.updateEnrichmentJob)
  } catch (err) {
    console.warn(`[state] updateStepStatus(${jobId}, ${stepName}) failed:`, err)
    return null
  }
}
