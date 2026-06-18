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
