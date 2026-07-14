import { scryptSync, timingSafeEqual } from "node:crypto"
import type { EnrichmentAutomation } from "@/features/agents/automation-contract"
import type { JobRecord } from "@/types/job"

export type ManagerUserRole = {
  name: string
  type: string
}

export type ManagerUser = {
  id: number
  username: string
  email: string
  role: ManagerUserRole
}

export type ManagerSession = {
  token: string
  user: ManagerUser
}

export type MockManagerUserRecord = ManagerUser & {
  passwordHash: string
}

export type MockLanguageGeo = {
  continents: Array<{ id: string; name: string }>
  countries: Array<{ id: string; name: string; continentId: string }>
  languages: Array<{
    id: string
    coreId?: string | null
    englishLabel: string
    nativeLabel: string
    bcp47?: string | null
    iso3?: string | null
    countryIds: string[]
    continentIds: string[]
    countrySpeakers: Record<string, number>
  }>
}

export type MockCoverageCounts = {
  human: number
  ai: number
}

export type MockCoverageStatus = "human" | "ai" | "none"

export type MockVideoCoverageByLanguage = {
  subtitles: MockCoverageStatus
  audio: MockCoverageStatus
  meta: MockCoverageStatus
}

export type MockVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  imageUrl: string | null
  parentDocumentIds: string[]
  parentRelations?: Array<{ parentDocumentId: string; order: number | null }>
  coverage: {
    subtitles: MockCoverageCounts
    audio: MockCoverageCounts
  }
  languageCoverage?: Record<string, MockVideoCoverageByLanguage>
}

export type MockCoverageSnapshot = {
  documentId: string
  date: string
  computedAt: string
  totalVideos: number
  videosWithAiMetadata: number
  videosWithHumanMetadata: number
  subtitlesHumanTotal: number
  subtitlesAiTotal: number
  audioHumanTotal: number
  audioAiTotal: number
  languageCoverage: Array<{
    languageId: string
    languageName: string
    subtitleHumanCount: number
    subtitleAiCount: number
    audioHumanCount: number
    audioAiCount: number
    metadataHumanCount: number
    metadataAiCount: number
  }>
}

export type MockVideoReviewTextTrack = {
  languageCode: string
  label: string
  src: string
  source: "cms" | "mux" | "artifact"
  isGenerated: boolean
}

export type MockVideoReviewSource = {
  title?: string
  description?: string
  language?: string
  subtitles: MockVideoReviewTextTrack[]
}

export type MockArtifactFile = {
  assetId: string
  artifactType: string
  ext: "json" | "vtt"
  body: string
}

export type MockCmsReadModels = {
  languageGeo: MockLanguageGeo
  videoCoverage: MockVideoCoverage[]
  coverageSnapshots: MockCoverageSnapshot[]
  jobs: JobRecord[]
  automations: EnrichmentAutomation[]
  reviewSources: Record<string, MockVideoReviewSource>
}

export type MockCmsState = {
  users: MockManagerUserRecord[]
  readModels: MockCmsReadModels
}

export type MockCmsSeed = MockCmsState

const MOCK_PASSWORD_PREFIX = "scrypt"
const DEFAULT_PASSWORD_SALT = "forge-manager-mock-cms"

export const DEFAULT_MOCK_MANAGER_CREDENTIALS = {
  email: "manager@forge.test",
  password: "mock-manager-password",
} as const

export function hashMockPassword(
  password: string,
  salt = DEFAULT_PASSWORD_SALT,
): string {
  const derived = scryptSync(password, salt, 64)
  return `${MOCK_PASSWORD_PREFIX}:${salt}:${derived.toString("hex")}`
}

