import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

const uiMessages = {
  common: adminMessages.es.common,
  pages: adminMessages.en.pages,
}

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => uiMessages as never),
}))

vi.mock("@/auth/session", () => ({
  requireSession: vi.fn(async () => ({ id: "test-user", role: "ADMIN" })),
  requireAdminSession: vi.fn(async () => ({ id: "test-user", role: "ADMIN" })),
}))

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard/media"),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock("@/services", () => ({
  createServices: vi.fn(() => ({
    mediaAsset: {
      getById: vi.fn(async () => ({
        id: "media1",
        kind: "IMAGE",
        backend: "LOCAL",
        visibility: "PRIVATE",
        displayName: "poster",
        description: null,
        altText: "Poster alt",
        mimeType: "image/webp",
        byteSize: 2048n,
        width: 1200,
        height: 675,
        durationMs: null,
        originalFilename: "poster.webp",
        checksumSha256: null,
        objectKey: "media-assets/media1/original/poster.webp",
        previewObjectKey: null,
        muxPlaybackId: null,
        updatedAt: new Date("2023-10-24T14:02:00.000Z"),
      })),
      usage: vi.fn(async () => [
        {
          experienceId: "exp_1",
          experienceLocaleId: "loc_1",
          locale: "en",
          title: "Stories of Forgiveness",
          location: "blocks",
          fieldPath: "$.blocks[0].imageUrl",
          fieldName: "imageUrl",
          value: "/api/media-assets/media1/preview",
          match: "url",
        },
      ]),
    },
  })),
}))

vi.mock("@/app/dashboard/media/folder-tree", () => ({
  MediaFolderTree: vi.fn(
    ({ folders }: { folders: Array<{ label: string }> }) => (
      <div>{folders.map((folder) => folder.label).join(", ")}</div>
    ),
  ),
}))

vi.mock("@/app/dashboard/live-data", () => ({
  loadExperienceRows: vi.fn(async () => [
    {
      key: "exp_1",
      locale: "en",
      title: "Stories of Forgiveness",
      slug: "/watch/forgiveness-v4-global",
      statusLabel: "PUBLISHED",
      statusTone: "success",
      preview: {
        imageUrl: "https://images.example.com/forgiveness.jpg",
      },
    },
  ]),
  loadVideoRows: vi.fn(async () => [
    {
      key: "vid_1",
      title: "Neon Genesis: The Digital Divide",
      id: "vid_8829_x_alpha_92",
      slug: "neon-genesis-the-digital-divide",
      label: "FEATURE_FILM",
      labelLabel: "Feature Film",
      sourceLabel: "Mux",
      sourceTone: "info",
      dubs: "3 dubs · EN, ES, FR",
      updated: "10/24/2023, 14:02",
      updatedAtIso: "2023-10-24T14:02:00.000Z",
      updatedRelative: "3 years ago",
      duration: "04:22",
      previewImageUrl: "https://images.example.com/neon.jpg",
      visitorUrl:
        "https://www.jesusfilm.org/watch/neon-genesis-the-digital-divide.html/english.html",
    },
  ]),
  loadVideoLibraryPage: vi.fn(async () => ({
    rows: [
      {
        key: "vid_1",
        title: "Neon Genesis: The Digital Divide",
        id: "vid_8829_x_alpha_92",
        slug: "neon-genesis-the-digital-divide",
        label: "COLLECTION",
        labelLabel: "Collection",
        childCount: 2,
        isCollectionTarget: true,
        sourceLabel: "Mux",
        sourceTone: "info",
        dubs: "3 dubs · EN, ES, FR",
        dubCount: 3,
        dubLanguages: [
          { code: "EN", flagUrl: "https://flags.example.com/us.webp" },
          { code: "ES", flagUrl: "https://flags.example.com/es.webp" },
          { code: "FR", flagUrl: null },
        ],
        dubOverflowCount: 0,
        dubCoveragePercent: 1,
        updated: "10/24/2023, 14:02",
        updatedAtIso: "2023-10-24T14:02:00.000Z",
        updatedRelative: "3 years ago",
        updatedDateShort: "10/24/2023",
        duration: "04:22",
        previewImageUrl: "https://images.example.com/neon.jpg",
        visitorUrl:
          "https://www.jesusfilm.org/watch/neon-genesis-the-digital-divide.html/english.html",
      },
      {
        key: "vid_2",
        title: "No Public Link",
        id: "vid_no_public_link",
        slug: "no-public-link",
        label: null,
        labelLabel: null,
        childCount: 0,
        isCollectionTarget: false,
        sourceLabel: "Internal",
        sourceTone: "muted",
        dubs: "No dubs",
        dubCount: 0,
        dubLanguages: [],
        dubOverflowCount: 0,
        dubCoveragePercent: 0,
        updated: "10/24/2023, 14:03",
        updatedAtIso: "2023-10-24T14:03:00.000Z",
        updatedRelative: "3 years ago",
        updatedDateShort: "10/24/2023",
        duration: "--:--",
        previewImageUrl: null,
        visitorUrl: null,
      },
    ],
    pagination: {
      total: 95,
      currentPage: 2,
      pageSize: 30,
      pageCount: 4,
      hasPrevious: true,
      hasNext: true,
      offset: 30,
      rangeStart: 31,
      rangeEnd: 60,
    },
    languageOptions: [
      { label: "English", value: "english" },
      { label: "Spanish", value: "spanish" },
    ],
    collectionSummary: null,
  })),
  loadVideoLibraryDetail: vi.fn(async () => null),
}))

vi.mock("@/app/dashboard/videos/video-search-social-data", () => ({
  loadInitialVideoSearchSocialState: vi.fn(async () => ({
    initialOptions: [],
    initialLocale: null,
  })),
}))

