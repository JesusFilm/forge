import type {
  MockCoverageSnapshot,
  MockLanguageGeo,
  MockVideoCoverage,
} from "@/cms/mock-seed"
import {
  WORKFLOW_STEP_NAMES,
  type JobRecord,
  type JobStatus,
  type JobStepDetails,
  type StepStatus,
  type WorkflowStepName,
} from "@/types/job"
import {
  seoLessonSchema,
  seoProposalDecisionResultSchema,
  seoProposalSchema,
  seoRunDetailSchema,
  seoRunPageSchema,
  seoTicketReconciliationSchema,
  seoWorkspaceSchema,
  type SeoLesson,
  type SeoProposal,
  type SeoProposalDecisionResult,
  type SeoRunDetail,
  type SeoRunPage,
  type SeoTicketReconciliation,
  type SeoWorkspace,
} from "@/features/seo/seo-contract"
import { print } from "@apollo/client/utilities"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { z } from "zod"

type FetchLike = typeof fetch

export type CoverageSnapshotQuery =
  | { latest: true }
  | { startDate: string; endDate: string }
  | undefined

export type AdminGraphqlClientOptions = {
  graphqlUrl: string
  apiKey?: string
  fetchImpl?: FetchLike
}

export type AdminSeoProposalDecisionInput = {
  proposalId: string
  version: number
  payloadDigest: string
  assertion: string
  overlapAcknowledged: boolean
}

export type AdminSeoProposalRejectInput = AdminSeoProposalDecisionInput & {
  reason: string
}

export type AdminSeoLessonReviewInput = {
  lessonId: string
  status: "ACTIVE" | "SUPERSEDED" | "RETIRED"
  assertion: string
}

export type AdminSeoTicketReconcileInput = {
  outboxId: string
  action: "BIND_EXISTING" | "MARK_FAILED"
  remoteId?: string
  remoteUrl?: string
  assertion: string
}

type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message?: string }>
}

type CreateAdminJobInput = {
  muxAssetId: string
  muxPlaybackId: string
  videoDocumentId?: string
  languages: string[]
  sourceLanguageId?: string
  sourceLanguageCode?: string
  sourceSelectionReason?: string
  primaryRequestedTargetLanguageCode?: string
  resolvedTargetLanguageCodes?: string[]
  sourceCollectionTitle?: string
  sourceMediaTitle?: string
  requestedLanguageAbbreviations?: string[]
  options?: unknown
  artifacts?: unknown
  steps?: JobRecord["steps"]
  errors?: unknown[]
}

type UpdateAdminJobInput = Partial<
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
    | "sourceCollectionTitle"
    | "sourceMediaTitle"
    | "requestedLanguageAbbreviations"
  >
>

export type AdminVideoForEnrichment = {
  documentId: string
  coreId?: string | null
  title?: string | null
  label?: string | null
  primaryLanguage?: {
    coreId?: string | null
    bcp47?: string | null
    iso3?: string | null
  } | null
  variants?: Array<{
    language?: {
      coreId?: string | null
      bcp47?: string | null
      iso3?: string | null
    } | null
    muxVideo?: {
      assetId?: string | null
      playbackId?: string | null
    } | null
    downloads?: Array<{ url?: string | null } | null> | null
  } | null> | null
}

const VIDEO_COVERAGE_SELECTION = `
  documentId
  coreId
  title
  label
  slug
  aiMetadata
  imageUrl
  parentDocumentIds
  parentRelations {
    parentDocumentId
    order
  }
  coverage {
    subtitles { human ai }
    audio { human ai }
  }
`

const LANGUAGE_GEO_SELECTION = `
  continents { id name }
  countries { id name continentId }
  languages {
    id
    coreId
    bcp47
    iso3
    englishLabel
    nativeLabel
    countryIds
    continentIds
    countrySpeakers
  }
`

const VIDEO_ENRICHMENT_SELECTION = `
  documentId
  coreId
  title
  label
  primaryLanguage {
    coreId
    bcp47
    iso3
  }
  variants {
    language {
      coreId
      bcp47
      iso3
    }
    muxVideo {
      assetId
      playbackId
    }
    downloads {
      url
    }
  }
`

