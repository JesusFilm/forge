import type {
  MockCoverageSnapshot,
  MockLanguageGeo,
  MockVideoCoverage,
} from "@/cms/mock-seed"
import type { JobRecord } from "@/types/job"

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

const VIDEO_COVERAGE_SELECTION = `
  documentId
  coreId
  title
  label
  slug
  aiMetadata
  imageUrl
  parentDocumentIds
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
    englishLabel
    nativeLabel
    countryIds
    continentIds
    countrySpeakers
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

  async createJob(input: {
    muxAssetId: string
    muxPlaybackId: string
    videoDocumentId?: string
    languages: string[]
    options?: unknown
    steps?: JobRecord["steps"]
  }): Promise<JobRecord> {
    const data = await this.request<Record<string, unknown>>(
      `
        mutation CreateManagerJob(
          $muxAssetId: String!
          $muxPlaybackId: String
          $videoDocumentId: String
          $languages: [String!]
          $options: JSON
          $steps: [ManagerJobStepInput!]
        ) {
          createManagerJob(
            muxAssetId: $muxAssetId
            muxPlaybackId: $muxPlaybackId
            videoDocumentId: $videoDocumentId
            languages: $languages
            options: $options
            steps: $steps
          ) { ${JOB_SELECTION} }
        }
      `,
      input as Record<string, unknown>,
    )

    const job = readField<JobRecord>(data, "createManagerJob")
    if (!job) throw new Error("Admin createManagerJob returned empty data")
    return job
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

    return readField<JobRecord>(data, "managerJob")
  }

  async listJobs(limit = 100): Promise<JobRecord[]> {
    const data = await this.request<Record<string, unknown>>(
      `
        query ManagerJobs($limit: Int) {
          managerJobs(limit: $limit) { ${JOB_SELECTION} }
        }
      `,
      { limit },
    )

    return readField<JobRecord[]>(data, "managerJobs") ?? []
  }

  async updateJob(
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

    return readField<JobRecord>(data, "updateManagerJob")
  }
}