vi.mock("@/app/dashboard/ops-data", () => ({
  loadDashboardOpsData: vi.fn(async () => ({
    metrics: [
      { label: "Experiences", value: "1", footer: "ACTIVE_ROWS" },
      { label: "Draft Locales", value: "1", footer: "EDITOR_QUEUE" },
      { label: "Videos", value: "1", footer: "SYNCED_CATALOG" },
      { label: "Last Sync", value: "10m", footer: "CORE_REFRESH" },
      {
        label: "Sync Errors",
        value: "0",
        footer: "ACTION_REQUIRED",
      },
    ],
    activity: [
      {
        key: "a1",
        title: "Stories of Forgiveness",
        detail: "/exp/forgiveness-v4-global",
        statusLabel: "PUBLISHED",
        statusTone: "success",
        meta: "10/24/2023, 14:02",
      },
    ],
    syncPanels: [
      {
        title: "Core Sync",
        lag: "10m",
        stateLabel: "Healthy",
        stateTone: "success",
      },
    ],
    watchlist: [
      {
        title: "Core sync",
        meta: "last sync 10/24/2023, 14:02",
        detail: "No synced data set is currently reporting sync errors.",
        statusLabel: "Healthy",
        statusTone: "success",
      },
    ],
    signals: [
      { label: "Published Locales", value: "1", detail: "detail" },
      { label: "Users", value: "1", detail: "detail" },
      { label: "Embedding Gap", value: "0", detail: "detail" },
      { label: "Synced Data Sets", value: "1", detail: "detail" },
    ],
  })),
  loadSystemStatusData: vi.fn(async () => ({
    metrics: [
      { label: "Synced Data Sets", value: "1", footer: "SYNC_STATE_ROWS" },
      { label: "Latest Sync", value: "10m", footer: "LATEST_WATERMARK" },
      { label: "Lock State", value: "CLEAR", footer: "CORE_SYNC_LOCK" },
      { label: "Exceptions", value: "0", footer: "REQUIRES_REVIEW" },
    ],
    matrix: [
      {
        entity: "videos",
        source: "core.videos",
        statusLabel: "Healthy",
        statusTone: "success",
        lastRun: "10 changed",
      },
    ],
    incidents: [
      {
        title: "No active sync incidents",
        meta: "lock clear",
        detail: "Persisted sync state is healthy.",
        statusLabel: "Healthy",
        statusTone: "success",
      },
    ],
    telemetry: [
      { label: "Connected Sources", value: "1", detail: "detail" },
      { label: "Lock Holder", value: "IDLE", detail: "detail" },
      { label: "Data Sets With Errors", value: "0", detail: "detail" },
      { label: "Latest Lag", value: "10m", detail: "detail" },
    ],
  })),
  loadWorkflowsData: vi.fn(async () => ({
    metrics: [
      { label: "Active", value: "0", footer: "RUNNING_OR_QUEUED" },
      { label: "Completed", value: "1", footer: "RECENT_RUNS" },
      { label: "Failed", value: "0", footer: "LAST_RUN_ERRORS" },
    ],
    queue: [
      {
        title: "core-sync",
        meta: "manual / wrun_123",
        detail: "Finished 10/24/2023, 14:02",
        statusLabel: "succeeded",
        statusTone: "success",
      },
    ],
    workers: [
      {
        title: "admin:test:123",
        meta: "admin / started 1m ago",
        detail: "Heartbeat 2s ago.",
        statusLabel: "Online",
        statusTone: "success",
      },
    ],
    insights: [
      { label: "Workflow API Keys", value: "Configured", detail: "detail" },
      { label: "HMAC Secret", value: "Configured", detail: "detail" },
      { label: "Experience Embedding", value: "Ready", detail: "detail" },
    ],
    syncLockHeld: false,
  })),
  loadEmbeddingsData: vi.fn(async () => ({
    metrics: [
      { label: "Embedded Rows", value: "10", footer: "EXPERIENCE_LOCALES" },
      { label: "Missing", value: "2", footer: "NULL_VECTORS" },
      { label: "Index Dim", value: "2048", footer: "PGVECTOR_EXACT" },
    ],
    rows: [
      {
        key: "loc1",
        title: "Stories of Forgiveness",
        detail: "en / forgiveness",
        statusLabel: "Ready",
        statusTone: "success",
        meta: "owner test-user / 10/24/2023, 14:02",
      },
    ],
    insights: [
      { label: "Provider", value: "OpenAI", detail: "detail" },
      { label: "Coverage", value: "80%", detail: "detail" },
      { label: "Published Coverage", value: "8", detail: "detail" },
    ],
    providerReady: true,
  })),
  runSemanticSearch: vi.fn(async () => ({
    metrics: [
      { label: "Embedded Rows", value: "10", footer: "SEARCHABLE" },
      { label: "Published Rows", value: "8", footer: "PUBLIC_SCOPE" },
      { label: "Provider", value: "Ready", footer: "TEXT_TO_VECTOR" },
    ],
    insights: [
      { label: "Locale", value: "en", detail: "detail" },
      { label: "Vector Dimension", value: "2048", detail: "detail" },
      { label: "Input", value: "Idle", detail: "detail" },
    ],
    results: [],
    queryText: "",
    locale: "en",
    unavailableReason: null,
  })),
  loadWatchSearchAnalyticsData: vi.fn(async () => ({
    metrics: [
      { label: "Searches", value: "1", footer: "LAST_24H_RAW_ROWS" },
      { label: "Click Rate", value: "100%", footer: "REQUESTS_WITH_CLICK" },
      { label: "No Results", value: "0", footer: "ZERO_RESULT_REQUESTS" },
      { label: "P95 Latency", value: "120ms", footer: "TRACE_METADATA" },
    ],
    insights: [
      { label: "Degraded", value: "0", detail: "detail" },
      { label: "Selected", value: "req_1234", detail: "detail" },
      { label: "Raw Query", value: "Visible", detail: "detail" },
      { label: "Unavailable", value: "0", detail: "detail" },
    ],
    querySummaries: [
      {
        queryText: "JESUS Russian",
        count: 1,
        clickRate: "100%",
        zeroResultCount: 0,
        averageClickedPosition: "1.0",
        targetLanguageSlug: "russian",
      },
    ],
    qualityFlags: [
      {
        label: "Zero Results",
        value: "0",
        detail: "Queries that returned no visible results.",
        tone: "success",
      },
      {
        label: "No Click",
        value: "0",
        detail: "Result-bearing searches where no result was selected.",
        tone: "success",
      },
    ],
    rankingHealth: [
      {
        label: "Average Click Rank",
        value: "1.0",
        detail: "Lower is better. Only clicked requests are included.",
      },
      {
        label: "Top Target Audio",
        value: "100%",
        detail: "First result has target-language audio.",
      },
    ],
    window: "24h",
    filters: {
      query: "",
      targetLanguageSlug: "",
      outcome: "",
      clicked: "all",
      availability: "",
    },
    requests: [
      {
        id: "trace_1",
        requestId: "req_12345678",
        queryText: "JESUS Russian",
        locale: "russian",
        targetLanguageSlug: "russian",
        targetLanguageSource: "query_named_language",
        queryNamedLanguageSlug: "russian",
        searchMode: "watch-search",
        outcome: "success",
        resultCount: 1,
        latencyMs: 120,
        clickedPosition: 1,
        clickCount: 1,
        createdAt: "10/24/2023, 14:02",
        createdAtIso: "2023-10-24T14:02:00.000Z",
        results: [
          {
            id: "video_1",
            type: "video",
            slug: "jesus",
            title: "JESUS",
            description: "Feature film",
            imageUrl: "https://images.example.com/jesus.jpg",
            score: 1,
            availabilityKind: "target_audio",
            evidenceKind: "exact_title",
            actionKind: "watch",
            clicked: true,
            position: 1,
          },
        ],
        lanes: [
          {
            lane: "exact_title",
            status: "fulfilled",
            elapsedMs: 12,
            resultCount: 1,
            reason: null,
          },
        ],
      },
    ],
    selectedRequest: null,
  })),
  loadUsersData: vi.fn(async () => ({
    metrics: [
      { label: "Admins", value: "1", footer: "GLOBAL_OVERRIDE" },
      { label: "Editors", value: "1", footer: "CONTENT_OPERATORS" },
      { label: "Viewers", value: "1", footer: "READ_ONLY" },
    ],
    rows: [
      {
        key: "user1",
        title: "admin@example.com",
        detail: "auth_user_123",
        statusLabel: "ADMIN",
        statusTone: "success",
        meta: "10/24/2023, 14:02",
        productAccess: [
          {
            key: "admin",
            label: "Admin",
            selectedRole: "ADMIN",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "VIEWER", label: "Viewer" },
              { value: "EDITOR", label: "Editor" },
              { value: "ADMIN", label: "Admin" },
            ],
            statusTone: "success",
            disabled: true,
            backed: false,
            helperText: "Status role",
          },
          {
            key: "manager",
            label: "Manager",
            selectedRole: "OPERATOR",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "OPERATOR", label: "Operator" },
            ],
            statusTone: "success",
            disabled: false,
            backed: true,
            helperText: "Backed",
          },
          {
            key: "mastra-studio",
            label: "Mastra Studio",
            selectedRole: "STUDIO_ACCESS",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "STUDIO_ACCESS", label: "Studio access" },
            ],
            statusTone: "success",
            disabled: false,
            backed: true,
            helperText: "Backed",
          },
        ],
      },
      {
        key: "user2",
        title: "viewer@example.com",
        detail: "auth_user_456",
        statusLabel: "VIEWER",
        statusTone: "warning",
        meta: "10/24/2023, 14:03",
        productAccess: [
          {
            key: "admin",
            label: "Admin",
            selectedRole: "VIEWER",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "VIEWER", label: "Viewer" },
              { value: "EDITOR", label: "Editor" },
              { value: "ADMIN", label: "Admin" },
            ],
            statusTone: "warning",
            disabled: true,
            backed: false,
            helperText: "Status role",
          },
          {
            key: "manager",
            label: "Manager",
            selectedRole: "NO_ACCESS",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "OPERATOR", label: "Operator" },
            ],
            statusTone: "muted",
            disabled: false,
            backed: true,
            helperText: "Backed",
          },
          {
            key: "mastra-studio",
            label: "Mastra Studio",
            selectedRole: "NO_ACCESS",
            roleOptions: [
              { value: "NO_ACCESS", label: "No access" },
              { value: "STUDIO_ACCESS", label: "Studio access" },
            ],
            statusTone: "muted",
            disabled: false,
            backed: true,
            helperText: "Backed",
          },
        ],
      },
    ],
    insights: [
      { label: "Role Mappings", value: "1", detail: "detail" },
      { label: "Access Requests", value: "0", detail: "detail" },
      { label: "Auth Issuer", value: "auth.local", detail: "detail" },
    ],
  })),
  loadSettingsData: vi.fn(async () => ({
    metrics: [
      {
        label: "Auth Client",
        value: "jfp_admin_local",
        footer: "OAUTH_CLIENT",
      },
      { label: "Admin Origin", value: "localhost:3003", footer: "CALLBACK" },
      { label: "CORS Origins", value: "1", footer: "GRAPHQL_ALLOWLIST" },
    ],
    rows: [
      {
        key: "admin-session",
        title: "Admin session secret",
        detail: "Local OAuth session signing secret",
        statusLabel: "Configured",
        statusTone: "success",
        meta: "http://localhost:3004/api/auth",
      },
    ],
    insights: [
      { label: "GraphQL Introspection", value: "Disabled", detail: "detail" },
      { label: "Workflow Signing", value: "Configured", detail: "detail" },
      { label: "Embedding Backend", value: "OpenAI", detail: "detail" },
    ],
  })),
  loadLanguagesData: vi.fn(async () => ({
    metrics: [
      { label: "Languages", value: "2", footer: "REFERENCE_ROWS" },
      { label: "Countries", value: "2", footer: "ISO_MAPPED" },
      { label: "Locales In Use", value: "2", footer: "CONTENT_ROWS" },
    ],
    diagnosticRows: [
      {
        id: "lang1",
        coreId: "529",
        source: "CORE",
        title: "English",
        subtitle: "en / eng / english",
        codeLabel: "en / eng / english",
        bcp47: "en",
        iso3: "eng",
        slug: "english",
        statusLabel: "Linked",
        statusTone: "success",
        syncLabel: "Core synced",
        syncTone: "success",
        names: [{ locale: "en", value: "English", primary: true }],
        countryPreviews: [
          {
            id: "cl1",
            coreId: "US",
            label: "United States",
            continentLabel: "North America",
            flagUrl: "https://flags.example.com/us.webp",
            speakers: "270M",
            primary: true,
            suggested: true,
            order: 1,
          },
        ],
        counts: {
          countryLanguages: 1,
          videoDubs: 2,
          videoSubtitles: 4,
          studyQuestions: 5,
          primaryVideos: 6,
          totalContentLinks: 17,
        },
        audioPreview: {
          available: true,
          value: "https://cdn.example.com/en.mp3",
          duration: "12s",
          size: "2.0 KB",
          bitrate: "128 kbps",
          codec: "mp3",
        },
        timestamps: {
          createdAt: "10/23/2023, 14:02",
          createdAtIso: "2023-10-23T14:02:00.000Z",
          updatedAt: "10/24/2023, 14:02",
          updatedAtIso: "2023-10-24T14:02:00.000Z",
          syncedAt: "10/24/2023, 14:02",
          syncedAtIso: "2023-10-24T14:02:00.000Z",
        },
        flags: {
          linked: true,
          referenceOnly: false,
          missingMetadata: false,
          countryLinked: true,
          hasDubs: true,
          hasSubtitles: true,
          hasStudyQuestions: true,
          primaryVideoLanguage: true,
          hasAudioPreview: true,
          coreSynced: true,
          syncMissing: false,
          updatedAfterSync: false,
          nonCoreSource: false,
        },
        searchText:
          "lang1 529 core english en eng english linked core synced united states",
      },
    ],
    diagnostics: {
      softDeletedLanguages: 0,
      lastSyncedAt: "10/24/2023, 14:02",
      lastSyncedAtIso: "2023-10-24T14:02:00.000Z",
      lastSyncStats: [{ key: "updated", value: "1" }],
    },
    insights: [
      { label: "Locale Footprint", value: "2", detail: "detail" },
      { label: "Language Rows", value: "2", detail: "detail" },
      { label: "Country Rows", value: "2", detail: "detail" },
    ],
  })),
  loadMediaData: vi.fn(async () => ({
    metrics: [
      { label: "Assets", value: "2", footer: "MEDIA_ASSET_ROWS" },
      { label: "Images", value: "2", footer: "IMAGE_LIBRARY" },
      { label: "Processing", value: "0", footer: "ACTIVE_UPLOADS" },
    ],
    folders: [
      {
        id: "folder-1",
        label: "Campaigns",
        count: 1,
        directAssetCount: 1,
        childFolderCount: 0,
        parentId: null,
        depth: 0,
      },
    ],
    rows: [
      {
        key: "media1",
        title: "poster",
        detail: "slug story",
        statusLabel: "Ready",
        statusTone: "success",
        meta: "10/24/2023, 14:02",
        kind: "IMAGE",
        folderId: "folder-1",
        backend: "LOCAL",
        byteSize: "2.0 KB",
        dimensions: "1200x675",
        previewUrl: "/api/media-assets/media1/preview",
        downloadUrl: "/api/media-assets/media1/download",
      },
    ],
    insights: [
      { label: "Image Assets", value: "2", detail: "detail" },
      { label: "Video Assets", value: "0", detail: "detail" },
      { label: "PDF Assets", value: "0", detail: "detail" },
    ],
    totalCount: 2,
    unfiledCount: 1,
  })),
}))