const COVERAGE_SNAPSHOT_SELECTION = `
  documentId
  date
  computedAt
  totalVideos
  videosWithAiMetadata
  videosWithHumanMetadata
  subtitlesHumanTotal
  subtitlesAiTotal
  audioHumanTotal
  audioAiTotal
  languageCoverage
`

const JOB_SELECTION = `
  id
  muxAssetId
  muxPlaybackId
  videoDocumentId
  languages
  sourceLanguageId
  sourceLanguageCode
  sourceSelectionReason
  primaryRequestedTargetLanguageCode
  resolvedTargetLanguageCodes
  sourceCollectionTitle
  sourceMediaTitle
  requestedLanguageAbbreviations
  options
  status
  currentStep
  retries
  createdAt
  updatedAt
  startedAt
  completedAt
  artifacts
  steps {
    name
    status
    retries
    startedAt
    finishedAt
    error
    details
  }
  errors
`

const SEO_PROPOSAL_SELECTION = `
  id
  version
  payloadDigest
  status
  lane
  targetType
  targetId
  canonicalUrl
  locale
  intent
  expectedOutcome
  risk
  verificationPlan
  rollbackPlan
  editorialDiff
  engineeringBrief
  evidence
  caveats
  overlapCount
  expiresAt
  createdAt
  decision {
    id
    action
    actorId
    overlapAcknowledged
    overlapCount
    reason
    decidedAt
  }
  materialization {
    status
    draftRevisionId
    editorPath
    ticketOutboxId
  }
`

const MANAGER_SEO_RUNS_OPERATION = adminGraphql(`
  query ManagerSeoRuns($limit: Int, $after: String) {
    managerSeoRuns(limit: $limit, after: $after) {
      generatedAt
      items {
        id
        mode
        status
        startedAt
        completedAt
        eligibleCount
        selectedCount
        wouldProposeCount
        proposedCount
        materializationCount
        ticketCount
        experimentCount
        suppressedOperations
        providerCoverage
        reportAvailability
        reclaimed
      }
      hasNextPage
      nextCursor
    }
  }
`)

const MANAGER_SEO_RUN_OPERATION = adminGraphql(`
  query ManagerSeoRun($id: ID!) {
    managerSeoRun(id: $id) {
      id
      mode
      status
      startedAt
      completedAt
      eligibleCount
      selectedCount
      wouldProposeCount
      proposedCount
      materializationCount
      ticketCount
      experimentCount
      suppressedOperations
      providerCoverage
      reportAvailability
      reclaimed
      report {
        __typename
        ... on ManagerSeoRunReportAvailable {
          schemaVersion
          detailState
          selectionPolicyId
          generatedAt
          eligibleCount
          observedCount
          selectedCount
          wouldProposeCount
          persistedProposalCount
          providerCoverage { provider status }
          suppressedOperations
          skippedTargetIds
          omittedSkippedTargetCount
          gscRequests {
            propertyId
            startDate
            endDate
            dimensions
            searchType
            dataState
            filters { dimension operator expression }
            omittedFilterCount
            timezone
            configuredRowCap
            returnedRowCount
            pageCount
            requestCount
            capReached
            responseAggregationType
            firstIncompleteDate
            status
            caveats
            omittedCaveatCount
          }
          omittedGscRequestCount
          queryFunnel {
            providerRows
            malformedRows
            unmatchedTargetRows
            belowImpressionThresholdRows
            ctrThresholdNotMetRows
            rankedRows
            selectedQueryRows
            rejectedQueryRows
          }
          queryDecisions {
            observationId
            targetId
            locale
            query
            canonicalUrl
            clicks
            impressions
            ctr
            position
            score
            selectionOutcome
            reason
          }
          omittedQueryDecisionCount
          proposalRefs {
            proposalId
            payloadDigest
            disposition
            version
            originatingRunId
          }
        }
        ... on ManagerSeoRunReportUnavailable {
          schemaVersion
          detailState
          selectionPolicyId
          eligibleCount
          observedCount
          selectedCount
          wouldProposeCount
          persistedProposalCount
          providerCoverage { provider status }
          suppressedOperations
          proposalRefs {
            proposalId
            payloadDigest
            disposition
            version
            originatingRunId
          }
        }
        ... on ManagerSeoRunReportCompacted {
          schemaVersion
          detailState
          selectionPolicyId
          eligibleCount
          selectedCount
          wouldProposeCount
          persistedProposalCount
          providerCoverage { provider status }
          suppressedOperations
          proposalRefs {
            proposalId
            payloadDigest
            disposition
            version
            originatingRunId
          }
          detailExpiresAt
          compactedAt
        }
      }
      proposalOutcomes {
        proposalId
        version
        payloadDigest
        originatingRunId
        proposalStatus
        humanDecision { action actorId reason decidedAt }
        materializationStatus
        experiment {
          id
          status
          latestEvaluation { kind outcome observedAt }
        }
      }
    }
  }
`)

