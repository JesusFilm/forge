import { gql } from "@apollo/client"
import { z } from "zod"
import getClient from "@/cms/client"
import {
  getCmsGateway,
  readMockCmsState,
  updateMockCmsState,
} from "@/cms/gateway"
import { cmsPost } from "@/services/cmsClient"
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

type AutomationDryRunClaim = {
  documentId: string
  leaseToken: string
  leaseExpiresAt: string
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

const GET_AUTOMATION_RUN = gql`
  query GetEnrichmentAutomationRun($documentId: ID!) {
    enrichmentAutomationRun(documentId: $documentId) {
      ...AutomationRunFields
    }
  }
  ${AUTOMATION_RUN_FIELDS}
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

const HAS_IN_FLIGHT_AUTOMATION_RUN = gql`
  query HasInFlightAutomationRun(
    $automationDocumentId: ID!
    $statuses: [String]
  ) {
    enrichmentAutomationRuns(
      filters: {
        automation: { documentId: { eq: $automationDocumentId } }
        status: { in: $statuses }
      }
      pagination: { pageSize: 1 }
    ) {
      documentId
    }
  }
`

const GET_LANGUAGES_BY_CORE_ID = gql`
  query GetAutomationLanguages($filters: LanguageFiltersInput) {
    languages(filters: $filters, pagination: { pageSize: 100 }) {
      coreId
    }
  }
`

const automationDryRunClaimSchema = z.object({
  documentId: z.string(),
  leaseToken: z.string(),
  leaseExpiresAt: z.string(),
})

const automationDryRunReleaseSchema = z.object({
  released: z.boolean(),
})

const automationRunFailedIfInFlightSchema = z.object({
  updated: z.boolean(),
})

function normalizeRunMode(value: AutomationRunMode | null | undefined) {
  return value ?? "live"
}

function nextMockDocumentId(prefix: string, values: string[]): string {
  const nextNumber =
    values.reduce((max, value) => {
      const match = value.match(new RegExp(`^${prefix}-(\\d+)$`))
      return match ? Math.max(max, Number(match[1])) : max
    }, 0) + 1
  return `${prefix}-${nextNumber}`
}

const dryRunReportSchema = z.object({
  kind: z.literal("metadata"),
  data: z.object({
    runMode: z.literal("dry_run"),
    automationDocumentId: z.string(),
    automationRunDocumentId: z.string(),
    template: z.enum([
      "source_subtitles_missing",
      "target_subtitles_missing",
      "metadata_missing",
      "transcript_embeddings_missing",
    ]),
    refreshMode: z.enum(["missing_only", "refresh_ai_generated"]),
    targetLanguageIds: z.array(z.string()),
    maxVideosPerRun: z.number(),
    eligibleCount: z.number(),
    skippedDuplicateCount: z.number(),
    wouldEnqueueCount: z.number(),
    selectedCandidates: z.array(
      z.object({
        videoDocumentId: z.string(),
        coreId: z.string(),
        outputOwner: z.enum(["missing", "ai", "human"]),
        automationKey: z.string(),
      }),
    ),
    suppressedOperations: z.array(z.string()),
    summary: z.string(),
    generatedAt: z.string(),
  }),
})

function normalizeDryRunReport(value: unknown): AutomationDryRunReport | null {
  const parsed = dryRunReportSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return (
      mockState.readModels.automations.find(
        (automation) => automation.documentId === documentId,
      ) ?? null
    )
  }

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
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return mockState.readModels.automations
  }

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

export async function getAutomationRun(
  documentId: string,
): Promise<EnrichmentAutomationRun | null> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return (
      mockState.readModels.automations
        .flatMap((automation) => automation.runs)
        .find((run) => run.documentId === documentId) ?? null
    )
  }

  const client = getClient()
  const result = await client.query<{
    enrichmentAutomationRun?: RawAutomationRun | null
  }>({
    query: GET_AUTOMATION_RUN,
    variables: { documentId },
    fetchPolicy: "no-cache",
  })

  const run = result.data?.enrichmentAutomationRun
  return run ? normalizeRun(run) : null
}

export async function hasInFlightAutomationRun(
  automationDocumentId: string,
): Promise<boolean> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    const automation = mockState.readModels.automations.find(
      (candidate) => candidate.documentId === automationDocumentId,
    )
    return Boolean(
      automation?.runs.some(
        (run) => run.status === "claimed" || run.status === "running",
      ),
    )
  }

  const client = getClient()
  const result = await client.query<{
    enrichmentAutomationRuns?: Array<{ documentId?: string | null } | null>
  }>({
    query: HAS_IN_FLIGHT_AUTOMATION_RUN,
    variables: {
      automationDocumentId,
      statuses: ["claimed", "running"],
    },
    fetchPolicy: "no-cache",
  })

  return (result.data?.enrichmentAutomationRuns ?? []).some(
    (run) => run?.documentId != null,
  )
}

function isCmsConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "status" in error &&
    (error as { status?: unknown }).status === 409
  )
}

export async function claimAutomationDryRun(
  automationDocumentId: string,
): Promise<AutomationDryRunClaim | null> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const automation = mockState.readModels.automations.find(
      (candidate) => candidate.documentId === automationDocumentId,
    )
    if (!automation) return null
    if (
      automation.leaseToken &&
      automation.leaseExpiresAt &&
      new Date(automation.leaseExpiresAt).getTime() > Date.now()
    ) {
      return null
    }

    const claim: AutomationDryRunClaim = {
      documentId: automationDocumentId,
      leaseToken: `lease-${Date.now()}`,
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((candidate) =>
          candidate.documentId === automationDocumentId
            ? {
                ...candidate,
                leaseToken: claim.leaseToken,
                leaseExpiresAt: claim.leaseExpiresAt,
              }
            : candidate,
        ),
      },
    }))
    return claim
  }

  try {
    const response = await cmsPost<unknown>(
      `/enrichment-automation/${encodeURIComponent(
        automationDocumentId,
      )}/manual-dry-run-claim`,
      {},
    )
    return automationDryRunClaimSchema.parse(response)
  } catch (error) {
    if (isCmsConflict(error)) return null
    throw error
  }
}

export async function releaseAutomationDryRunClaim(
  automationDocumentId: string,
  leaseToken: string,
): Promise<boolean> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((candidate) =>
          candidate.documentId === automationDocumentId &&
          candidate.leaseToken === leaseToken
            ? {
                ...candidate,
                leaseToken: null,
                leaseExpiresAt: null,
              }
            : candidate,
        ),
      },
    }))
    return true
  }

  const response = await cmsPost<unknown>(
    `/enrichment-automation/${encodeURIComponent(
      automationDocumentId,
    )}/manual-dry-run-release`,
    { leaseToken },
  )
  return automationDryRunReleaseSchema.parse(response).released
}

export async function markAutomationRunFailedIfInFlight(input: {
  runDocumentId: string
  error: string
  finishedAt: string
}): Promise<boolean> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let updated = false
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => ({
          ...automation,
          runs: automation.runs.map((run) => {
            if (
              run.documentId !== input.runDocumentId ||
              (run.status !== "claimed" && run.status !== "running")
            ) {
              return run
            }
            updated = true
            return {
              ...run,
              status: "failed",
              finishedAt: input.finishedAt,
              errorCount: 1,
              errors: [input.error],
              summary: "Automation dry run failed.",
            }
          }),
        })),
      },
    }))
    return updated
  }

  const response = await cmsPost<unknown>(
    `/enrichment-automation-run/${encodeURIComponent(
      input.runDocumentId,
    )}/mark-failed-if-in-flight`,
    {
      error: input.error,
      finishedAt: input.finishedAt,
    },
  )
  return automationRunFailedIfInFlightSchema.parse(response).updated
}

export async function createAutomation(
  input: AutomationDraft & {
    status: "active"
    scheduleSummary: string
    timezone: string
    nextRunAt: string
  },
): Promise<EnrichmentAutomation> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const automation: EnrichmentAutomation = {
      documentId: nextMockDocumentId(
        "mock-automation",
        mockState.readModels.automations.map(
          (candidate) => candidate.documentId,
        ),
      ),
      name: input.name,
      template: input.template,
      status: input.status,
      runMode: input.runMode,
      schedule: input.schedule,
      scheduleSummary: input.scheduleSummary,
      timezone: input.timezone,
      nextRunAt: input.nextRunAt,
      lastRunAt: null,
      lastRunStatus: null,
      refreshMode: input.refreshMode,
      targetLanguageIds: input.targetLanguageIds,
      maxVideosPerRun: input.maxVideosPerRun,
      leaseToken: null,
      leaseExpiresAt: null,
      runs: [],
    }
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: [automation, ...current.readModels.automations],
      },
    }))
    return automation
  }

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
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const run: EnrichmentAutomationRun = {
      documentId: nextMockDocumentId(
        "mock-automation-run",
        mockState.readModels.automations.flatMap((automation) =>
          automation.runs.map((candidate) => candidate.documentId),
        ),
      ),
      status: "running",
      runMode: input.runMode,
      scheduledFor: input.scheduledFor,
      startedAt: input.startedAt,
      finishedAt: null,
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: null,
    }
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) =>
          automation.documentId === input.automationDocumentId
            ? { ...automation, runs: [run, ...automation.runs] }
            : automation,
        ),
      },
    }))
    return run
  }

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
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let completedRun: EnrichmentAutomationRun | null = null
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => {
          const hasRun = automation.runs.some(
            (candidate) => candidate.documentId === input.runDocumentId,
          )
          const runs = automation.runs.map((run) => {
            if (run.documentId !== input.runDocumentId) {
              return run
            }

            completedRun = {
              ...run,
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
                    runMode: "dry_run" as const,
                    report: input.result.dryRunReport,
                  }
                : {}),
            }
            return completedRun
          })

          if (!hasRun || !completedRun) {
            return automation
          }

          return {
            ...automation,
            runs,
            lastRunAt: input.finishedAt,
            lastRunStatus: input.result.status,
          }
        }),
      },
    }))

    if (!completedRun) {
      throw new Error("Failed to complete enrichment automation run")
    }
    return completedRun
  }

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
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) =>
          automation.documentId === documentId
            ? {
                ...automation,
                status: input.status,
                nextRunAt: input.nextRunAt,
                ...(input.status === "paused"
                  ? {
                      leaseToken: null,
                      leaseExpiresAt: null,
                    }
                  : {}),
              }
            : automation,
        ),
      },
    }))
    const automation =
      nextState?.readModels.automations.find(
        (candidate) => candidate.documentId === documentId,
      ) ?? null
    if (!automation) {
      throw new Error("Failed to update enrichment automation")
    }
    return automation
  }

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

  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    const available = new Set(
      mockState.readModels.languageGeo.languages.map((language) => language.id),
    )
    return languageIds.filter((languageId) => !available.has(languageId))
  }

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