vi.mock("@/services/workflow-runtime.service", () => ({
  loadWorkflowRuntimeRuns: vi.fn(async () => [
    {
      runId: "wrun_123",
      workflowName: "workflow//./src/workflows/coreSync//runCoreSync",
      displayName: "runCoreSync",
      status: "completed",
      createdAt: new Date("2023-10-24T14:02:00.000Z"),
      startedAt: new Date("2023-10-24T14:02:01.000Z"),
      completedAt: new Date("2023-10-24T14:02:05.000Z"),
      stepCount: 2,
      eventCount: 5,
    },
  ]),
}))

vi.mock("@/services/workflow-worker-heartbeat.service", () => ({
  loadWorkflowWorkerStatusRows: vi.fn(async () => [
    {
      id: "admin:test:123",
      meta: "admin / started 1m ago",
      detail: "Heartbeat 2s ago.",
      statusLabel: "Online",
      statusTone: "success",
    },
  ]),
}))

import DashboardPage from "./page"
import {
  loadVideoLibraryDetail,
  loadVideoLibraryPage,
} from "@/app/dashboard/live-data"
import SystemStatusPage from "./system-status/page"
import ExperiencesPage from "./experiences/page"
import VideosPage from "./videos/page"
import WorkflowsPage from "./workflows/page"
import EmbeddingsPage from "./embeddings/page"
import SearchPage from "./search/page"
import UsersPage from "./users/page"
import SettingsPage from "./settings/page"
import LanguagesPage from "./languages/page"
import MediaPage from "./media/page"
import DashboardLoading from "./loading"
import VideosLoading from "./videos/loading"
import LanguagesLoading from "./languages/loading"
import { ExperiencesActions } from "./experiences/experiences-actions"
import {
  DataTable,
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin-ui"
import { requireSession } from "@/auth/session"

async function htmlFrom(component: Promise<ReactNode>) {
  return renderToStaticMarkup(await component)
}

describe("dashboard UI routes", () => {
  it("renders dashboard and priority route loading fallbacks", () => {
    const dashboard = renderToStaticMarkup(<DashboardLoading />)
    const videos = renderToStaticMarkup(<VideosLoading />)
    const languages = renderToStaticMarkup(<LanguagesLoading />)

    expect(dashboard).toContain('role="status"')
    expect(dashboard).toContain('aria-label="Loading dashboard"')
    expect(dashboard).toContain("fixed right-4 bottom-4")
    expect(dashboard).toContain("route-feedback-enter")
    expect(videos).toContain('aria-label="Loading video library"')
    expect(videos).toContain("Loading video library")
    expect(videos).toContain("fixed right-4 bottom-4")
    expect(languages).toContain('aria-label="Loading language diagnostics"')
    expect(languages).toContain("Loading language diagnostics")
    expect(languages).toContain("fixed right-4 bottom-4")
  })

  it("renders primary buttons with explicit enabled and disabled affordances", () => {
    const enabled = renderToStaticMarkup(
      <PrimaryButton>Enabled primary</PrimaryButton>,
    )
    const disabled = renderToStaticMarkup(
      <PrimaryButton disabled>Disabled primary</PrimaryButton>,
    )

    expect(enabled).toContain("cursor-pointer")
    expect(enabled).toContain("hover:bg-[var(--color-brand-pressed)]")
    expect(enabled).not.toContain('disabled=""')
    expect(disabled).toContain('disabled=""')
    expect(disabled).toContain("disabled:cursor-not-allowed")
    expect(disabled).toContain("disabled:opacity-55")
  })

  it("renders secondary buttons with explicit enabled and disabled affordances", () => {
    const enabled = renderToStaticMarkup(
      <SecondaryButton>Enabled secondary</SecondaryButton>,
    )
    const disabled = renderToStaticMarkup(
      <SecondaryButton disabled>Disabled secondary</SecondaryButton>,
    )

    expect(enabled).toContain("cursor-pointer")
    expect(enabled).toContain("hover:bg-[var(--color-surface-raised)]")
    expect(enabled).not.toContain('disabled=""')
    expect(disabled).toContain('disabled=""')
    expect(disabled).toContain("disabled:cursor-not-allowed")
    expect(disabled).toContain("disabled:opacity-50")
  })

  it("renders read-only data tables without default row actions", () => {
    const html = renderToStaticMarkup(
      <DataTable columns={["Name"]} rows={[[<span key="row">Row</span>]]} />,
    )

    expect(html).toContain("Row")
    expect(html.match(/<th[\s>]/g)).toHaveLength(1)
    expect(html.match(/<td[\s>]/g)).toHaveLength(1)
    expect(html).not.toContain("<svg")
    expect(html).not.toContain("hover:bg-[var(--color-surface-raised)]")
    expect(html).not.toContain("Quick Actions")
  })

  it("renders overview page with translated shared chrome", async () => {
    const html = await htmlFrom(DashboardPage())

    expect(html).toContain(uiMessages.pages.dashboard.title)
    expect(html).toContain(uiMessages.pages.dashboard.action)
    expect(html).toContain(uiMessages.pages.dashboard.actionUnavailable)
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*aria-describedby="dashboard-sync-action-unavailable")/,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain(uiMessages.common.operatorNotes)
  })

  it("renders experiences page from i18n dictionaries", async () => {
    const html = await htmlFrom(ExperiencesPage())
    expect(html).toContain(uiMessages.pages.experiences.title)
    expect(html).toContain(uiMessages.pages.experiences.actions.primary)
    expect(html).toContain("https://images.example.com/forgiveness.jpg")
    expect(html).toContain("/watch/forgiveness-v4-global")
    expect(html).not.toContain("/exp/forgiveness-v4-global")
    expect(html).not.toContain(uiMessages.common.operatorNotes)
    expect(html).not.toContain("Editorial Signals")
    expect(html).not.toContain("Embedding")
    expect(html).not.toContain("M. Rodriguez")
    expect(html).not.toContain("10/24/2023, 14:02")
  })

  it("renders videos page with screenshot-style library layout", async () => {
    const html = await htmlFrom(
      VideosPage({ searchParams: Promise.resolve({ page: "2", q: " mux " }) }),
    )
    expect(html).toContain(uiMessages.pages.videos.title)
    expect(html).toContain("Review the catalog and dub coverage across")
    expect(html).toContain("95")
    expect(html).toContain(uiMessages.pages.videos.actions.primary)
    expect(html).toContain(uiMessages.pages.videos.actions.primaryUnavailable)
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]")
    expect(html).toMatch(
      /<button(?=[^>]*aria-disabled="true")(?=[^>]*title="Manual video creation is not available yet.")/,
    )
    expect(html).toContain(uiMessages.pages.videos.tabs.all)
    expect(html).toContain(uiMessages.pages.videos.tabs.collections)
    expect(html).toContain(uiMessages.pages.videos.tabs.features)
    expect(html).toContain(uiMessages.pages.videos.tabs.shortFilms)
    expect(html).toContain(uiMessages.pages.videos.tabs.series)
    expect(html).toContain(uiMessages.pages.videos.sort.label)
    expect(html).not.toContain(uiMessages.pages.videos.infoStrip.items[0])
    expect(html).not.toContain(uiMessages.pages.videos.summary.total)
    expect(html).not.toContain(uiMessages.pages.videos.signals.title)
    expect(html).toContain("overflow-x-auto")
    expect(html).not.toContain("max-w-[1720px]")
    expect(html).not.toContain("h-[62px]")
    expect(html).not.toContain("minmax(430px")
    expect(html).not.toContain(uiMessages.common.operatorNotes)
    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      {
        category: "all",
        collection: "",
        language: "",
        page: 2,
        query: "mux",
        sort: "recent",
      },
    )
    expect(html).toContain(uiMessages.pages.videos.search.label)
    expect(html).toContain(uiMessages.pages.videos.search.placeholder)
    expect(html).toContain('name="q"')
    expect(html).toContain('name="type"')
    expect(html).toContain('name="language"')
    expect(html).toContain('name="sort"')
    expect(html).toContain('value="mux"')
    expect(html).toContain("Filtered by &quot;mux&quot;")
    expect(html).toContain("All languages")
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-label="Filter by dubbed language"')
    expect(html).toContain(uiMessages.pages.videos.filters.ready)
    expect(html).toContain(uiMessages.pages.videos.sort.options.recent)
    expect(html).toContain(uiMessages.pages.videos.sort.options.oldest)
    expect(html).toContain('href="/dashboard/videos?q=mux"')
    expect(html).toContain('href="/dashboard/videos?page=3&amp;q=mux"')
    expect(html).toContain(
      'href="/dashboard/videos?q=mux&amp;collection=neon-genesis-the-digital-divide"',
    )
    expect(html).toContain(
      'href="/dashboard/videos?page=2&amp;q=mux&amp;video=no-public-link"',
    )
    expect(html).toContain("COLLECTION")
    expect(html).toContain("Mux source")
    expect(html).toContain("Internal source")
    expect(html).toContain("languages dubbed")
    expect(html).toContain("text-[18px] font-semibold leading-6")
    expect(html).toContain("EN")
    expect(html).toContain("ES")
    expect(html).toContain("FR")
    expect(html).toContain("https://flags.example.com/us.webp")
    expect(html).toContain("https://flags.example.com/es.webp")
    expect(html).toContain("https://images.example.com/neon.jpg")
    expect(html).toContain("3 years ago")
    expect(html).toContain("10/24/2023")
    expect(html).toContain('title="10/24/2023, 14:02"')
    expect(html).toContain('dateTime="2023-10-24T14:02:00.000Z"')
    expect(html).toMatch(
      /<img(?=[^>]*src="https:\/\/images\.example\.com\/neon\.jpg")(?=[^>]*loading="lazy")(?=[^>]*decoding="async")/,
    )
    expect(html).toContain(
      "https://www.jesusfilm.org/watch/neon-genesis-the-digital-divide.html/english.html",
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain("--:--")
    expect(html).toContain("No public watch link available")
    expect(html).toMatch(
      /<span(?=[^>]*aria-disabled="true")(?=[^>]*aria-label="No public watch link available")/,
    )
    expect(html).toMatch(
      /<button(?=[^>]*aria-disabled="true")(?=[^>]*aria-label="Video row actions are not available yet.")/,
    )
    expect(html).toContain("Showing 31-60 of 95")
    expect(html).toContain("Page 2 of 4")
  })

  it("renders filtered empty video search results", async () => {
    vi.mocked(loadVideoLibraryPage).mockResolvedValueOnce({
      rows: [],
      pagination: {
        total: 0,
        currentPage: 1,
        pageSize: 30,
        pageCount: 1,
        hasPrevious: false,
        hasNext: false,
        offset: 0,
        rangeStart: 0,
        rangeEnd: 0,
      },
      languageOptions: [],
      collectionSummary: null,
    })

    const html = await htmlFrom(
      VideosPage({ searchParams: Promise.resolve({ q: "does-not-exist" }) }),
    )

    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      {
        category: "all",
        collection: "",
        language: "",
        page: 1,
        query: "does-not-exist",
        sort: "recent",
      },
    )
    expect(html).toContain(uiMessages.pages.videos.table.emptySearch)
    expect(html).not.toContain(uiMessages.pages.videos.table.empty)
    expect(html).toContain('href="/dashboard/videos"')
  })

  it("preserves video type, language, and sort state in loader calls and links", async () => {
    const html = await htmlFrom(
      VideosPage({
        searchParams: Promise.resolve({
          language: "english",
          page: "2",
          q: "Jesus",
          sort: "created",
          type: "features",
        }),
      }),
    )

    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      {
        category: "features",
        collection: "",
        language: "english",
        page: 2,
        query: "Jesus",
        sort: "created",
      },
    )
    expect(html).toContain('value="features" selected=""')
    expect(html).toContain('type="hidden" name="language" value="english"')
    expect(html).toContain("English")
    expect(html).toContain('value="created" selected=""')
    expect(html).toContain(
      'href="/dashboard/videos?type=features&amp;language=english&amp;sort=created"',
    )
    expect(html).toContain(
      'href="/dashboard/videos?page=3&amp;q=Jesus&amp;type=features&amp;language=english&amp;sort=created"',
    )
  })

  it("resets type state when drilling into a collection row", async () => {
    const html = await htmlFrom(
      VideosPage({
        searchParams: Promise.resolve({
          q: "Jesus",
          type: "collections",
        }),
      }),
    )

    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      {
        category: "collections",
        collection: "",
        language: "",
        page: 1,
        query: "Jesus",
        sort: "recent",
      },
    )
    expect(html).toContain(
      'href="/dashboard/videos?q=Jesus&amp;collection=neon-genesis-the-digital-divide"',
    )
    expect(html).not.toContain(
      'href="/dashboard/videos?q=Jesus&amp;type=collections&amp;collection=neon-genesis-the-digital-divide"',
    )
  })

  it("renders URL-backed selected video as a standalone detail page", async () => {
    vi.mocked(loadVideoLibraryPage).mockClear()
    vi.mocked(loadVideoLibraryDetail).mockClear()
    vi.mocked(loadVideoLibraryDetail).mockResolvedValueOnce({
      key: "vid_2",
      title: "No Public Link",
      description: "Known metadata for this video",
      previewImageUrl: "https://images.example.com/preview.jpg",
      label: "Video",
      source: "Internal",
      duration: "--:--",
      muxPlayerUrl: "https://player.mux.com/playback-123",
      visitorUrl: null,
      identity: [{ label: "Slug", value: "no-public-link" }],
      status: [{ label: "Locked", value: "No" }],
      timestamps: [{ label: "Updated at", value: "10/24/2023, 14:03" }],
      localizedContent: {
        title: "Localized Content",
        count: 1,
        empty: "No localized metadata",
        items: [
          {
            key: "locale-1",
            title: "No Public Link",
            meta: "en / DRAFT",
            detail: "Known metadata for this video",
          },
        ],
      },
      dubs: {
        title: "Dubs",
        count: 1,
        empty: "No dubs",
        items: [
          {
            key: "dub-1",
            title: "French",
            meta: "Published / Burned in",
            detail: "core-dub-1 / https://stream.mux.com/playback-123.m3u8",
            detailHref: "https://stream.mux.com/playback-123.m3u8",
            flagUrl: "https://flags.example.com/fr.webp",
          },
        ],
      },
      images: {
        title: "Images",
        count: 1,
        empty: "No images",
        items: [
          {
            key: "image-1",
            title: "Image",
            meta: "hd",
            detail: "https://images.example.com/detail.jpg",
            imageUrl: "https://images.example.com/detail.jpg",
          },
        ],
      },
      subtitles: {
        title: "Subtitles",
        count: 0,
        empty: "No subtitles",
        items: [],
      },
      studyQuestions: {
        title: "Study Questions",
        count: 0,
        empty: "No study questions",
        items: [],
      },
      bibleCitations: {
        title: "Bible Citations",
        count: 1,
        empty: "No Bible citations",
        items: [
          {
            key: "citation-1",
            title: "Romans 5:8",
            meta: "Rom / Order 1",
            detail: null,
            titleHref: "https://www.bible.com/bible/1/ROM.5.8.KJV",
          },
        ],
      },
      keywords: {
        title: "Keywords",
        count: 0,
        empty: "No keywords",
        items: [],
      },
      parents: {
        title: "Parent Collections",
        count: 1,
        empty: "No parent collections",
        items: [
          {
            key: "parent-1",
            title: "The Story",
            meta: "the-story / Collection",
            detail: "core-parent",
            href: "/dashboard/videos?collection=the-story",
          },
        ],
      },
      children: {
        title: "Child Videos",
        count: 0,
        empty: "No child videos",
        items: [],
      },
      technical: {
        title: "Technical Summaries",
        count: 0,
        empty: "No scene or transcript summaries",
        items: [],
      },
    })

    const html = await htmlFrom(
      VideosPage({
        searchParams: Promise.resolve({
          collection: "the-story",
          q: "Jesus",
          video: "no-public-link",
        }),
      }),
    )

    expect(vi.mocked(loadVideoLibraryDetail)).toHaveBeenCalledWith(
      "no-public-link",
    )
    expect(vi.mocked(loadVideoLibraryPage)).not.toHaveBeenCalled()
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain(uiMessages.pages.videos.collection.title)
    expect(html).toContain(uiMessages.pages.videos.detail.eyebrow)
    expect(html).toContain(uiMessages.pages.videos.detail.close)
    expect(html).toContain("Known metadata for this video")
    expect(html).toContain("https://images.example.com/preview.jpg")
    expect(html).toContain('href="https://player.mux.com/playback-123"')
    expect(html).toContain('title="Open Mux player"')
    expect(html).toContain('href="https://stream.mux.com/playback-123.m3u8"')
    expect(html).toContain('title="Open stream URL"')
    expect(html).toContain('href="https://www.bible.com/bible/1/ROM.5.8.KJV"')
    expect(html).toContain(
      'href="/dashboard/videos?q=Jesus&amp;collection=the-story"',
    )
    expect(html).toContain('href="/dashboard/videos?collection=the-story"')
    expect(html).toContain("https://flags.example.com/fr.webp")
    expect(html).toContain("https://images.example.com/detail.jpg")
    expect(html).toMatch(
      /<img(?=[^>]*src="https:\/\/images\.example\.com\/detail\.jpg")(?=[^>]*loading="lazy")(?=[^>]*decoding="async")/,
    )
  })

  it("falls back to the list when selected video detail is stale", async () => {
    vi.mocked(loadVideoLibraryPage).mockClear()
    vi.mocked(loadVideoLibraryDetail).mockClear()
    vi.mocked(loadVideoLibraryDetail).mockResolvedValueOnce(null)

    const html = await htmlFrom(
      VideosPage({
        searchParams: Promise.resolve({
          collection: "the-story",
          q: "Jesus",
          video: "missing-video",
        }),
      }),
    )

    expect(vi.mocked(loadVideoLibraryDetail)).toHaveBeenCalledWith(
      "missing-video",
    )
    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      {
        category: "all",
        collection: "the-story",
        language: "",
        page: 1,
        query: "Jesus",
        sort: "recent",
      },
    )
    expect(html).toContain(uiMessages.pages.videos.title)
    expect(html).not.toContain('role="dialog"')
  })

  it("renders first-page pagination with previous disabled and next linked", async () => {
    vi.mocked(loadVideoLibraryPage).mockResolvedValueOnce({
      rows: [],
      pagination: {
        total: 95,
        currentPage: 1,
        pageSize: 30,
        pageCount: 4,
        hasPrevious: false,
        hasNext: true,
        offset: 0,
        rangeStart: 1,
        rangeEnd: 30,
      },
      languageOptions: [],
      collectionSummary: null,
    })

    const html = await htmlFrom(
      VideosPage({ searchParams: Promise.resolve({ page: "1" }) }),
    )

    expect(html).toContain("Showing 1-30 of 95")
    expect(html).toContain("Page 1 of 4")
    expect(html).toMatch(
      /<span(?=[^>]*aria-disabled="true")[^>]*>[\s\S]*Previous/,
    )
    expect(html).toContain('href="/dashboard/videos?page=2"')
    expect(html).not.toContain('href="/dashboard/videos?page=0"')
  })

  it("renders final-page pagination with next disabled and previous linked", async () => {
    vi.mocked(loadVideoLibraryPage).mockResolvedValueOnce({
      rows: [],
      pagination: {
        total: 95,
        currentPage: 4,
        pageSize: 30,
        pageCount: 4,
        hasPrevious: true,
        hasNext: false,
        offset: 90,
        rangeStart: 91,
        rangeEnd: 95,
      },
      languageOptions: [],
      collectionSummary: null,
    })

    const html = await htmlFrom(
      VideosPage({ searchParams: Promise.resolve({ page: "999" }) }),
    )

    expect(html).toContain("Showing 91-95 of 95")
    expect(html).toContain("Page 4 of 4")
    expect(html).toContain('href="/dashboard/videos?page=3"')
    expect(html).toMatch(/Next[\s\S]*<\/span>/)
    expect(html).not.toContain('href="/dashboard/videos?page=5"')
  })

  it("renders languages page with video-library-style controls and rows", async () => {
    const html = await htmlFrom(LanguagesPage())

    expect(html).toContain(uiMessages.pages.languages.title)
    expect(html).toContain("Review reference metadata")
    expect(html).toContain("Search languages, IDs, codes, countries...")
    expect(html).toContain('aria-label="Language filters"')
    expect(html).toContain("Operational state")
    expect(html).toContain("Geo and content")
    expect(html).toContain("Sync provenance")
    expect(html).toContain("All active")
    expect(html).toContain("All usage")
    expect(html).toContain("All provenance")
    expect(html).toContain('aria-label="Language library results"')
    expect(html).toContain('aria-label="Language signal filters"')
    expect(html).toMatch(
      /<button(?=[^>]*role="combobox")(?=[^>]*aria-label="Filter by language")(?=[^>]*aria-haspopup="listbox")/,
    )
    expect(html).toContain("Languages")
    expect(html).toContain("Countries")
    expect(html).toContain("Locales In Use")
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Filter to country-linked languages")(?=[^>]*aria-pressed="false")/,
    )
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Filter to linked languages")(?=[^>]*aria-pressed="false")/,
    )
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Filter by sync status")(?=[^>]*aria-pressed="false")/,
    )
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Filter to soft-deleted languages")(?=[^>]*aria-pressed="false")/,
    )
    expect(html).toContain("Last sync")
    expect(html).toContain("Soft deleted")
    expect(html).toContain("English")
    expect(html).toContain("en / eng / english")
    expect(html).toContain("CORE")
    expect(html).toContain("Linked")
    expect(html).toContain("Core synced")
    expect(html).toContain("2")
    expect(html).toContain("dubs")
    expect(html).toContain("4 subtitles")
    expect(html).toContain("5 study questions")
    expect(html).toContain("17 content links")
    expect(html).toContain("1")
    expect(html).toContain("countries")
    expect(html).toContain("United States")
    expect(html).toContain("North America")
    expect(html).toContain("https://flags.example.com/us.webp")
    expect(html).toContain("Details")
    expect(html).toMatch(
      /<button(?=[^>]*id="language-diagnostic-row-lang1")(?=[^>]*aria-haspopup="dialog")/,
    )
    expect(html).toContain('dateTime="2023-10-24T14:02:00.000Z"')
    expect(html).not.toContain("Language Diagnostics")
    expect(html).not.toContain("Locale Signals")
    expect(html).not.toContain(uiMessages.common.operatorNotes)
  })

  it("renders core sync page around current sync state", async () => {
    const html = await htmlFrom(SystemStatusPage())
    expect(html).toContain(uiMessages.pages.systemStatus.title)
    expect(html).toContain("Core Sync is healthy")
    expect(html).toContain("Sync State")
    expect(html).toContain("Needs Attention")
  })

  it("renders read-only core sync state for principals without trigger permission", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      id: "viewer-user",
      role: "VIEWER",
    })

    const html = await htmlFrom(SystemStatusPage())

    expect(html).toContain(uiMessages.common.readOnly)
    expect(html).toMatch(
      new RegExp(
        `<button(?=[^>]*disabled="")[^>]*>${uiMessages.common.readOnly}</button>`,
      ),
    )
    expect(html).not.toContain("Start Sync")
  })

  it("renders blocked experience creation as unavailable before click", () => {
    const html = renderToStaticMarkup(
      <ExperiencesActions
        canCreate={false}
        createAction={vi.fn(async () => ({
          ok: false as const,
          error: "forbidden" as const,
        }))}
        labels={{
          filter: uiMessages.pages.experiences.actions.filter,
          filterUnavailable:
            uiMessages.pages.experiences.actions.filterUnavailable,
          primary: uiMessages.pages.experiences.actions.primary,
          modalTitle: uiMessages.pages.experiences.modal.title,
          modalDescription: uiMessages.pages.experiences.modal.description,
          titleLabel: uiMessages.pages.experiences.modal.titleLabel,
          localeLabel: uiMessages.pages.experiences.modal.localeLabel,
          slugLabel: uiMessages.pages.experiences.modal.slugLabel,
          routeTemplateLabel:
            uiMessages.pages.experiences.modal.routeTemplateLabel,
          routeTemplateHelp:
            uiMessages.pages.experiences.modal.routeTemplateHelp,
          cancel: uiMessages.pages.experiences.modal.cancel,
          submit: uiMessages.pages.experiences.modal.submit,
          localeHelp: uiMessages.pages.experiences.modal.localeHelp,
          noPermission: uiMessages.pages.experiences.modal.noPermission,
          createFailed: uiMessages.pages.experiences.modal.createFailed,
        }}
      />,
    )

    expect(html).toContain(uiMessages.pages.experiences.modal.noPermission)
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*title="You do not have permission to create experiences\.)/,
    )
    expect(html).not.toContain(uiMessages.pages.experiences.modal.title)
  })

  it("renders operational secondary routes", async () => {
    const pages = [
      {
        html: await htmlFrom(WorkflowsPage()),
        title: uiMessages.pages.workflows.title,
      },
      {
        html: await htmlFrom(EmbeddingsPage()),
        title: uiMessages.pages.embeddings.title,
      },
      {
        html: await htmlFrom(SearchPage()),
        title: uiMessages.pages.search.title,
      },
      {
        html: await htmlFrom(UsersPage()),
        title: uiMessages.pages.users.title,
      },
      {
        html: await htmlFrom(SettingsPage()),
        title: uiMessages.pages.settings.title,
      },
      {
        html: await htmlFrom(LanguagesPage()),
        title: uiMessages.pages.languages.title,
      },
      {
        html: await htmlFrom(MediaPage({ searchParams: Promise.resolve({}) })),
        title: "Media Library",
      },
    ]

    for (const page of pages) {
      expect(page.html).toContain(page.title.replaceAll("&", "&amp;"))
    }

    expect(pages[0].html).toContain("Workflow Runs")
    expect(pages[0].html).toContain("/dashboard/workflows/wrun_123")
    expect(pages[0].html).not.toContain("Recent Workflow Runs")
    expect(pages[6].html).toContain("Media Library")
    expect(pages[6].html).toContain("Library")
    expect(pages[6].html).toContain("Campaigns")
  })

  it("formats Watch search analytics labels without leaking enum underscores", async () => {
    const html = await htmlFrom(SearchPage())

    expect(html).toContain("Last 24h Raw Rows")
    expect(html).toContain("Requests With Click")
    expect(html).not.toContain("query_named_language")
    expect(html).not.toContain("LAST_24H_RAW_ROWS")
    expect(html).toContain("JESUS Russian")
    expect(html).not.toContain("requestId=req_12345678")
  })

  it("renders user product access controls", async () => {
    const html = await htmlFrom(UsersPage())

    expect(html).toContain("Product Access")
    expect(html).toContain("Admin app access role for admin@example.com")
    expect(html).toContain("Manager app access role for admin@example.com")
    expect(html).toContain(
      "Mastra Studio app access role for admin@example.com",
    )
    expect(html).toContain("Apply Manager role")
    expect(html).toContain("Apply Mastra Studio role")
    expect(html).toContain("Status role")
    expect(html).not.toContain("Mock only")
    expect(html).toContain('<option value="OPERATOR" selected="">Operator')
    expect(html).toContain(
      '<option value="STUDIO_ACCESS" selected="">Studio access',
    )
    expect(html).toContain('<option value="NO_ACCESS" selected="">No access')
    expect(html).toMatch(
      /aria-label="Admin app access role for admin@example\.com"[^>]*disabled=""/,
    )
    expect(html).not.toMatch(
      /aria-label="Mastra Studio app access role for admin@example\.com"[^>]*disabled=""/,
    )
    expect(html).not.toContain("Revoke Manager")
    expect(html).not.toContain("Enable Manager")
    expect(html).toContain("Approve Editor")
    expect(html).toContain("Approve Admin")
  })
})