const SEO_EXPERIMENT_SELECTION = `
  id
  proposalId
  proposalVersion
  status
  canonicalUrl
  locale
  lane
  activatedAt
  observedActivationHash
  measurementStartsAt
  interimDueAt
  finalDueAt
  confounders
  evaluations {
    id
    kind
    outcome
    metrics
    evidenceDigest
    confounders
    observedAt
  }
`

const SEO_LESSON_SELECTION = `
  id
  experimentId
  proposalId
  proposalVersion
  status
  content
  evidenceDigest
  metrics
  confounders
  reviewedById
  reviewedAt
  createdAt
`

const SEO_RECONCILIATION_SELECTION = `
  outboxId
  proposalId
  proposalVersion
  status
  payloadDigest
  marker
  attemptCount
  lastErrorCode
  remoteId
  remoteUrl
  attempts
  candidateTickets
`

const SEO_DECISION_RESULT_SELECTION = `
  status
  proposalId
  version
  decisionId
  draftRevisionId
  editorPath
  ticketOutboxId
  message
`

const jobStatusSchema = z.enum(["pending", "running", "completed", "failed"])
const stepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
])
const workflowStepSchema = z.enum(WORKFLOW_STEP_NAMES)

const optionalStringFromNullable = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined)

const jobRecordSchema: z.ZodType<JobRecord> = z.object({
  id: z.string(),
  muxAssetId: z.string(),
  muxPlaybackId: z.string(),
  videoDocumentId: optionalStringFromNullable,
  languages: z.array(z.string()),
  sourceLanguageId: optionalStringFromNullable,
  sourceLanguageCode: optionalStringFromNullable,
  sourceSelectionReason: optionalStringFromNullable,
  primaryRequestedTargetLanguageCode: optionalStringFromNullable,
  resolvedTargetLanguageCodes: z.array(z.string()).optional(),
  sourceCollectionTitle: optionalStringFromNullable,
  sourceMediaTitle: optionalStringFromNullable,
  requestedLanguageAbbreviations: z.array(z.string()).optional(),
  options: z.record(z.string(), z.unknown()) as z.ZodType<JobRecord["options"]>,
  status: jobStatusSchema as z.ZodType<JobStatus>,
  currentStep: workflowStepSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined) as z.ZodType<
    WorkflowStepName | undefined
  >,
  retries: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: optionalStringFromNullable,
  completedAt: optionalStringFromNullable,
  artifacts: z.record(z.string(), z.unknown()) as z.ZodType<
    JobRecord["artifacts"]
  >,
  steps: z.array(
    z.object({
      name: workflowStepSchema as z.ZodType<WorkflowStepName>,
      status: stepStatusSchema as z.ZodType<StepStatus>,
      retries: z.number(),
      startedAt: optionalStringFromNullable,
      finishedAt: optionalStringFromNullable,
      error: optionalStringFromNullable,
      details: z.unknown().optional() as z.ZodType<JobStepDetails | undefined>,
    }),
  ),
  errors: z.array(z.unknown()) as z.ZodType<JobRecord["errors"]>,
})