export function verifyMockPassword(
  password: string,
  storedHash: string,
): boolean {
  const [prefix, salt, expectedHex] = storedHash.split(":")
  if (
    prefix !== MOCK_PASSWORD_PREFIX ||
    typeof salt !== "string" ||
    salt.length === 0 ||
    typeof expectedHex !== "string" ||
    expectedHex.length === 0
  ) {
    return false
  }

  const expected = Buffer.from(expectedHex, "hex")
  const actual = Buffer.from(scryptSync(password, salt, expected.length))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function cloneMockCmsSeed<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

const DEFAULT_MANAGER_USER: MockManagerUserRecord = {
  id: 1,
  username: "manager",
  email: DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
  passwordHash: hashMockPassword(DEFAULT_MOCK_MANAGER_CREDENTIALS.password),
  role: {
    name: "Manager",
    type: "manager",
  },
}

const DEFAULT_MOCK_JOBS: JobRecord[] = [
  {
    id: "mock-smart-crop-1",
    muxAssetId: "mock_smart_crop_asset",
    muxPlaybackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
    videoDocumentId: "video-doc-standalone-1",
    languages: ["529"],
    sourceLanguageId: "529",
    sourceLanguageCode: "en",
    primaryRequestedTargetLanguageCode: "en",
    resolvedTargetLanguageCodes: ["en"],
    sourceMediaTitle: "A New Beginning",
    options: {
      smartCrop: {
        kind: "canonical",
        assetId: "mock_smart_crop_asset",
        targetAspectRatio: "9:16",
        cropMode: "auto",
      },
    },
    status: "completed",
    currentStep: "smart_crop_mux_output",
    retries: 0,
    createdAt: "2026-04-22T16:00:00.000Z",
    updatedAt: "2026-04-22T16:12:00.000Z",
    startedAt: "2026-04-22T16:00:10.000Z",
    completedAt: "2026-04-22T16:12:00.000Z",
    artifacts: {
      smartCrop: {
        kind: "metadata",
        data: {
          domain: "smart_crop",
          kind: "canonical",
          phase: "completed",
          plan: { segmentCount: 3, approved: true },
          qa: { verdict: "pass" },
          usage: { inputTokens: 1000, outputTokens: 240 },
        },
      },
      "smart-crop-plan": { kind: "downloadable" },
      "smart-crop-attempts": { kind: "downloadable" },
      "smart-crop-plan-attempt-000": { kind: "downloadable" },
      "smart-crop-plan-attempt-001": { kind: "downloadable" },
      "smart-crop-qa-attempt-000": { kind: "downloadable" },
      "smart-crop-qa-attempt-001": { kind: "downloadable" },
    },
    steps: [
      {
        name: "smart_crop_fingerprint",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T16:00:10.000Z",
        finishedAt: "2026-04-22T16:02:00.000Z",
      },
      {
        name: "smart_crop_plan",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T16:02:00.000Z",
        finishedAt: "2026-04-22T16:05:00.000Z",
      },
      {
        name: "smart_crop_preview_render",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T16:05:00.000Z",
        finishedAt: "2026-04-22T16:10:00.000Z",
      },
      {
        name: "smart_crop_qa",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T16:10:00.000Z",
        finishedAt: "2026-04-22T16:11:00.000Z",
      },
      {
        name: "smart_crop_mux_output",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T16:11:00.000Z",
        finishedAt: "2026-04-22T16:12:00.000Z",
      },
    ],
    errors: [],
  },
  {
    id: "mock-job-2",
    muxAssetId: "mock_asset_2",
    muxPlaybackId: "mockplayback2",
    videoDocumentId: "video-doc-standalone-1",
    languages: ["21028"],
    sourceLanguageId: "529",
    sourceLanguageCode: "en",
    primaryRequestedTargetLanguageCode: "es",
    resolvedTargetLanguageCodes: ["es"],
    sourceMediaTitle: "A New Beginning",
    options: {},
    status: "running",
    currentStep: "metadata",
    retries: 0,
    createdAt: "2026-04-22T15:10:00.000Z",
    updatedAt: "2026-04-22T15:17:00.000Z",
    startedAt: "2026-04-22T15:10:20.000Z",
    artifacts: {},
    steps: [
      {
        name: "transcription",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T15:10:20.000Z",
        finishedAt: "2026-04-22T15:12:00.000Z",
      },
      {
        name: "translation",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T15:12:00.000Z",
        finishedAt: "2026-04-22T15:15:00.000Z",
        details: {
          languageResults: [{ lang: "es", status: "completed" }],
        },
      },
      {
        name: "metadata",
        status: "running",
        retries: 0,
        startedAt: "2026-04-22T15:15:00.000Z",
      },
    ],
    errors: [],
  },
  {
    id: "mock-job-1",
    muxAssetId: "mock_asset_1",
    muxPlaybackId: "mockplayback1",
    videoDocumentId: "video-doc-episode-1",
    languages: ["6414"],
    sourceLanguageId: "529",
    sourceLanguageCode: "en",
    primaryRequestedTargetLanguageCode: "fr",
    resolvedTargetLanguageCodes: ["fr"],
    sourceCollectionTitle: "Hope Stories",
    sourceMediaTitle: "Episode 1",
    options: {},
    status: "completed",
    currentStep: "artifact_upload",
    retries: 0,
    createdAt: "2026-04-22T13:40:00.000Z",
    updatedAt: "2026-04-22T13:52:00.000Z",
    startedAt: "2026-04-22T13:40:10.000Z",
    completedAt: "2026-04-22T13:52:00.000Z",
    artifacts: {
      transcriptionRouting: {
        kind: "metadata",
        data: {
          attempts: [],
          finalProvider: "mux",
          finalSourceLanguageCode: "en",
        },
      },
      subtitles: { kind: "downloadable" },
      "subtitles-fr": { kind: "downloadable" },
      metadata: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      "chapters-vtt": { kind: "downloadable" },
    },
    steps: [
      {
        name: "transcription",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T13:40:10.000Z",
        finishedAt: "2026-04-22T13:43:00.000Z",
      },
      {
        name: "translation",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T13:43:00.000Z",
        finishedAt: "2026-04-22T13:47:00.000Z",
        details: {
          languageResults: [{ lang: "fr", status: "completed" }],
        },
      },
      {
        name: "chapters",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T13:47:00.000Z",
        finishedAt: "2026-04-22T13:49:00.000Z",
      },
      {
        name: "metadata",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T13:49:00.000Z",
        finishedAt: "2026-04-22T13:50:00.000Z",
      },
      {
        name: "artifact_upload",
        status: "completed",
        retries: 0,
        startedAt: "2026-04-22T13:50:00.000Z",
        finishedAt: "2026-04-22T13:52:00.000Z",
      },
    ],
    errors: [],
  },
]

const DEFAULT_MOCK_AUTOMATIONS: EnrichmentAutomation[] = [
  {
    documentId: "mock-automation-1",
    name: "Metadata Gap Sweep",
    template: "metadata_missing",
    status: "active",
    runMode: "dry_run",
    schedule: { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
    scheduleSummary: "Daily at 09:00 UTC",
    timezone: "UTC",
    nextRunAt: "2026-04-23T09:00:00.000Z",
    lastRunAt: "2026-04-22T09:00:00.000Z",
    lastRunStatus: "success",
    refreshMode: "missing_only",
    targetLanguageIds: [],
    maxVideosPerRun: 5,
    leaseToken: null,
    leaseExpiresAt: null,
    runs: [
      {
        documentId: "mock-automation-run-1",
        status: "success",
        runMode: "dry_run",
        scheduledFor: "2026-04-22T09:00:00.000Z",
        startedAt: "2026-04-22T09:00:00.000Z",
        finishedAt: "2026-04-22T09:01:00.000Z",
        eligibleCount: 2,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        summary: "Dry run would enqueue 2 videos.",
        report: {
          kind: "metadata",
          data: {
            runMode: "dry_run",
            automationDocumentId: "mock-automation-1",
            automationRunDocumentId: "mock-automation-run-1",
            template: "metadata_missing",
            refreshMode: "missing_only",
            targetLanguageIds: [],
            maxVideosPerRun: 5,
            eligibleCount: 2,
            skippedDuplicateCount: 0,
            wouldEnqueueCount: 2,
            selectedCandidates: [
              {
                videoDocumentId: "video-doc-episode-2",
                coreId: "ep-2",
                outputOwner: "missing",
                automationKey: "metadata_missing",
              },
            ],
            suppressedOperations: [
              "cmsPost(/enrichment-job/internal-create)",
              "runVideoEnrichment",
            ],
            summary: "Dry run would enqueue 2 videos.",
            generatedAt: "2026-04-22T09:01:00.000Z",
          },
        },
      },
    ],
  },
  {
    documentId: "mock-automation-2",
    name: "Spanish Subtitle Catch-up",
    template: "target_subtitles_missing",
    status: "paused",
    runMode: "live",
    schedule: {
      kind: "weekly",
      weekday: "wed",
      hour: 14,
      minute: 30,
      timezone: "UTC",
    },
    scheduleSummary: "Wednesdays at 14:30 UTC",
    timezone: "UTC",
    nextRunAt: null,
    lastRunAt: "2026-04-20T14:30:00.000Z",
    lastRunStatus: "no_op",
    refreshMode: "missing_only",
    targetLanguageIds: ["21028"],
    maxVideosPerRun: 10,
    leaseToken: null,
    leaseExpiresAt: null,
    runs: [],
  },
]

export const DEFAULT_MOCK_CMS_SEED: MockCmsSeed = {
  users: [DEFAULT_MANAGER_USER],
  readModels: {
    languageGeo: {
      continents: [
        { id: "na", name: "North America" },
        { id: "eu", name: "Europe" },
      ],
      countries: [
        { id: "us", name: "United States", continentId: "na" },
        { id: "mx", name: "Mexico", continentId: "na" },
        { id: "fr", name: "France", continentId: "eu" },
      ],
      languages: [
        {
          id: "529",
          englishLabel: "English",
          nativeLabel: "English",
          bcp47: "en",
          iso3: "eng",
          countryIds: ["us"],
          continentIds: ["na"],
          countrySpeakers: { us: 331000000 },
        },
        {
          id: "21028",
          englishLabel: "Spanish",
          nativeLabel: "Espanol",
          bcp47: "es",
          iso3: "spa",
          countryIds: ["mx", "us"],
          continentIds: ["na"],
          countrySpeakers: { mx: 126000000, us: 42000000 },
        },
        {
          id: "6414",
          englishLabel: "French",
          nativeLabel: "Francais",
          bcp47: "fr",
          iso3: "fra",
          countryIds: ["fr"],
          continentIds: ["eu"],
          countrySpeakers: { fr: 65000000 },
        },
      ],
    },
    videoCoverage: [
      {
        documentId: "video-doc-collection-1",
        coreId: "collection-1",
        title: "Hope Stories",
        label: "series",
        slug: "hope-stories",
        aiMetadata: false,
        imageUrl: "https://images.jesusfilm.org/mock/hope-stories.jpg",
        parentDocumentIds: [],
        parentRelations: [],
        coverage: {
          subtitles: { human: 1, ai: 1 },
          audio: { human: 0, ai: 1 },
        },
        languageCoverage: {
          "529": {
            subtitles: "human",
            audio: "none",
            meta: "human",
          },
          "6414": {
            subtitles: "ai",
            audio: "none",
            meta: "ai",
          },
          "21028": {
            subtitles: "none",
            audio: "ai",
            meta: "none",
          },
        },
      },
      {
        documentId: "video-doc-episode-1",
        coreId: "ep-1",
        title: "Episode 1",
        label: "episode",
        slug: "hope-stories-episode-1",
        aiMetadata: true,
        imageUrl: "https://images.jesusfilm.org/mock/episode-1.jpg",
        parentDocumentIds: ["video-doc-collection-1"],
        parentRelations: [
          { parentDocumentId: "video-doc-collection-1", order: 1 },
        ],
        coverage: {
          subtitles: { human: 1, ai: 1 },
          audio: { human: 0, ai: 1 },
        },
        languageCoverage: {
          "529": {
            subtitles: "human",
            audio: "none",
            meta: "ai",
          },
          "6414": {
            subtitles: "ai",
            audio: "none",
            meta: "ai",
          },
          "21028": {
            subtitles: "none",
            audio: "ai",
            meta: "none",
          },
        },
      },
      {
        documentId: "video-doc-episode-2",
        coreId: "ep-2",
        title: "Episode 2",
        label: "episode",
        slug: "hope-stories-episode-2",
        aiMetadata: null,
        imageUrl: "https://images.jesusfilm.org/mock/episode-2.jpg",
        parentDocumentIds: ["video-doc-collection-1"],
        parentRelations: [
          { parentDocumentId: "video-doc-collection-1", order: 2 },
        ],
        coverage: {
          subtitles: { human: 1, ai: 0 },
          audio: { human: 0, ai: 0 },
        },
        languageCoverage: {
          "529": {
            subtitles: "human",
            audio: "none",
            meta: "none",
          },
          "6414": {
            subtitles: "none",
            audio: "none",
            meta: "none",
          },
          "21028": {
            subtitles: "none",
            audio: "none",
            meta: "none",
          },
        },
      },
      {
        documentId: "video-doc-standalone-1",
        coreId: "standalone-1",
        title: "A New Beginning",
        label: "shortFilm",
        slug: "a-new-beginning",
        aiMetadata: false,
        imageUrl: "https://images.jesusfilm.org/mock/a-new-beginning.jpg",
        parentDocumentIds: [],
        parentRelations: [],
        coverage: {
          subtitles: { human: 1, ai: 1 },
          audio: { human: 1, ai: 0 },
        },
        languageCoverage: {
          "529": {
            subtitles: "human",
            audio: "human",
            meta: "human",
          },
          "6414": {
            subtitles: "none",
            audio: "none",
            meta: "none",
          },
          "21028": {
            subtitles: "ai",
            audio: "none",
            meta: "none",
          },
        },
      },
    ],
    coverageSnapshots: [
      {
        documentId: "snapshot-2026-04-15",
        date: "2026-04-15",
        computedAt: "2026-04-15T12:00:00.000Z",
        totalVideos: 3,
        videosWithAiMetadata: 1,
        videosWithHumanMetadata: 2,
        subtitlesHumanTotal: 2,
        subtitlesAiTotal: 1,
        audioHumanTotal: 1,
        audioAiTotal: 0,
        languageCoverage: [
          {
            languageId: "529",
            languageName: "English",
            subtitleHumanCount: 3,
            subtitleAiCount: 0,
            audioHumanCount: 1,
            audioAiCount: 0,
            metadataHumanCount: 2,
            metadataAiCount: 1,
          },
        ],
      },
      {
        documentId: "snapshot-2026-04-22",
        date: "2026-04-22",
        computedAt: "2026-04-22T12:00:00.000Z",
        totalVideos: 4,
        videosWithAiMetadata: 1,
        videosWithHumanMetadata: 2,
        subtitlesHumanTotal: 3,
        subtitlesAiTotal: 2,
        audioHumanTotal: 1,
        audioAiTotal: 1,
        languageCoverage: [
          {
            languageId: "529",
            languageName: "English",
            subtitleHumanCount: 4,
            subtitleAiCount: 0,
            audioHumanCount: 1,
            audioAiCount: 0,
            metadataHumanCount: 2,
            metadataAiCount: 1,
          },
          {
            languageId: "6414",
            languageName: "French",
            subtitleHumanCount: 0,
            subtitleAiCount: 1,
            audioHumanCount: 0,
            audioAiCount: 0,
            metadataHumanCount: 0,
            metadataAiCount: 1,
          },
          {
            languageId: "21028",
            languageName: "Spanish",
            subtitleHumanCount: 0,
            subtitleAiCount: 1,
            audioHumanCount: 0,
            audioAiCount: 1,
            metadataHumanCount: 0,
            metadataAiCount: 0,
          },
        ],
      },
    ],
    jobs: DEFAULT_MOCK_JOBS,
    automations: DEFAULT_MOCK_AUTOMATIONS,
    reviewSources: {
      "video-doc-episode-1": {
        title: "Episode 1",
        description: "A mock review source for the first episode.",
        language: "English",
        subtitles: [
          {
            languageCode: "en",
            label: "English",
            src: "https://media.jesusfilm.org/subtitles/mock-episode-1-en.vtt",
            source: "cms",
            isGenerated: false,
          },
        ],
      },
      "video-doc-standalone-1": {
        title: "A New Beginning",
        description: "A standalone mock review source.",
        language: "English",
        subtitles: [
          {
            languageCode: "en",
            label: "English",
            src: "https://media.jesusfilm.org/subtitles/mock-standalone-en.vtt",
            source: "cms",
            isGenerated: false,
          },
        ],
      },
    },
  },
}

export const DEFAULT_MOCK_ARTIFACT_FILES: MockArtifactFile[] = [
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-plan-9x16-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-canonical-plan",
        assetId: "mock_smart_crop_asset",
        muxAssetId: "mock_smart_crop_asset",
        playbackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
        source: { width: 1920, height: 1080, durationSeconds: 60 },
        target: { aspectRatio: "9:16", width: 1080, height: 1920 },
        strategy: {
          cropMode: "auto",
          plannerVersion: "smart-crop-planner-v1",
          model: "mock-model",
        },
        segments: [
          {
            shotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 18,
            mode: "speaker",
            primarySubject: "Narrator",
            secondarySubjects: [],
            avoidCutting: ["face"],
            confidence: 0.92,
            cropKeyframes: [
              { progress: 0, x: 240, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 320, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00002",
            canonicalStart: 18,
            canonicalEnd: 42,
            mode: "group",
            primarySubject: "Two people",
            secondarySubjects: ["background group"],
            avoidCutting: ["faces"],
            confidence: 0.86,
            cropKeyframes: [
              { progress: 0, x: 560, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 760, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00003",
            canonicalStart: 42,
            canonicalEnd: 60,
            mode: "slide_aware",
            primarySubject: "Title card",
            secondarySubjects: [],
            avoidCutting: ["on-screen text"],
            confidence: 0.78,
            cropKeyframes: [
              { progress: 0, x: 656, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 656, y: 0, width: 606, height: 1080 },
            ],
          },
        ],
        usage: { inputTokens: 1000, outputTokens: 240 },
        qa: {
          status: "approved",
          approvedBy: "mock-manager",
          approvedAt: "2026-04-22T16:06:00.000Z",
        },
        generatedAt: "2026-04-22T16:05:00.000Z",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-plan-9x16-attempt-000-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-canonical-plan",
        assetId: "mock_smart_crop_asset",
        muxAssetId: "mock_smart_crop_asset",
        playbackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
        source: { width: 1920, height: 1080, durationSeconds: 60 },
        target: { aspectRatio: "9:16", width: 1080, height: 1920 },
        strategy: {
          cropMode: "auto",
          plannerVersion: "smart-crop-planner-v1",
          model: "mock-model",
        },
        segments: [
          {
            shotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 18,
            mode: "speaker",
            primarySubject: "Narrator",
            secondarySubjects: [],
            avoidCutting: ["face"],
            confidence: 0.92,
            cropKeyframes: [
              { progress: 0, x: 240, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 320, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00002",
            canonicalStart: 18,
            canonicalEnd: 42,
            mode: "group",
            primarySubject: "Two people",
            secondarySubjects: ["background group"],
            avoidCutting: ["faces"],
            confidence: 0.86,
            cropKeyframes: [
              { progress: 0, x: 560, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 760, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00003",
            canonicalStart: 42,
            canonicalEnd: 60,
            mode: "slide_aware",
            primarySubject: "Title card",
            secondarySubjects: [],
            avoidCutting: ["on-screen text"],
            confidence: 0.78,
            cropKeyframes: [
              { progress: 0, x: 656, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 656, y: 0, width: 606, height: 1080 },
            ],
          },
        ],
        usage: { inputTokens: 1000, outputTokens: 240 },
        qa: {
          status: "approved",
          approvedBy: "mock-manager",
          approvedAt: "2026-04-22T16:06:00.000Z",
        },
        generatedAt: "2026-04-22T16:05:00.000Z",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-attempts-9x16-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-attempts",
        assetId: "mock_smart_crop_asset",
        maxRepairAttempts: 2,
        selectedAttemptIndex: 1,
        attempts: [
          {
            attemptIndex: 0,
            suffix: "attempt-000",
            planLogicalKey: "smart-crop-plan-attempt-000",
            planArtifactType: "smart-crop-plan-9x16-attempt-000-v1",
            previewLogicalKey: "smart-crop-preview-attempt-000",
            previewArtifactType: "smart-crop-preview-9x16-attempt-000",
            renderReportLogicalKey:
              "smart-crop-render-report-preview-attempt-000",
            renderReportArtifactType:
              "smart-crop-render-report-9x16-preview-attempt-000",
            qaLogicalKey: "smart-crop-qa-attempt-000",
            qaArtifactType: "smart-crop-qa-9x16-attempt-000-v1",
            previewFrameLogicalKeyPattern:
              "smart-crop-preview-frame-9x16-{NNN}-attempt-000",
            status: "complete",
            source: "initial",
            createdAt: "2026-04-22T16:05:00.000Z",
            updatedAt: "2026-04-22T16:10:00.000Z",
            previewFrameLogicalKeys: [],
            qa: {
              verdict: "needs_repair",
              issueCount: 1,
              repairTriggerCount: 1,
            },
            triggerIssues: [
              {
                severity: "warning",
                description:
                  "Subject drifts near the right edge during the group shot.",
                atSeconds: 30,
                shotId: "shot_00002",
              },
            ],
          },
          {
            attemptIndex: 1,
            suffix: "attempt-001",
            planLogicalKey: "smart-crop-plan-attempt-001",
            planArtifactType: "smart-crop-plan-9x16-attempt-001-v1",
            previewLogicalKey: "smart-crop-preview-attempt-001",
            previewArtifactType: "smart-crop-preview-9x16-attempt-001",
            renderReportLogicalKey:
              "smart-crop-render-report-preview-attempt-001",
            renderReportArtifactType:
              "smart-crop-render-report-9x16-preview-attempt-001",
            qaLogicalKey: "smart-crop-qa-attempt-001",
            qaArtifactType: "smart-crop-qa-9x16-attempt-001-v1",
            previewFrameLogicalKeyPattern:
              "smart-crop-preview-frame-9x16-{NNN}-attempt-001",
            status: "complete",
            source: "repair",
            repairedFromAttemptIndex: 0,
            createdAt: "2026-04-22T16:10:30.000Z",
            updatedAt: "2026-04-22T16:11:30.000Z",
            previewFrameLogicalKeys: [],
            qa: {
              verdict: "pass",
              issueCount: 0,
              repairTriggerCount: 0,
            },
            triggerIssues: [],
          },
        ],
        updatedAt: "2026-04-22T16:11:30.000Z",
        manifestDigest: "fnv1a:13015fa1",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-qa-9x16-attempt-000-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-qa-report",
        assetId: "mock_smart_crop_asset",
        renderMode: "preview",
        verdict: "needs_repair",
        issues: [
          {
            severity: "warning",
            description:
              "Subject drifts near the right edge during the group shot.",
            atSeconds: 30,
            shotId: "shot_00002",
          },
        ],
        frameCount: 2,
        model: "mock-model",
        usage: { inputTokens: 90, outputTokens: 24 },
        generatedAt: "2026-04-22T16:10:00.000Z",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-qa-9x16-attempt-001-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-qa-report",
        assetId: "mock_smart_crop_asset",
        renderMode: "preview",
        verdict: "pass",
        issues: [],
        frameCount: 2,
        model: "mock-model",
        usage: { inputTokens: 76, outputTokens: 14 },
        generatedAt: "2026-04-22T16:11:30.000Z",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_smart_crop_asset",
    artifactType: "smart-crop-plan-9x16-attempt-001-v1",
    ext: "json",
    body: JSON.stringify(
      {
        version: 1,
        kind: "smart-crop-canonical-plan",
        assetId: "mock_smart_crop_asset",
        muxAssetId: "mock_smart_crop_asset",
        playbackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
        source: { width: 1920, height: 1080, durationSeconds: 60 },
        target: { aspectRatio: "9:16", width: 1080, height: 1920 },
        strategy: {
          cropMode: "auto",
          plannerVersion: "smart-crop-planner-v1",
          model: "mock-model",
        },
        segments: [
          {
            shotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 18,
            mode: "speaker",
            primarySubject: "Narrator",
            secondarySubjects: [],
            avoidCutting: ["face"],
            confidence: 0.92,
            cropKeyframes: [
              { progress: 0, x: 240, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 320, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00002",
            canonicalStart: 18,
            canonicalEnd: 42,
            mode: "group",
            primarySubject: "Two people",
            secondarySubjects: ["background group"],
            avoidCutting: ["faces"],
            confidence: 0.9,
            cropKeyframes: [
              { progress: 0, x: 680, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 720, y: 0, width: 606, height: 1080 },
            ],
          },
          {
            shotId: "shot_00003",
            canonicalStart: 42,
            canonicalEnd: 60,
            mode: "slide_aware",
            primarySubject: "Title card",
            secondarySubjects: [],
            avoidCutting: ["on-screen text"],
            confidence: 0.78,
            cropKeyframes: [
              { progress: 0, x: 656, y: 0, width: 606, height: 1080 },
              { progress: 1, x: 656, y: 0, width: 606, height: 1080 },
            ],
          },
        ],
        usage: { inputTokens: 1240, outputTokens: 320 },
        qa: {
          status: "draft",
        },
        generatedAt: "2026-04-22T16:10:30.000Z",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_asset_1",
    artifactType: "metadata",
    ext: "json",
    body: JSON.stringify(
      {
        title: "Episode 1 FR",
        description: "Description for the generated French demo metadata.",
        tags: ["hope", "demo"],
        topics: ["translation"],
        speakers: ["Narrator"],
        language: "French",
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_asset_1",
    artifactType: "chapters",
    ext: "json",
    body: JSON.stringify(
      {
        chapters: [
          {
            title: "Opening",
            startSeconds: 0,
            endSeconds: 42,
            summary: "Sets up the story",
          },
          {
            title: "Turning Point",
            startSeconds: 42,
            endSeconds: 93,
            summary: "Main character finds hope",
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    assetId: "mock_asset_1",
    artifactType: "chapters-vtt",
    ext: "vtt",
    body: `WEBVTT

00:00:00.000 --> 00:00:42.000
Opening

00:00:42.000 --> 00:01:33.000
Turning Point
`,
  },
  {
    assetId: "mock_asset_1",
    artifactType: "subtitles",
    ext: "vtt",
    body: `WEBVTT

00:00:00.000 --> 00:00:03.000
Welcome to the demo.
`,
  },
  {
    assetId: "mock_asset_1",
    artifactType: "subtitles-fr",
    ext: "vtt",
    body: `WEBVTT

00:00:00.000 --> 00:00:03.000
Bienvenue dans la demo.
`,
  },
]
