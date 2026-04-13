import { gql } from "@apollo/client"
import getClient from "@/cms/client"
import {
  normalizeErrors,
  normalizeTargetLanguageIds,
  type AutomationDryRunReport,
  type AutomationDraft,
  type AutomationRunMode,
  type AutomationSchedule,
  type AutomationRunStatus,
  type AutomationTemplate,
  type EnrichmentAutomation,
  type EnrichmentAutomationRun,
} from "./automation-contract"
import type { AutomationRunResult } from "./automation-runner"

type RawAutomationRun = {
  documentId: string
  status: AutomationRunStatus
  runMode?: AutomationRunMode | null
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
  report?: unknown
}

type RawAutomation = {
  documentId: string
  name: string
  template: AutomationTemplate
  status: "active" | "paused"
  runMode?: AutomationRunMode | null
  schedule: AutomationSchedule
  scheduleSummary?: string | null
  timezone?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastRunStatus?: EnrichmentAutomation["lastRunStatus"]
  refreshMode: "missing_only" | "refresh_ai_generated"
  targetLanguageIds?: unknown
  maxVideosPerRun: number
  leaseToken?: string | null
  leaseExpiresAt?: string | null
  runs?: Array<RawAutomationRun | null> | null
}

const AUTOMATION_RUN_FIELDS = gql`
  fragment AutomationRunFields on EnrichmentAutomationRun {
    documentId
    status
    runMode
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
    report
  }
`

const AUTOMATION_FIELDS = gql`
  fragment AutomationFields on EnrichmentAutomation {
    documentId
    name
    template
    status
    runMode
    schedule
    scheduleSummary
    timezone
    nextRunAt
    lastRunAt
    lastRunStatus
    refreshMode
    targetLanguageIds
    maxVideosPerRun
    leaseToken
    leaseExpiresAt
    runs(sort: ["startedAt:desc"], pagination: { pageSize: 5 }) {
      ...AutomationRunFields
    }
  }
  ${AUTOMATION_RUN_FIELDS}
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

const GET_AUTOMATION = gql`
  query GetEnrichmentAutomation($documentId: ID!) {
    enrichmentAutomation(documentId: $documentId) {
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

const CREATE_AUTOMATION_RUN = gql`
  mutation CreateEnrichmentAutomationRun($data: EnrichmentAutomationRunInput!) {
    createEnrichmentAutomationRun(data: $data) {
      ...AutomationRunFields
    }
  }
  ${AUTOMATION_RUN_FIELDS}
`

const UPDATE_AUTOMATION_RUN = gql`
  mutation UpdateEnrichmentAutomationRun(
    $documentId: ID!
    $data: EnrichmentAutomationRunInput!
  ) {
    updateEnrichmentAutomationRun(documentId: $documentId, data: $data) {
      ...AutomationRunFields
    }
  }
  ${AUTOMATION_RUN_FIELDS}
`

const GET_LANGUAGES_BY_CORE_ID = gql`
  query GetAutomationLanguages($filters: LanguageFiltersInput) {
    languages(filters: $filters, pagination: { pageSize: 100 }) {
      coreId
    }
  }
`

function normalizeRunMode(value: AutomationRunMode | null | undefined) {
  return value ?? "live"
}

function normalizeDryRunReport(value: unknown): AutomationDryRunReport | null {
  if (
    typeof value !== "object" ||
    value == null ||
    Array.isArray(value) ||
    (value as { kind?: unknown }).kind !== "metadata"
  ) {
    return null
  }

  const data = (value as { data?: unknown }).data
  if (
    typeof data !== "object" ||
    data == null ||
    Array.isArray(data) ||
    (data as { runMode?: unknown }).runMode !== "dry_run"
  ) {
    return null
  }

  return value as AutomationDryRunReport
}

function normalizeRun(run: RawAutomationRun): EnrichmentAutomationRun {
  return {
    documentId: run.documentId,
    status: run.status,
    runMode: normalizeRunMode(run.runMode),
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
    report: normalizeDryRunReport(run.report),
  }
}

function normalizeAutomation(raw: RawAutomation): EnrichmentAutomation {
  return {
    documentId: raw.documentId,
    name: raw.name,
    template: raw.template,
    status: raw.status,
    runMode: normalizeRunMode(raw.runMode),
    schedule: raw.schedule,
    scheduleSummary: raw.scheduleSummary,
    timezone: raw.timezone ?? raw.schedule.timezone,
    nextRunAt: raw.nextRunAt,
    lastRunAt: raw.lastRunAt,
    lastRunStatus: raw.lastRunStatus,
    refreshMode: raw.refreshMode,
    targetLanguageIds: normalizeTargetLanguageIds(raw.targetLanguageIds),
    maxVideosPerRun: raw.maxVideosPerRun,
    leaseToken: raw.leaseToken,
    leaseExpiresAt: raw.leaseExpiresAt,
    runs: (raw.runs ?? [])
      .filter((run): run is RawAutomationRun => run != null)
      .map(normalizeRun),
  }
}

export async function getAutomation(
  documentId: string,
): Promise<EnrichmentAutomation | null> {
  const client = getClient()
  const result = await client.query<{
    enrichmentAutomation?: RawAutomation | null
  }>({
    query: GET_AUTOMATION,
    variables: { documentId },
    fetchPolicy: "no-cache",
  })

  const automation = result.data?.enrichmentAutomation
  return automation ? normalizeAutomation(automation) : null
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
        runMode: input.runMode,
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

export async function createAutomationRun(input: {
  automationDocumentId: string
  runMode: AutomationRunMode
  scheduledFor: string
  startedAt: string
}): Promise<EnrichmentAutomationRun> {
  const client = getClient()
  const result = await client.mutate<{
    createEnrichmentAutomationRun?: RawAutomationRun | null
  }>({
    mutation: CREATE_AUTOMATION_RUN,
    variables: {
      data: {
        automation: input.automationDocumentId,
        status: "running",
        runMode: input.runMode,
        scheduledFor: input.scheduledFor,
        startedAt: input.startedAt,
        eligibleCount: 0,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
      },
    },
  })

  const run = result.data?.createEnrichmentAutomationRun
  if (!run) {
    throw new Error("Failed to create enrichment automation run")
  }

  return normalizeRun(run)
}

export async function completeAutomationRun(input: {
  runDocumentId: string
  result: AutomationRunResult
  finishedAt: string
}): Promise<EnrichmentAutomationRun> {
  const client = getClient()
  const result = await client.mutate<{
    updateEnrichmentAutomationRun?: RawAutomationRun | null
  }>({
    mutation: UPDATE_AUTOMATION_RUN,
    variables: {
      documentId: input.runDocumentId,
      data: {
        status: input.result.status,
        finishedAt: input.finishedAt,
        eligibleCount: input.result.eligibleCount,
        enqueuedCount: input.result.enqueuedCount,
        skippedDuplicateCount: input.result.skippedDuplicateCount,
        errorCount: input.result.errorCount,
        jobDocumentIds: input.result.jobDocumentIds,
        errors: input.result.errors,
        summary: input.result.summary,
        ...(input.result.dryRunReport
          ? {
              runMode: "dry_run",
              report: input.result.dryRunReport,
            }
          : {}),
      },
    },
  })

  const run = result.data?.updateEnrichmentAutomationRun
  if (!run) {
    throw new Error("Failed to complete enrichment automation run")
  }

  return normalizeRun(run)
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
