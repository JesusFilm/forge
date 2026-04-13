import { gql } from "@apollo/client"
import getClient from "@/cms/client"
import {
  normalizeErrors,
  normalizeTargetLanguageIds,
  type AutomationDraft,
  type AutomationSchedule,
  type AutomationRunStatus,
  type AutomationTemplate,
  type EnrichmentAutomation,
  type EnrichmentAutomationRun,
} from "./automation-contract"

type RawAutomationRun = {
  documentId: string
  status: AutomationRunStatus
  scheduledFor: string
  startedAt?: string | null
  finishedAt?: string | null
  eligibleCount?: number | null
  enqueuedCount?: number | null
  skippedDuplicateCount?: number | null
  errorCount?: number | null
  jobDocumentIds?: unknown
  errors?: unknown
  summary?: string | null
}

type RawAutomation = {
  documentId: string
  name: string
  template: AutomationTemplate
  status: "active" | "paused"
  schedule: AutomationSchedule
  scheduleSummary?: string | null
  timezone?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastRunStatus?: EnrichmentAutomation["lastRunStatus"]
  refreshMode: "missing_only" | "refresh_ai_generated"
  targetLanguageIds?: unknown
  maxVideosPerRun: number
  runs?: Array<RawAutomationRun | null> | null
}

const AUTOMATION_FIELDS = gql`
  fragment AutomationFields on EnrichmentAutomation {
    documentId
    name
    template
    status
    schedule
    scheduleSummary
    timezone
    nextRunAt
    lastRunAt
    lastRunStatus
    refreshMode
    targetLanguageIds
    maxVideosPerRun
    runs(sort: ["startedAt:desc"], pagination: { pageSize: 5 }) {
      documentId
      status
      scheduledFor
      startedAt
      finishedAt
      eligibleCount
      enqueuedCount
      skippedDuplicateCount
      errorCount
      jobDocumentIds
      errors
      summary
    }
  }
`

const LIST_AUTOMATIONS = gql`
  query ListEnrichmentAutomations {
    enrichmentAutomations(
      sort: ["createdAt:desc"]
      pagination: { pageSize: 100 }
    ) {
      ...AutomationFields
    }
  }
  ${AUTOMATION_FIELDS}
`

const CREATE_AUTOMATION = gql`
  mutation CreateEnrichmentAutomation($data: EnrichmentAutomationInput!) {
    createEnrichmentAutomation(data: $data) {
      ...AutomationFields
    }
  }
  ${AUTOMATION_FIELDS}
`

const UPDATE_AUTOMATION = gql`
  mutation UpdateEnrichmentAutomation(
    $documentId: ID!
    $data: EnrichmentAutomationInput!
  ) {
    updateEnrichmentAutomation(documentId: $documentId, data: $data) {
      ...AutomationFields
    }
  }
  ${AUTOMATION_FIELDS}
`

const GET_LANGUAGES_BY_CORE_ID = gql`
  query GetAutomationLanguages($filters: LanguageFiltersInput) {
    languages(filters: $filters, pagination: { pageSize: 100 }) {
      coreId
    }
  }
`

function normalizeRun(run: RawAutomationRun): EnrichmentAutomationRun {
  return {
    documentId: run.documentId,
    status: run.status,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    eligibleCount: run.eligibleCount ?? 0,
    enqueuedCount: run.enqueuedCount ?? 0,
    skippedDuplicateCount: run.skippedDuplicateCount ?? 0,
    errorCount: run.errorCount ?? 0,
    jobDocumentIds: normalizeTargetLanguageIds(run.jobDocumentIds),
    errors: normalizeErrors(run.errors),
    summary: run.summary,
  }
}

function normalizeAutomation(raw: RawAutomation): EnrichmentAutomation {
  return {
    documentId: raw.documentId,
    name: raw.name,
    template: raw.template,
    status: raw.status,
    schedule: raw.schedule,
    scheduleSummary: raw.scheduleSummary,
    timezone: raw.timezone ?? raw.schedule.timezone,
    nextRunAt: raw.nextRunAt,
    lastRunAt: raw.lastRunAt,
    lastRunStatus: raw.lastRunStatus,
    refreshMode: raw.refreshMode,
    targetLanguageIds: normalizeTargetLanguageIds(raw.targetLanguageIds),
    maxVideosPerRun: raw.maxVideosPerRun,
    runs: (raw.runs ?? [])
      .filter((run): run is RawAutomationRun => run != null)
      .map(normalizeRun),
  }
}

export async function listAutomations(): Promise<EnrichmentAutomation[]> {
  const client = getClient()
  const result = await client.query<{
    enrichmentAutomations?: Array<RawAutomation | null>
  }>({
    query: LIST_AUTOMATIONS,
    fetchPolicy: "no-cache",
  })

  return (result.data?.enrichmentAutomations ?? [])
    .filter((automation): automation is RawAutomation => automation != null)
    .map(normalizeAutomation)
}

export async function createAutomation(
  input: AutomationDraft & {
    status: "active"
    scheduleSummary: string
    timezone: string
    nextRunAt: string
  },
): Promise<EnrichmentAutomation> {
  const client = getClient()
  const result = await client.mutate<{
    createEnrichmentAutomation?: RawAutomation | null
  }>({
    mutation: CREATE_AUTOMATION,
    variables: {
      data: {
        name: input.name,
        template: input.template,
        status: input.status,
        schedule: input.schedule,
        scheduleSummary: input.scheduleSummary,
        timezone: input.timezone,
        nextRunAt: input.nextRunAt,
        refreshMode: input.refreshMode,
        targetLanguageIds: input.targetLanguageIds,
        maxVideosPerRun: input.maxVideosPerRun,
      },
    },
  })

  const automation = result.data?.createEnrichmentAutomation
  if (!automation) {
    throw new Error("Failed to create enrichment automation")
  }

  return normalizeAutomation(automation)
}

export async function updateAutomationStatus(
  documentId: string,
  input: { status: "active" | "paused"; nextRunAt: string | null },
): Promise<EnrichmentAutomation> {
  const client = getClient()
  const result = await client.mutate<{
    updateEnrichmentAutomation?: RawAutomation | null
  }>({
    mutation: UPDATE_AUTOMATION,
    variables: {
      documentId,
      data: {
        status: input.status,
        nextRunAt: input.nextRunAt,
        ...(input.status === "paused"
          ? {
              leaseToken: null,
              leaseExpiresAt: null,
            }
          : {}),
      },
    },
  })

  const automation = result.data?.updateEnrichmentAutomation
  if (!automation) {
    throw new Error("Failed to update enrichment automation")
  }

  return normalizeAutomation(automation)
}

export async function findMissingLanguageIds(
  languageIds: string[],
): Promise<string[]> {
  if (languageIds.length === 0) return []

  const client = getClient()
  const result = await client.query<{
    languages?: Array<{ coreId?: string | null } | null>
  }>({
    query: GET_LANGUAGES_BY_CORE_ID,
    variables: {
      filters: { coreId: { in: languageIds } },
    },
    fetchPolicy: "no-cache",
  })

  const found = new Set(
    (result.data?.languages ?? [])
      .map((language) => language?.coreId)
      .filter((coreId): coreId is string => coreId != null),
  )
  return languageIds.filter((languageId) => !found.has(languageId))
}
