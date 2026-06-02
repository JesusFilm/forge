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
        sourceLabel: "Mux",
        sourceTone: "info",
        dubs: "3 dubs · EN, ES, FR",
        updated: "10/24/2023, 14:02",
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
        sourceLabel: "Internal",
        sourceTone: "muted",
        dubs: "No dubs",
        updated: "10/24/2023, 14:03",
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
      { label: "Index Dim", value: "1536", footer: "PGVECTOR_HNSW" },
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
      { label: "Vector Dimension", value: "1536", detail: "detail" },
      { label: "Input", value: "Idle", detail: "detail" },
    ],
    results: [],
    queryText: "",
    locale: "en",
    unavailableReason: null,
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
    rows: [
      {
        key: "lang1",
        title: "en",
        detail: "slug en",
        statusLabel: "Reference",
        statusTone: "muted",
        meta: "10/24/2023, 14:02",
      },
    ],
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
import { loadVideoLibraryPage } from "@/app/dashboard/live-data"
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

  it("renders videos page with localized info strip and actions", async () => {
    const html = await htmlFrom(
      VideosPage({ searchParams: Promise.resolve({ page: "2" }) }),
    )
    expect(html).toContain(uiMessages.pages.videos.infoStrip.items[0])
    expect(html).toContain(uiMessages.pages.videos.actions.primary)
    expect(html).toContain(uiMessages.pages.videos.actions.filterUnavailable)
    expect(html).toContain(uiMessages.pages.videos.actions.primaryUnavailable)
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*title="Video filters are not available yet.")/,
    )
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*title="Manual video creation is not available yet.")/,
    )
    expect(html).not.toContain(
      'hover:text-[var(--color-text-primary)]">⋯</button>',
    )
    expect(html).not.toContain(uiMessages.common.operatorNotes)
    expect(vi.mocked(loadVideoLibraryPage)).toHaveBeenCalledWith(
      { id: "test-user", role: "ADMIN" },
      { page: 2 },
    )
    expect(html).toContain("Collection")
    expect(html).toContain("https://images.example.com/neon.jpg")
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
    expect(html).toContain("Showing 31-60 of 95")
    expect(html).toContain("Page 2 of 4")
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
})