function parseJobRecord(value: unknown, fieldName: string): JobRecord {
  const parsed = jobRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `Admin ${fieldName} returned invalid Manager job payload: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

function parseJobRecordList(value: unknown, fieldName: string): JobRecord[] {
  const parsed = z.array(jobRecordSchema).safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `Admin ${fieldName} returned invalid Manager job list payload: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

function readField<T>(
  data: Record<string, unknown> | undefined,
  fieldName: string,
): T | null {
  const value = data?.[fieldName]
  return value == null ? null : (value as T)
}

export class AdminGraphqlClient {
  private readonly graphqlUrl: string
  private readonly apiKey?: string
  private readonly fetchImpl: FetchLike

  constructor(options: AdminGraphqlClientOptions) {
    this.graphqlUrl = options.graphqlUrl
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await this.fetchImpl(this.graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`Admin GraphQL returned ${response.status}`)
    }

    const payload = (await response.json()) as GraphqlResponse<T>
    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) => error.message)
          .filter((message): message is string => Boolean(message))
          .join("; ") || "Admin GraphQL error",
      )
    }

    if (!payload.data) {
      throw new Error("Admin GraphQL response did not include data")
    }

    return payload.data
  }

  async getSeoWorkspace(limit = 50): Promise<SeoWorkspace> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerSeoWorkspace($limit: Int) {
          managerSeoWorkspace(limit: $limit) {
            generatedAt
            proposals { ${SEO_PROPOSAL_SELECTION} }
            experiments { ${SEO_EXPERIMENT_SELECTION} }
            lessons { ${SEO_LESSON_SELECTION} }
            ticketReconciliations { ${SEO_RECONCILIATION_SELECTION} }
          }
        }
      `,
      { limit },
    )

    const workspace = readField<unknown>(data, "managerSeoWorkspace")
    const parsed = seoWorkspaceSchema.safeParse(workspace)
    if (!parsed.success) {
      throw new Error(
        `Admin managerSeoWorkspace returned invalid SEO workspace payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async getSeoRuns(limit = 25, after?: string): Promise<SeoRunPage> {
    const data = await this.request<
      AdminResultOf<typeof MANAGER_SEO_RUNS_OPERATION>
    >(print(MANAGER_SEO_RUNS_OPERATION), { limit, after })
    const parsed = seoRunPageSchema.safeParse(
      readField<unknown>(data, "managerSeoRuns"),
    )
    if (!parsed.success) {
      throw new Error(
        `Admin managerSeoRuns returned invalid SEO run payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async getSeoRun(id: string): Promise<SeoRunDetail | null> {
    const data = await this.request<
      AdminResultOf<typeof MANAGER_SEO_RUN_OPERATION>
    >(print(MANAGER_SEO_RUN_OPERATION), { id })
    const value = readField<unknown>(data, "managerSeoRun")
    if (value == null) return null
    const parsed = seoRunDetailSchema.safeParse(value)
    if (!parsed.success) {
      throw new Error(
        `Admin managerSeoRun returned invalid SEO run detail: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async getSeoProposal(id: string): Promise<SeoProposal | null> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerSeoProposal($id: ID!) {
          managerSeoProposal(id: $id) { ${SEO_PROPOSAL_SELECTION} }
        }
      `,
      { id },
    )
    const proposal = readField<unknown>(data, "managerSeoProposal")
    if (!proposal) return null
    const parsed = seoProposalSchema.safeParse(proposal)
    if (!parsed.success) {
      throw new Error(
        `Admin managerSeoProposal returned invalid SEO proposal payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async approveSeoProposal(
    input: AdminSeoProposalDecisionInput,
  ): Promise<SeoProposalDecisionResult> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation ApproveManagerSeoProposal($input: ManagerSeoApproveInput!) {
          approveManagerSeoProposal(input: $input) { ${SEO_DECISION_RESULT_SELECTION} }
        }
      `,
      { input },
    )
    return this.parseSeoDecisionResult(data, "approveManagerSeoProposal")
  }

  async rejectSeoProposal(
    input: AdminSeoProposalRejectInput,
  ): Promise<SeoProposalDecisionResult> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation RejectManagerSeoProposal($input: ManagerSeoRejectInput!) {
          rejectManagerSeoProposal(input: $input) { ${SEO_DECISION_RESULT_SELECTION} }
        }
      `,
      { input },
    )
    return this.parseSeoDecisionResult(data, "rejectManagerSeoProposal")
  }

  async reviewSeoLesson(input: AdminSeoLessonReviewInput): Promise<SeoLesson> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation ReviewManagerSeoLesson($input: ManagerSeoLessonReviewInput!) {
          reviewManagerSeoLesson(input: $input) { ${SEO_LESSON_SELECTION} }
        }
      `,
      { input },
    )
    const lesson = readField<unknown>(data, "reviewManagerSeoLesson")
    const parsed = seoLessonSchema.safeParse(lesson)
    if (!parsed.success) {
      throw new Error(
        `Admin reviewManagerSeoLesson returned invalid SEO lesson payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async reconcileSeoTicket(
    input: AdminSeoTicketReconcileInput,
  ): Promise<SeoTicketReconciliation> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation ReconcileManagerSeoTicket($input: ManagerSeoTicketReconcileInput!) {
          reconcileManagerSeoTicket(input: $input) { ${SEO_RECONCILIATION_SELECTION} }
        }
      `,
      { input },
    )
    const reconciliation = readField<unknown>(data, "reconcileManagerSeoTicket")
    const parsed = seoTicketReconciliationSchema.safeParse(reconciliation)
    if (!parsed.success) {
      throw new Error(
        `Admin reconcileManagerSeoTicket returned invalid SEO reconciliation payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  private parseSeoDecisionResult(
    data: Record<string, unknown>,
    fieldName: string,
  ): SeoProposalDecisionResult {
    const parsed = seoProposalDecisionResultSchema.safeParse(
      readField<unknown>(data, fieldName),
    )
    if (!parsed.success) {
      throw new Error(
        `Admin ${fieldName} returned invalid SEO decision payload: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }

  async getLanguageGeo(): Promise<MockLanguageGeo> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerLanguageGeo {
          managerLanguageGeo { ${LANGUAGE_GEO_SELECTION} }
        }
      `,
    )

    const geo = readField<MockLanguageGeo>(data, "managerLanguageGeo")
    if (!geo) {
      throw new Error("Admin managerLanguageGeo returned empty data")
    }
    return geo
  }

  async getVideoCoverage(
    languageIds: string[] = [],
  ): Promise<MockVideoCoverage[]> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerVideoCoverage($languageIds: [String!]) {
          managerVideoCoverage(languageIds: $languageIds) { ${VIDEO_COVERAGE_SELECTION} }
        }
      `,
      { languageIds },
    )

    return readField<MockVideoCoverage[]>(data, "managerVideoCoverage") ?? []
  }

  async getVideosForEnrichment(
    ids: string[] = [],
  ): Promise<AdminVideoForEnrichment[]> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerVideosForEnrichment($ids: [String!]!) {
          managerVideosForEnrichment(ids: $ids) { ${VIDEO_ENRICHMENT_SELECTION} }
        }
      `,
      { ids },
    )

    return (
      readField<AdminVideoForEnrichment[]>(
        data,
        "managerVideosForEnrichment",
      ) ?? []
    )
  }

  async getCoverageSnapshots(
    query?: CoverageSnapshotQuery,
  ): Promise<MockCoverageSnapshot[]> {
    const variables =
      query && "latest" in query
        ? { latest: true }
        : query
          ? { startDate: query.startDate, endDate: query.endDate }
          : {}
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerCoverageSnapshots(
          $latest: Boolean
          $startDate: String
          $endDate: String
        ) {
          managerCoverageSnapshots(
            latest: $latest
            startDate: $startDate
            endDate: $endDate
          ) { ${COVERAGE_SNAPSHOT_SELECTION} }
        }
      `,
      variables,
    )

    return (
      readField<MockCoverageSnapshot[]>(data, "managerCoverageSnapshots") ?? []
    )
  }

  async createJob(input: CreateAdminJobInput): Promise<JobRecord> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation CreateManagerJob(
          $muxAssetId: String!
          $muxPlaybackId: String
          $videoDocumentId: String
          $languages: [String!]
          $sourceLanguageId: String
          $sourceLanguageCode: String
          $sourceSelectionReason: String
          $primaryRequestedTargetLanguageCode: String
          $resolvedTargetLanguageCodes: [String!]
          $sourceCollectionTitle: String
          $sourceMediaTitle: String
          $requestedLanguageAbbreviations: [String!]
          $options: JSON
          $artifacts: JSON
          $steps: [ManagerJobStepInput!]
          $errors: JSON
        ) {
          createManagerJob(
            muxAssetId: $muxAssetId
            muxPlaybackId: $muxPlaybackId
            videoDocumentId: $videoDocumentId
            languages: $languages
            sourceLanguageId: $sourceLanguageId
            sourceLanguageCode: $sourceLanguageCode
            sourceSelectionReason: $sourceSelectionReason
            primaryRequestedTargetLanguageCode: $primaryRequestedTargetLanguageCode
            resolvedTargetLanguageCodes: $resolvedTargetLanguageCodes
            sourceCollectionTitle: $sourceCollectionTitle
            sourceMediaTitle: $sourceMediaTitle
            requestedLanguageAbbreviations: $requestedLanguageAbbreviations
            options: $options
            artifacts: $artifacts
            steps: $steps
            errors: $errors
          ) { ${JOB_SELECTION} }
        }
      `,
      input as Record<string, unknown>,
    )

    const job = readField<unknown>(data, "createManagerJob")
    if (!job) throw new Error("Admin createManagerJob returned empty data")
    return parseJobRecord(job, "createManagerJob")
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerJob($id: ID!) {
          managerJob(id: $id) { ${JOB_SELECTION} }
        }
      `,
      { id },
    )

    const job = readField<unknown>(data, "managerJob")
    return job ? parseJobRecord(job, "managerJob") : null
  }

  async listJobs({
    limit = 100,
    offset = 0,
  }: {
    limit?: number
    offset?: number
  } = {}): Promise<JobRecord[]> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerJobs($limit: Int, $offset: Int) {
          managerJobs(limit: $limit, offset: $offset) { ${JOB_SELECTION} }
        }
      `,
      { limit, offset },
    )

    return parseJobRecordList(
      readField<unknown[]>(data, "managerJobs") ?? [],
      "managerJobs",
    )
  }

  async countJobs(): Promise<number> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerJobsTotal {
          managerJobsTotal
        }
      `,
    )

    const total = readField<number>(data, "managerJobsTotal")
    if (typeof total !== "number") {
      throw new Error("Admin managerJobsTotal returned invalid data")
    }
    return total
  }

  async updateJob(
    id: string,
    updates: UpdateAdminJobInput,
  ): Promise<JobRecord | null> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation UpdateManagerJob(
          $id: ID!
          $status: ManagerJobStatus
          $currentStep: String
          $retries: Int
          $startedAt: String
          $completedAt: String
          $artifacts: JSON
          $sourceLanguageId: String
          $sourceLanguageCode: String
          $sourceSelectionReason: String
          $primaryRequestedTargetLanguageCode: String
          $resolvedTargetLanguageCodes: [String!]
          $sourceCollectionTitle: String
          $sourceMediaTitle: String
          $requestedLanguageAbbreviations: [String!]
          $steps: [ManagerJobStepInput!]
          $errors: JSON
          $options: JSON
        ) {
          updateManagerJob(
            id: $id
            status: $status
            currentStep: $currentStep
            retries: $retries
            startedAt: $startedAt
            completedAt: $completedAt
            artifacts: $artifacts
            sourceLanguageId: $sourceLanguageId
            sourceLanguageCode: $sourceLanguageCode
            sourceSelectionReason: $sourceSelectionReason
            primaryRequestedTargetLanguageCode: $primaryRequestedTargetLanguageCode
            resolvedTargetLanguageCodes: $resolvedTargetLanguageCodes
            sourceCollectionTitle: $sourceCollectionTitle
            sourceMediaTitle: $sourceMediaTitle
            requestedLanguageAbbreviations: $requestedLanguageAbbreviations
            steps: $steps
            errors: $errors
            options: $options
          ) { ${JOB_SELECTION} }
        }
      `,
      {
        id,
        ...updates,
      } as Record<string, unknown>,
    )

    const job = readField<unknown>(data, "updateManagerJob")
    return job ? parseJobRecord(job, "updateManagerJob") : null
  }
}
