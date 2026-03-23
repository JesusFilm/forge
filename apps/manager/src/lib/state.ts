// Job state manager backed by Strapi CMS via GraphQL.
// Replaces the previous file-based (.data/jobs.json) implementation.
//
// TODO: Once codegen runs for the EnrichmentJob content type, replace raw `gql`
// operations with typed operations from @forge/graphql. The introspection types
// in packages/graphql/src/graphql-env.d.ts don't include EnrichmentJob yet.

import { gql } from "@apollo/client"
import getClient from "@/cms/client"
import { buildInitialSteps } from "@/lib/workflow-steps"
import type {
  JobRecord,
  JobStatus,
  JobStepState,
  WorkflowStepName,
  StepStatus,
} from "@/types/job"

export type { JobRecord, JobStatus, WorkflowStepName, StepStatus }

// ---------------------------------------------------------------------------
// GraphQL fragments & operations (untyped — see TODO above)
// ---------------------------------------------------------------------------

const JOB_FIELDS = gql`
  fragment JobFields on EnrichmentJob {
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
    }
  }
`

const CREATE_JOB = gql`
  mutation CreateEnrichmentJob($data: EnrichmentJobInput!) {
    createEnrichmentJob(data: $data) {
      ...JobFields
    }
  }
  ${JOB_FIELDS}
`

const UPDATE_JOB = gql`
  mutation UpdateEnrichmentJob($documentId: ID!, $data: EnrichmentJobInput!) {
    updateEnrichmentJob(documentId: $documentId, data: $data) {
      ...JobFields
    }
  }
  ${JOB_FIELDS}
`

const GET_JOB = gql`
  query GetEnrichmentJob($documentId: ID!) {
    enrichmentJob(documentId: $documentId) {
      ...JobFields
    }
  }
  ${JOB_FIELDS}
`

const LIST_JOBS = gql`
  query ListEnrichmentJobs {
    enrichmentJobs(sort: "createdAt:desc", pagination: { pageSize: 50 }) {
      ...JobFields
    }
  }
  ${JOB_FIELDS}
`

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map a Strapi GraphQL response node to a local JobRecord. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJobRecord(node: any): JobRecord {
  return {
    id: node.documentId,
    muxAssetId: node.muxAssetId,
    muxPlaybackId: node.muxPlaybackId ?? "",
    languages: node.languages ?? [],
    options: {},
    status: node.status as JobStatus,
    currentStep: node.currentStep as WorkflowStepName | undefined,
    retries: node.retries ?? 0,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    startedAt: node.startedAt ?? undefined,
    completedAt: node.completedAt ?? undefined,
    artifacts: node.artifacts ?? {},
    steps: (node.steps ?? []).map(toStepState),
    errors: node.errors ?? [],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStepState(s: any): JobStepState {
  return {
    name: s.name as WorkflowStepName,
    status: s.status as StepStatus,
    retries: s.retries ?? 0,
    startedAt: s.startedAt ?? undefined,
    finishedAt: s.finishedAt ?? undefined,
    error: s.error ?? undefined,
  }
}

/** Convert local step objects into the shape Strapi expects for the repeatable component. */
function toStepInput(steps: JobStepState[]) {
  return steps.map((s) => ({
    name: s.name,
    status: s.status,
    retries: s.retries,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    error: s.error ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createJob(
  muxAssetId: string,
  muxPlaybackId: string,
  languages: string[] = [],
): Promise<JobRecord> {
  const client = getClient()
  const steps = buildInitialSteps()

  const result = await client.mutate({
    mutation: CREATE_JOB,
    variables: {
      data: {
        muxAssetId,
        muxPlaybackId,
        languages,
        status: "pending",
        retries: 0,
        artifacts: {},
        errors: [],
        steps: toStepInput(steps),
      },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = result.data as any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any
    if (!data.enrichmentJob) return null
    return toJobRecord(data.enrichmentJob)
  } catch {
    return null
  }
}

export async function listJobs(): Promise<JobRecord[]> {
  const client = getClient()

  const result = await client.query({
    query: LIST_JOBS,
    fetchPolicy: "no-cache",
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = result.data as any
  return (data.enrichmentJobs ?? []).map(toJobRecord)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {}
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = mutResult.data as any
    if (!result?.updateEnrichmentJob) return null
    return toJobRecord(result.updateEnrichmentJob)
  } catch {
    return null
  }
}

export async function updateStepStatus(
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultData = mutResult.data as any
    if (!resultData?.updateEnrichmentJob) return null
    return toJobRecord(resultData.updateEnrichmentJob)
  } catch {
    return null
  }
}
