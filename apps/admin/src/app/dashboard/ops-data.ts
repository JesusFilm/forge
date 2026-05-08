import {
  Prisma,
  type LocaleStatus,
  type MediaAssetKind,
  type MediaImageEnrichmentStatus,
  type MediaAssetStatus,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { createServices } from "@/services"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import { DEFAULT_SYNC_LOCK_STALE_AFTER_MS } from "@/services/core-sync/lock"
import { getAllWatermarks } from "@/services/core-sync/watermark"
import {
  mediaAssetDownloadUrl,
  mediaAssetPreviewUrl,
} from "@/services/media-asset.service"
import { loadWorkflowRuntimeRuns } from "@/services/workflow-runtime.service"
import { loadWorkflowWorkerStatusRows } from "@/services/workflow-worker-heartbeat.service"

type Metric = {
  label: string
  value: string
  footer: string
  accent?: "danger"
}

type QueueItem = {
  title: string
  meta: string
  detail?: string
  statusLabel: string
  statusTone: "success" | "warning" | "danger" | "info" | "muted"
}

type Insight = {
  label: string
  value: string
  detail: string
}

type TableRow = {
  key: string
  title: string
  detail: string
  statusLabel: string
  statusTone: "success" | "warning" | "danger" | "info" | "muted"
  meta: string
}

type SearchResultRow = {
  id: string
  title: string
  slug: string
  locale: string
  status: string
  owner: string
  updated: string
}

type DashboardOpsData = {
  metrics: Metric[]
  activity: TableRow[]
  syncPanels: Array<{
    title: string
    lag: string
    stateLabel: string
    stateTone: "success" | "warning" | "danger" | "info" | "muted"
  }>
  watchlist: QueueItem[]
  signals: Insight[]
}

type SystemStatusData = {
  metrics: Metric[]
  matrix: Array<{
    entity: string
    source: string
    statusLabel: string
    statusTone: "success" | "warning" | "danger" | "info" | "muted"
    lastRun: string
  }>
  incidents: QueueItem[]
  telemetry: Insight[]
}

type WorkflowsData = {
  metrics: Metric[]
  queue: QueueItem[]
  workers: QueueItem[]
  insights: Insight[]
  syncLockHeld: boolean
}

type WorkflowMetricRow = {
  status: string
}

type EmbeddingsData = {
  metrics: Metric[]
  rows: TableRow[]
  insights: Insight[]
  providerReady: boolean
}

type LanguagesData = {
  metrics: Metric[]
  rows: TableRow[]
  insights: Insight[]
}

type MediaData = {
  metrics: Metric[]
  folders: MediaFolderRow[]
  rows: MediaAssetTableRow[]
  insights: Insight[]
  totalCount: number
  unfiledCount: number
}

export type MediaFolderRow = {
  id: string
  label: string
  count: number
  directAssetCount: number
  childFolderCount: number
  parentId: string | null
  depth: number
}

type MediaAssetTableRow = TableRow & {
  kind: MediaAssetKind
  folderId: string | null
  backend: string
  byteSize: string
  byteSizeValue: bigint | null
  dimensions: string
  previewUrl: string | null
  downloadUrl: string | null
  blurDataUrl: string | null
  imageEnrichmentStatus: MediaImageEnrichmentStatus
  imageEnrichmentErrorMessage: string | null
  updatedAtValue: Date
}

type MediaAssetWithEnglishLocale = Awaited<
  ReturnType<typeof createServices>
>["mediaAsset"] extends {
  list: (...args: never[]) => Promise<Array<infer Row>>
}
  ? Row & {
      locales?: Array<{
        locale: string
        displayName: string | null
      }>
    }
  : never

type UsersData = {
  metrics: Metric[]
  rows: TableRow[]
  insights: Insight[]
}

type SettingsData = {
  metrics: Metric[]
  rows: TableRow[]
  insights: Insight[]
}

type SearchData = {
  metrics: Metric[]
  insights: Insight[]
  results: SearchResultRow[]
  queryText: string
  locale: string
  unavailableReason: string | null
}

type EmbeddingHealthRow = {
  id: string
  locale: string
  slug: string
  title: string | null
  status: string
  updatedAt: Date
  ownerId: string | null
  hasEmbedding: boolean
}

type SyncWatermarkRow = {
  phase: string
  lastSyncedAt: string
  stats: unknown
}

type WorkflowRunRow = {
  id: string
  runtimeRunId: string | null
  workflowKey: string
  trigger: string
  status: string
  summary: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  skippedLock: boolean | null
}

type CoreSyncLockView = {
  heldBy: string | null
  acquiredAt: Date | null
  updatedAt: Date
}

function isMissingTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  )
}

async function withTableFallback<T>(run: () => Promise<T>, fallback: T) {
  try {
    return await run()
  } catch (error) {
    if (isMissingTableError(error)) {
      return fallback
    }
    throw error
  }
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function isCoreSyncLockActive(lock: CoreSyncLockView | null) {
  if (!lock?.heldBy) return false
  return (
    Date.now() - lock.updatedAt.getTime() <= DEFAULT_SYNC_LOCK_STALE_AFTER_MS
  )
}

function formatLag(value: Date | string | null | undefined) {
  if (!value) return "Never"
  const date = typeof value === "string" ? new Date(value) : value
  const deltaMs = Date.now() - date.getTime()
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "Unknown"

  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function statusToneForLocale(
  status: string,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "PUBLISHED" || status === "published") return "success"
  if (status === "ARCHIVED" || status === "archived") return "danger"
  return "warning"
}

function statusToneForSyncErrors(
  errors: number,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (errors > 0) return "danger"
  return "success"
}

function statusToneForWorkflowStatus(
  status: string,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "SUCCEEDED" || status === "succeeded") return "success"
  if (status === "completed") return "success"
  if (status === "FAILED" || status === "failed") return "danger"
  if (status === "SKIPPED" || status === "skipped") return "warning"
  if (status === "RUNNING" || status === "running") return "info"
  if (status === "pending") return "muted"
  return "muted"
}

function statusToneForMediaAsset(
  status: MediaAssetStatus,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "READY") return "success"
  if (status === "FAILED" || status === "MISSING") return "danger"
  if (status === "PROCESSING" || status === "UPLOADING") return "info"
  return "warning"
}

function statusToneForImageEnrichment(
  status: MediaImageEnrichmentStatus,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "COMPLETE") return "success"
  if (status === "FAILED") return "danger"
  if (status === "PROCESSING") return "info"
  if (status === "WAITING") return "warning"
  return "muted"
}

function formatBytes(value: bigint | null) {
  if (value == null) return "N/A"
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return value.toString()
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function mediaDimensions(row: {
  width: number | null
  height: number | null
  durationMs: bigint | null
}) {
  if (row.width && row.height) return `${row.width}x${row.height}`
  if (row.durationMs != null) return `${Number(row.durationMs / 1000n)}s`
  return "N/A"
}

function workflowStatusBucket(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === "running" || normalized === "queued") return "active"
  if (normalized === "failed") return "failed"
  if (
    normalized === "succeeded" ||
    normalized === "completed" ||
    normalized === "skipped" ||
    normalized === "cancelled"
  ) {
    return "completed"
  }
  return "active"
}

function countWorkflowStatuses(rows: WorkflowMetricRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts[workflowStatusBucket(row.status)] += 1
      return counts
    },
    { active: 0, completed: 0, failed: 0 },
  )
}

function phaseLabel(phase: string) {
  return phase
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function providerCount() {
  return [
    env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET,
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
    env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET,
    env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER,
  ].filter(Boolean).length
}

async function getEmbeddingCounts() {
  return withTableFallback(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{ total: bigint; embedded: bigint; published: bigint }>
      >(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded,
          COUNT(*) FILTER (WHERE status = 'published')::bigint AS published
        FROM experience_locale
      `)
      const row = rows[0]
      return {
        total: Number(row?.total ?? 0n),
        embedded: Number(row?.embedded ?? 0n),
        published: Number(row?.published ?? 0n),
      }
    },
    { total: 0, embedded: 0, published: 0 },
  )
}

async function getEmbeddingHealthRows(limit = 8) {
  return withTableFallback(
    () =>
      prisma.$queryRaw<EmbeddingHealthRow[]>(Prisma.sql`
        SELECT
          el.id,
          el.locale,
          el.slug,
          el.title,
          el.status::text AS status,
          el.updated_at AS "updatedAt",
          e.owner_id AS "ownerId",
          (el.embedding IS NOT NULL) AS "hasEmbedding"
        FROM experience_locale el
        JOIN experience e ON e.id = el.experience_id
        ORDER BY (el.embedding IS NULL) DESC, el.updated_at DESC
        LIMIT ${limit}
      `),
    [] as EmbeddingHealthRow[],
  )
}

async function getSyncRows() {
  return withTableFallback(
    () => getAllWatermarks(prisma),
    [] as SyncWatermarkRow[],
  )
}

function mediaSupplementalLabel(
  displayName: string,
  originalFilename: string | null,
  mimeType: string,
) {
  if (!originalFilename) {
    return mimeType
  }

  const normalizedDisplayName = displayName.trim().toLowerCase()
  const normalizedFilename = originalFilename.trim().toLowerCase()
  const normalizedFilenameStem = normalizedFilename.replace(/\.[^.]+$/, "")

  if (
    normalizedDisplayName === normalizedFilename ||
    normalizedDisplayName === normalizedFilenameStem
  ) {
    return ""
  }

  return originalFilename
}

function localizedMediaAssetLabel(row: {
  id: string
  originalFilename: string | null
  locales?: Array<{ locale: string; displayName: string | null }>
}) {
  const englishName = row.locales
    ?.find((locale) => locale.locale === "en")
    ?.displayName?.trim()
  return englishName || row.originalFilename || `Media asset ${row.id}`
}

async function getWorkflowRunRows(limit = 5) {
  return withTableFallback(
    () =>
      prisma.$queryRaw<WorkflowRunRow[]>(Prisma.sql`
        SELECT
          wr.id,
          wr.runtime_run_id AS "runtimeRunId",
          wr.workflow_key AS "workflowKey",
          wr.trigger::text AS trigger,
          wr.status::text AS status,
          wr.summary,
          wr.error,
          wr.created_at AS "createdAt",
          wr.started_at AS "startedAt",
          wr.finished_at AS "finishedAt",
          wr.duration_ms AS "durationMs",
          csr.skipped_lock AS "skippedLock"
        FROM workflow_run wr
        LEFT JOIN core_sync_run csr ON csr.workflow_run_id = wr.id
        ORDER BY wr.created_at DESC
        LIMIT ${limit}
      `),
    [] as WorkflowRunRow[],
  )
}

function parseSyncStats(stats: unknown) {
  if (typeof stats !== "object" || stats === null) {
    return { created: 0, updated: 0, softDeleted: 0, errors: 0 }
  }
  const value = stats as Record<string, unknown>
  return {
    created: Number(value.created ?? 0),
    updated: Number(value.updated ?? 0),
    softDeleted: Number(value.softDeleted ?? 0),
    errors: Number(value.errors ?? 0),
  }
}

async function getOverviewCounts() {
  return withTableFallback(
    async () => {
      const [
        experiences,
        drafts,
        videos,
        archivedExperiences,
        users,
        publishedLocales,
      ] = await Promise.all([
        prisma.experience.count({ where: { archivedAt: null } }),
        prisma.experienceLocale.count({ where: { status: "DRAFT" } }),
        prisma.video.count({ where: { deletedAt: null } }),
        prisma.experience.count({ where: { archivedAt: { not: null } } }),
        prisma.user.count(),
        prisma.experienceLocale.count({ where: { status: "PUBLISHED" } }),
      ])
      return {
        experiences,
        drafts,
        videos,
        archivedExperiences,
        users,
        publishedLocales,
      }
    },
    {
      experiences: 0,
      drafts: 0,
      videos: 0,
      archivedExperiences: 0,
      users: 0,
      publishedLocales: 0,
    },
  )
}

async function getRecentActivity(): Promise<TableRow[]> {
  const [experienceLocales, videoLocales, users] = await Promise.all([
    withTableFallback(
      () =>
        prisma.experienceLocale.findMany({
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 4,
        }),
      [] as Array<{
        id: string
        title: string | null
        slug: string
        status: LocaleStatus
        updatedAt: Date
      }>,
    ),
    withTableFallback(
      () =>
        prisma.videoLocale.findMany({
          select: {
            id: true,
            title: true,
            locale: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 3,
        }),
      [] as Array<{
        id: string
        title: string | null
        locale: string
        updatedAt: Date
      }>,
    ),
    withTableFallback(
      () =>
        prisma.user.findMany({
          select: { id: true, email: true, role: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 2,
        }),
      [] as Array<{
        id: string
        email: string
        role: string
        updatedAt: Date
      }>,
    ),
  ])

  const rows: Array<TableRow & { updatedAt: Date }> = [
    ...experienceLocales.map((row) => ({
      key: row.id,
      title: row.title?.trim() || row.slug,
      detail: row.slug,
      statusLabel: row.status,
      statusTone: statusToneForLocale(row.status),
      meta: formatDateTime(row.updatedAt),
      updatedAt: row.updatedAt,
    })),
    ...videoLocales.map((row) => ({
      key: row.id,
      title: row.title?.trim() || `Video locale ${row.locale}`,
      detail: row.locale,
      statusLabel: "VIDEO",
      statusTone: "info" as const,
      meta: formatDateTime(row.updatedAt),
      updatedAt: row.updatedAt,
    })),
    ...users.map((row) => ({
      key: row.id,
      title: row.email,
      detail: row.role,
      statusLabel: "USER",
      statusTone: "muted" as const,
      meta: formatDateTime(row.updatedAt),
      updatedAt: row.updatedAt,
    })),
  ]

  return rows
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 8)
    .map(({ updatedAt: _updatedAt, ...row }) => row)
}

async function getUserRoleCounts() {
  return withTableFallback(
    async () => {
      const [admins, editors, viewers, sessions, accounts] = await Promise.all([
        prisma.user.count({ where: { role: "ADMIN" } }),
        prisma.user.count({ where: { role: "EDITOR" } }),
        prisma.user.count({ where: { role: "VIEWER" } }),
        prisma.session.count(),
        prisma.account.count(),
      ])
      return { admins, editors, viewers, sessions, accounts }
    },
    { admins: 0, editors: 0, viewers: 0, sessions: 0, accounts: 0 },
  )
}

export async function loadDashboardOpsData(): Promise<DashboardOpsData> {
  const [counts, syncRows, embeddingCounts, activity] = await Promise.all([
    getOverviewCounts(),
    getSyncRows(),
    getEmbeddingCounts(),
    getRecentActivity(),
  ])

  const latestSync = syncRows[0]?.lastSyncedAt ?? null
  const failingPhases = syncRows.filter(
    (row) => parseSyncStats(row.stats).errors > 0,
  )

  return {
    metrics: [
      {
        label: "Experiences",
        value: counts.experiences.toString(),
        footer: "ACTIVE_ROWS",
      },
      {
        label: "Draft Locales",
        value: counts.drafts.toString(),
        footer: "EDITOR_QUEUE",
      },
      {
        label: "Videos",
        value: counts.videos.toString(),
        footer: "SYNCED_CATALOG",
      },
      {
        label: "Last Sync",
        value: formatLag(latestSync),
        footer: "CORE_REFRESH",
      },
      {
        label: "Sync Errors",
        value: failingPhases.length.toString(),
        footer: "ACTION_REQUIRED",
        accent: failingPhases.length > 0 ? "danger" : undefined,
      },
    ],
    activity,
    syncPanels: [
      {
        title: "Core Sync",
        lag: formatLag(latestSync),
        stateLabel: failingPhases.length > 0 ? "Review" : "Healthy",
        stateTone: failingPhases.length > 0 ? "warning" : "success",
      },
      {
        title: "Experience Embeddings",
        lag:
          embeddingCounts.total > 0
            ? `${embeddingCounts.embedded}/${embeddingCounts.total}`
            : "0/0",
        stateLabel:
          embeddingCounts.total === embeddingCounts.embedded
            ? "Ready"
            : "Pending",
        stateTone:
          embeddingCounts.total === embeddingCounts.embedded
            ? "success"
            : "warning",
      },
      {
        title: "Archived Experiences",
        lag: counts.archivedExperiences.toString(),
        stateLabel: counts.archivedExperiences > 0 ? "Visible" : "Clear",
        stateTone: counts.archivedExperiences > 0 ? "info" : "success",
      },
    ],
    watchlist:
      failingPhases.length > 0
        ? failingPhases.slice(0, 3).map((row) => {
            const stats = parseSyncStats(row.stats)
            return {
              title: `${phaseLabel(row.phase)} sync`,
              meta: `last sync ${formatDateTime(new Date(row.lastSyncedAt))}`,
              detail: `${stats.errors} error(s), ${stats.updated} updated, ${stats.created} created`,
              statusLabel: "Review",
              statusTone: "warning",
            }
          })
        : [
            {
              title: "Core sync",
              meta: latestSync
                ? `last sync ${formatDateTime(new Date(latestSync))}`
                : "no sync watermark yet",
              detail:
                "No synced data set is reporting errors in persisted status.",
              statusLabel: "Healthy",
              statusTone: "success",
            },
            {
              title: "Embedding coverage",
              meta: `${embeddingCounts.embedded}/${embeddingCounts.total} locales embedded`,
              detail:
                embeddingCounts.total === embeddingCounts.embedded
                  ? "All current locales have semantic vectors."
                  : "Some locales still need embeddings.",
              statusLabel:
                embeddingCounts.total === embeddingCounts.embedded
                  ? "Ready"
                  : "Pending",
              statusTone:
                embeddingCounts.total === embeddingCounts.embedded
                  ? ("success" as const)
                  : ("warning" as const),
            },
          ],
    signals: [
      {
        label: "Published Locales",
        value: counts.publishedLocales.toString(),
        detail: "Total published experience locales currently available.",
      },
      {
        label: "Users",
        value: counts.users.toString(),
        detail: "Authenticated principals persisted in Better Auth tables.",
      },
      {
        label: "Embedding Gap",
        value: Math.max(
          embeddingCounts.total - embeddingCounts.embedded,
          0,
        ).toString(),
        detail: "Experience locales still missing semantic vectors.",
      },
      {
        label: "Synced Data Sets",
        value: syncRows.length.toString(),
        detail: "Core data sets with persisted sync state.",
      },
    ],
  }
}

export async function loadSystemStatusData(): Promise<SystemStatusData> {
  const [syncRows, lock, workflowRows] = await Promise.all([
    getSyncRows(),
    withTableFallback(
      () => prisma.syncLock.findUnique({ where: { key: "core-sync" } }),
      null,
    ),
    getWorkflowRunRows(3),
  ])
  const lockActive = isCoreSyncLockActive(lock)

  const matrix = syncRows.map((row) => {
    const stats = parseSyncStats(row.stats)
    const changed = stats.created + stats.updated
    return {
      entity: phaseLabel(row.phase),
      source: `core.${row.phase}`,
      statusLabel: stats.errors > 0 ? "Review" : "Healthy",
      statusTone: statusToneForSyncErrors(stats.errors),
      lastRun: `${changed} changed`,
    }
  })

  const recentRunRows = workflowRows.map((row) => ({
    title: `${row.workflowKey} ${row.status}`,
    meta: `${row.trigger} / ${row.runtimeRunId ?? row.id}`,
    detail:
      row.summary ??
      row.error ??
      (row.finishedAt
        ? `Finished ${formatDateTime(row.finishedAt)}`
        : row.startedAt
          ? `Started ${formatDateTime(row.startedAt)}`
          : `Queued ${formatDateTime(row.createdAt)}`),
    statusLabel: row.status,
    statusTone: statusToneForWorkflowStatus(row.status),
  }))
  const runRowsNeedingAttention = recentRunRows.filter(
    (row) => row.statusTone === "danger",
  )

  const syncIncidentRows =
    matrix.filter((row) => row.statusTone !== "success").length > 0
      ? matrix
          .filter((row) => row.statusTone !== "success")
          .slice(0, 4)
          .map((row) => ({
            title: `${row.entity} sync needs review`,
            meta: row.source,
            detail: `Persisted sync status is ${row.statusLabel.toLowerCase()}.`,
            statusLabel: row.statusLabel,
            statusTone: row.statusTone,
          }))
      : [
          {
            title: "No active sync incidents",
            meta: lockActive ? `lock held by ${lock?.heldBy}` : "lock clear",
            detail: "No synced data sets are reporting issues.",
            statusLabel: "Healthy",
            statusTone: "success" as const,
          },
        ]

  const incidentRows = [...syncIncidentRows, ...runRowsNeedingAttention].slice(
    0,
    6,
  )

  return {
    metrics: [
      {
        label: "Synced Data Sets",
        value: syncRows.length.toString(),
        footer: "SYNC_STATE_ROWS",
      },
      {
        label: "Latest Sync",
        value: formatLag(syncRows[0]?.lastSyncedAt),
        footer: "LATEST_WATERMARK",
      },
      {
        label: "Lock State",
        value: lockActive ? "HELD" : "CLEAR",
        footer: "CORE_SYNC_LOCK",
      },
      {
        label: "Exceptions",
        value: incidentRows
          .filter((row) => row.statusTone !== "success")
          .length.toString(),
        footer: "REQUIRES_REVIEW",
        accent: incidentRows.some((row) => row.statusTone !== "success")
          ? "danger"
          : undefined,
      },
      {
        label: "Latest Attempted Sync",
        value: workflowRows[0]?.status ?? "NONE",
        footer: "WORKFLOW_ATTEMPT",
        accent:
          workflowRows[0]?.status === "failed" ||
          workflowRows[0]?.status === "FAILED"
            ? "danger"
            : undefined,
      },
    ],
    matrix,
    incidents: incidentRows,
    telemetry: [
      {
        label: "Lock Holder",
        value: lockActive ? "ACTIVE" : "IDLE",
        detail: lockActive
          ? "A sync run is currently holding the DB-backed lock."
          : lock?.heldBy
            ? "The previous sync lock is stale and can be reclaimed by the next run."
            : "No process currently holds the sync lock.",
      },
      {
        label: "Data Sets With Errors",
        value: incidentRows
          .filter((row) => row.statusTone !== "success")
          .length.toString(),
        detail: "Synced data sets reporting non-zero errors on the last run.",
      },
      {
        label: "Latest Attempted Sync",
        value: workflowRows[0]?.status ?? "None",
        detail: workflowRows[0]?.runtimeRunId
          ? `Runtime run ${workflowRows[0].runtimeRunId}.`
          : "No workflow ledger rows have been persisted yet.",
      },
    ],
  }
}

export async function loadWorkflowsData(): Promise<WorkflowsData> {
  const [syncRows, lock, workflowRows, runtimeRows, workerRows] =
    await Promise.all([
      getSyncRows(),
      withTableFallback(
        () => prisma.syncLock.findUnique({ where: { key: "core-sync" } }),
        null,
      ),
      getWorkflowRunRows(),
      loadWorkflowRuntimeRuns(10),
      loadWorkflowWorkerStatusRows(),
    ])
  const lockActive = isCoreSyncLockActive(lock)
  const ledgerByRuntimeRunId = new Map(
    workflowRows
      .filter((row) => row.runtimeRunId)
      .map((row) => [row.runtimeRunId, row]),
  )
  const runtimeRunIds = new Set(runtimeRows.map((row) => row.runId))
  const workflowRowsWithoutRuntime = workflowRows.filter(
    (row) => !row.runtimeRunId || !runtimeRunIds.has(row.runtimeRunId),
  )

  const queue: QueueItem[] = [
    ...runtimeRows.map((row) => {
      const ledger = ledgerByRuntimeRunId.get(row.runId)
      return {
        title: ledger?.workflowKey ?? row.displayName,
        meta: `${row.runId} / ${ledger?.trigger ?? "runtime"}`,
        detail:
          ledger?.summary ??
          row.error ??
          `${row.stepCount} step(s), ${row.eventCount} event(s)`,
        statusLabel: row.status,
        statusTone: statusToneForWorkflowStatus(row.status),
      }
    }),
    ...workflowRowsWithoutRuntime.map((row) => ({
      title: row.workflowKey,
      meta: `${row.trigger} / ${row.runtimeRunId ?? row.id}`,
      detail:
        row.summary ??
        row.error ??
        (row.startedAt
          ? `Started ${formatDateTime(row.startedAt)}`
          : `Queued ${formatDateTime(row.createdAt)}`),
      statusLabel: row.status,
      statusTone: statusToneForWorkflowStatus(row.status),
    })),
    ...(lockActive && lock?.heldBy
      ? [
          {
            title: "core-sync lock holder",
            meta: lock.heldBy,
            detail: lock.acquiredAt
              ? `Acquired ${formatDateTime(lock.acquiredAt)}`
              : "Lock is currently active.",
            statusLabel: "Running",
            statusTone: "info" as const,
          },
        ]
      : []),
  ]
  const statusCounts = countWorkflowStatuses([
    ...runtimeRows,
    ...workflowRowsWithoutRuntime,
  ])
  const dataSetErrorCount = syncRows.filter(
    (row) => parseSyncStats(row.stats).errors > 0,
  ).length
  const activeCount = statusCounts.active + (lockActive ? 1 : 0)
  const failedCount = statusCounts.failed + dataSetErrorCount

  return {
    metrics: [
      {
        label: "Active",
        value: activeCount.toString(),
        footer: "RUNNING_OR_QUEUED",
      },
      {
        label: "Completed",
        value: statusCounts.completed.toString(),
        footer: "RECENT_RUNS",
      },
      {
        label: "Failed",
        value: failedCount.toString(),
        footer: "LAST_RUN_ERRORS",
        accent: failedCount > 0 ? "danger" : undefined,
      },
    ],
    queue:
      queue.length > 0
        ? queue
        : [
            {
              title: "No workflow runs yet",
              meta: "waiting for the first runtime event",
              detail:
                "Workflow runs will appear here once scheduled jobs, manual jobs, or background backfills start.",
              statusLabel: "Idle",
              statusTone: "muted" as const,
            },
          ],
    workers:
      workerRows.length > 0
        ? workerRows.map((row) => ({
            title: row.id,
            meta: row.meta,
            detail: row.detail,
            statusLabel: row.statusLabel,
            statusTone: row.statusTone,
          }))
        : [
            {
              title: "No workflow workers seen yet",
              meta: "heartbeat missing",
              detail:
                "A worker row appears once an admin process starts Postgres World.",
              statusLabel: "Offline",
              statusTone: "muted" as const,
            },
          ],
    insights: [
      {
        label: "Postgres World",
        value:
          env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
            ? "Enabled"
            : "Local",
        detail:
          "Runtime run, step, and event rows are read from the selected Workflow World.",
      },
      {
        label: "Workflow API Keys",
        value: env.WORKFLOW_API_KEYS ? "Configured" : "Missing",
        detail: "Webhook and worker endpoints rely on workflow auth secrets.",
      },
      {
        label: "HMAC Secret",
        value: env.WORKFLOW_HMAC_SECRET ? "Configured" : "Missing",
        detail: "Request signing for workflow endpoints.",
      },
    ],
    syncLockHeld: lockActive,
  }
}

export async function loadEmbeddingsData(): Promise<EmbeddingsData> {
  const [counts, rows] = await Promise.all([
    getEmbeddingCounts(),
    getEmbeddingHealthRows(),
  ])
  const missing = Math.max(counts.total - counts.embedded, 0)

  return {
    metrics: [
      {
        label: "Embedded Rows",
        value: counts.embedded.toString(),
        footer: "EXPERIENCE_LOCALES",
      },
      {
        label: "Missing",
        value: missing.toString(),
        footer: "NULL_VECTORS",
      },
      {
        label: "Index Dim",
        value: "1536",
        footer: "PGVECTOR_HNSW",
      },
    ],
    rows: rows.map((row) => ({
      key: row.id,
      title: row.title?.trim() || row.slug,
      detail: `${row.locale} / ${row.slug}`,
      statusLabel: row.hasEmbedding ? "Ready" : "Missing",
      statusTone: row.hasEmbedding ? "success" : "warning",
      meta: `owner ${row.ownerId?.slice(0, 8) ?? "system"} / ${formatDateTime(row.updatedAt)}`,
    })),
    insights: [
      {
        label: "Provider",
        value: env.OPENROUTER_API_KEY
          ? "OpenRouter"
          : env.OPENAI_API_KEY
            ? "OpenAI"
            : "Missing",
        detail:
          "Embedding generation backend currently configured for admin workflows.",
      },
      {
        label: "Coverage",
        value:
          counts.total > 0
            ? `${Math.round((counts.embedded / counts.total) * 100)}%`
            : "0%",
        detail: "Share of locale rows with a stored semantic vector.",
      },
      {
        label: "Published Coverage",
        value: counts.published.toString(),
        detail: "Published locales participating in retrieval once embedded.",
      },
    ],
    providerReady: Boolean(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY),
  }
}

export async function loadLanguagesData(): Promise<LanguagesData> {
  const [languageCount, countryCount, localesInUse, rows] = await Promise.all([
    withTableFallback(
      () => prisma.language.count({ where: { deletedAt: null } }),
      0,
    ),
    withTableFallback(
      () => prisma.country.count({ where: { deletedAt: null } }),
      0,
    ),
    withTableFallback(async () => {
      const results = await prisma.experienceLocale.findMany({
        select: { locale: true },
        distinct: ["locale"],
      })
      return results.length
    }, 0),
    withTableFallback(
      () =>
        prisma.language.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            bcp47: true,
            iso3: true,
            slug: true,
            updatedAt: true,
            videoDubs: { select: { id: true }, take: 1 },
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
      [] as Array<{
        id: string
        bcp47: string | null
        iso3: string | null
        slug: string | null
        updatedAt: Date
        videoDubs: Array<{ id: string }>
      }>,
    ),
  ])

  return {
    metrics: [
      {
        label: "Languages",
        value: languageCount.toString(),
        footer: "REFERENCE_ROWS",
      },
      {
        label: "Countries",
        value: countryCount.toString(),
        footer: "ISO_MAPPED",
      },
      {
        label: "Locales In Use",
        value: localesInUse.toString(),
        footer: "CONTENT_ROWS",
      },
    ],
    rows: rows.map((row) => ({
      key: row.id,
      title: row.bcp47 ?? row.iso3 ?? row.slug ?? row.id,
      detail: `slug ${row.slug ?? "n/a"}`,
      statusLabel: row.videoDubs.length > 0 ? "Linked" : "Reference",
      statusTone: row.videoDubs.length > 0 ? "success" : "muted",
      meta: formatDateTime(row.updatedAt),
    })),
    insights: [
      {
        label: "Locale Footprint",
        value: localesInUse.toString(),
        detail:
          "Distinct locale codes currently present on experience content.",
      },
      {
        label: "Language Rows",
        value: languageCount.toString(),
        detail:
          "Reference languages synced from Core and available to the admin app.",
      },
      {
        label: "Country Rows",
        value: countryCount.toString(),
        detail: "Reference countries available for future admin workflows.",
      },
    ],
  }
}

export async function loadMediaData(principal: Principal): Promise<MediaData> {
  const services = createServices(prisma)
  const [total, images, videos, pdfs, processing, rows, folders, folderCounts] =
    await Promise.all([
      withTableFallback(() => prisma.mediaAsset.count(), 0),
      withTableFallback(
        () => prisma.mediaAsset.count({ where: { kind: "IMAGE" } }),
        0,
      ),
      withTableFallback(
        () => prisma.mediaAsset.count({ where: { kind: "VIDEO" } }),
        0,
      ),
      withTableFallback(
        () => prisma.mediaAsset.count({ where: { kind: "PDF" } }),
        0,
      ),
      withTableFallback(
        () =>
          prisma.mediaAsset.count({
            where: { status: { in: ["PENDING", "UPLOADING", "PROCESSING"] } },
          }),
        0,
      ),
      withTableFallback(
        () =>
          services.mediaAsset.list({
            input: { limit: 120, offset: 0 },
            user: principal,
            query: {
              include: {
                locales: {
                  where: { locale: "en" },
                  select: { locale: true, displayName: true },
                  take: 1,
                },
              },
            },
          }),
        [] as MediaAssetWithEnglishLocale[],
      ),
      withTableFallback(
        () =>
          services.mediaFolder.list({
            input: {},
            user: principal,
            query: {},
          }),
        [] as Awaited<ReturnType<typeof services.mediaFolder.list>>,
      ),
      withTableFallback(
        () =>
          prisma.mediaAsset.groupBy({
            by: ["folderId"],
            _count: { _all: true },
          }),
        [] as Array<{
          folderId: string | null
          _count: { _all: number }
        }>,
      ),
    ])

  const directFolderCount = new Map<string | null, number>()
  for (const row of folderCounts) {
    directFolderCount.set(row.folderId, row._count._all)
  }

  const foldersByParent = new Map<string | null, typeof folders>()
  for (const folder of folders) {
    const siblings = foldersByParent.get(folder.parentId) ?? []
    siblings.push(folder)
    foldersByParent.set(folder.parentId, siblings)
  }

  const flattenedFolders: MediaFolderRow[] = []

  function visit(parentId: string | null, depth: number): number {
    const siblings = foldersByParent.get(parentId) ?? []
    let branchCount = 0

    for (const folder of siblings) {
      const ownCount = directFolderCount.get(folder.id) ?? 0
      const childFolders = foldersByParent.get(folder.id) ?? []
      flattenedFolders.push({
        id: folder.id,
        label: folder.name,
        count: ownCount,
        directAssetCount: ownCount,
        childFolderCount: childFolders.length,
        parentId: folder.parentId,
        depth,
      })
      const childCount = visit(folder.id, depth + 1)
      const totalCount = ownCount + childCount
      branchCount += totalCount
    }

    return branchCount
  }

  visit(null, 0)
  const unfiledCount = directFolderCount.get(null) ?? 0

  return {
    metrics: [
      {
        label: "Assets",
        value: total.toString(),
        footer: "MEDIA_ASSET_ROWS",
      },
      {
        label: "Images",
        value: images.toString(),
        footer: "IMAGE_LIBRARY",
      },
      {
        label: "Processing",
        value: processing.toString(),
        footer: "ACTIVE_UPLOADS",
      },
    ],
    folders: flattenedFolders,
    rows: rows.map((row) => {
      const displayName = localizedMediaAssetLabel(row)
      const showEnrichmentStatus =
        row.kind === "IMAGE" &&
        row.imageEnrichmentStatus !== "COMPLETE" &&
        row.imageEnrichmentStatus !== "SKIPPED"

      return {
        key: row.id,
        title: displayName,
        detail: mediaSupplementalLabel(
          displayName,
          row.originalFilename,
          row.mimeType,
        ),
        statusLabel: showEnrichmentStatus
          ? row.imageEnrichmentStatus
          : row.status,
        statusTone: showEnrichmentStatus
          ? statusToneForImageEnrichment(row.imageEnrichmentStatus)
          : statusToneForMediaAsset(row.status),
        meta: formatDateTime(row.updatedAt),
        kind: row.kind,
        folderId: row.folderId ?? null,
        backend: row.backend,
        byteSize: formatBytes(row.byteSize),
        byteSizeValue: row.byteSize,
        dimensions: mediaDimensions(row),
        previewUrl: mediaAssetPreviewUrl(row),
        downloadUrl: mediaAssetDownloadUrl(row),
        blurDataUrl: row.blurDataUrl,
        imageEnrichmentStatus: row.imageEnrichmentStatus,
        imageEnrichmentErrorMessage: row.imageEnrichmentErrorMessage,
        updatedAtValue: row.updatedAt,
      }
    }),
    insights: [
      {
        label: "Image Assets",
        value: images.toString(),
        detail: "Reusable image files registered in the admin media library.",
      },
      {
        label: "Video Assets",
        value: videos.toString(),
        detail: "Video placeholders ready for the future Mux storage backend.",
      },
      {
        label: "PDF Assets",
        value: pdfs.toString(),
        detail: "Document uploads tracked by the generic asset model.",
      },
    ],
    totalCount: total,
    unfiledCount,
  }
}

export async function loadUsersData(): Promise<UsersData> {
  const [counts, rows] = await Promise.all([
    getUserRoleCounts(),
    withTableFallback(
      () =>
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            role: true,
            emailVerified: true,
            updatedAt: true,
            sessions: { select: { id: true }, take: 1 },
            accounts: { select: { providerId: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
      [] as Array<{
        id: string
        email: string
        role: string
        emailVerified: boolean
        updatedAt: Date
        sessions: Array<{ id: string }>
        accounts: Array<{ providerId: string }>
      }>,
    ),
  ])

  return {
    metrics: [
      {
        label: "Admins",
        value: counts.admins.toString(),
        footer: "GLOBAL_OVERRIDE",
      },
      {
        label: "Editors",
        value: counts.editors.toString(),
        footer: "CONTENT_OPERATORS",
      },
      {
        label: "Viewers",
        value: counts.viewers.toString(),
        footer: "READ_ONLY",
      },
    ],
    rows: rows.map((row) => ({
      key: row.id,
      title: row.email,
      detail:
        row.accounts.map((account) => account.providerId).join(", ") ||
        "email-password",
      statusLabel: row.emailVerified ? row.role : "UNVERIFIED",
      statusTone: row.emailVerified ? "success" : "warning",
      meta: `${row.sessions.length} session(s) / ${formatDateTime(row.updatedAt)}`,
    })),
    insights: [
      {
        label: "Active Sessions",
        value: counts.sessions.toString(),
        detail: "Current Better Auth session rows persisted in Postgres.",
      },
      {
        label: "Linked Accounts",
        value: counts.accounts.toString(),
        detail: "External auth/account records attached to users.",
      },
      {
        label: "SSO Providers",
        value: providerCount().toString(),
        detail: "Social/OIDC providers currently configured by environment.",
      },
    ],
  }
}

export async function loadSettingsData(): Promise<SettingsData> {
  const trustedOrigins = env.AUTH_TRUSTED_ORIGINS
    ? env.AUTH_TRUSTED_ORIGINS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  const corsOrigins = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []

  const rows: TableRow[] = [
    {
      key: "better-auth",
      title: "Better Auth secret",
      detail: "Session signing secret",
      statusLabel: env.BETTER_AUTH_SECRET ? "Configured" : "Missing",
      statusTone: env.BETTER_AUTH_SECRET ? "success" : "danger",
      meta: env.BETTER_AUTH_URL ?? "default localhost URL",
    },
    {
      key: "redis",
      title: "Redis",
      detail: "Shared rate limit backend",
      statusLabel: env.REDIS_HOST ? "Configured" : "Fallback",
      statusTone: env.REDIS_HOST ? "success" : "warning",
      meta: env.REDIS_HOST
        ? `${env.REDIS_HOST}:${env.REDIS_PORT ?? 6379}`
        : "local in-process fallback",
    },
    {
      key: "core",
      title: "Core API",
      detail: "Upstream sync dependency",
      statusLabel:
        env.CORE_API_URL && env.CORE_API_TOKEN ? "Configured" : "Missing",
      statusTone: env.CORE_API_URL && env.CORE_API_TOKEN ? "success" : "danger",
      meta: env.CORE_API_URL ?? "not configured",
    },
    {
      key: "storage",
      title: "Storage",
      detail: "Artifact and media backing store",
      statusLabel: env.RAILWAY_S3_BUCKET ? "S3" : "Local",
      statusTone: env.RAILWAY_S3_BUCKET ? "info" : "warning",
      meta: env.RAILWAY_S3_BUCKET ?? ".artifacts local fallback",
    },
  ]

  return {
    metrics: [
      {
        label: "Providers",
        value: providerCount().toString(),
        footer: "SSO_ENABLED",
      },
      {
        label: "Trusted Origins",
        value: trustedOrigins.length.toString(),
        footer: "AUTH_TRUSTED",
      },
      {
        label: "CORS Origins",
        value: corsOrigins.length.toString(),
        footer: "GRAPHQL_ALLOWLIST",
      },
    ],
    rows,
    insights: [
      {
        label: "GraphQL Introspection",
        value:
          env.GRAPHQL_INTROSPECTION_ENABLED === "true" ? "Enabled" : "Disabled",
        detail:
          "Production should generally keep this disabled except controlled debugging windows.",
      },
      {
        label: "Workflow Signing",
        value: env.WORKFLOW_HMAC_SECRET ? "Configured" : "Missing",
        detail: "Signature verification for workflow delivery.",
      },
      {
        label: "Embedding Backend",
        value: env.OPENROUTER_API_KEY
          ? "OpenRouter"
          : env.OPENAI_API_KEY
            ? "OpenAI"
            : "Missing",
        detail: "Provider used for admin-side semantic embedding generation.",
      },
    ],
  }
}

export async function runSemanticSearch(params: {
  queryText?: string
  locale?: string
  user: Principal
}): Promise<SearchData> {
  const queryText = params.queryText?.trim() ?? ""
  const locale = params.locale?.trim() ?? "en"
  const embeddingCounts = await getEmbeddingCounts()
  const providerReady = Boolean(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY)

  const metrics: Metric[] = [
    {
      label: "Embedded Rows",
      value: embeddingCounts.embedded.toString(),
      footer: "SEARCHABLE",
    },
    {
      label: "Published Rows",
      value: embeddingCounts.published.toString(),
      footer: "PUBLIC_SCOPE",
    },
    {
      label: "Provider",
      value: providerReady ? "Ready" : "Missing",
      footer: "TEXT_TO_VECTOR",
    },
  ]

  const insights: Insight[] = [
    {
      label: "Locale",
      value: locale,
      detail: "Search results are filtered to this locale when possible.",
    },
    {
      label: "Vector Dimension",
      value: "1536",
      detail: "Experience semantic search expects 1536-dimension vectors.",
    },
    {
      label: "Input",
      value: queryText ? `${queryText.length} chars` : "Idle",
      detail: "Text is embedded server-side before pgvector retrieval.",
    },
  ]

  if (!queryText) {
    return {
      metrics,
      insights,
      results: [],
      queryText,
      locale,
      unavailableReason: providerReady
        ? null
        : "No embedding provider configured.",
    }
  }

  if (!providerReady) {
    return {
      metrics,
      insights,
      results: [],
      queryText,
      locale,
      unavailableReason:
        "Semantic search requires OPENROUTER_API_KEY or OPENAI_API_KEY.",
    }
  }

  try {
    const embedding = await generateExperienceEmbedding(queryText)
    const services = createServices(prisma)
    const results = await withTableFallback(
      () =>
        services.experienceSearch.search({
          vector: embedding.embedding,
          locale,
          user: params.user,
          query: {
            include: {
              experience: {
                select: { ownerId: true },
              },
            },
          },
        }),
      [],
    )

    return {
      metrics,
      insights,
      queryText,
      locale,
      unavailableReason: null,
      results: results.map((row) => ({
        id: row.id,
        title: row.title?.trim() || row.slug,
        slug: row.slug,
        locale: row.locale,
        status: row.status,
        owner: "n/a",
        updated: formatDateTime(row.updatedAt),
      })),
    }
  } catch (error) {
    return {
      metrics,
      insights,
      queryText,
      locale,
      results: [],
      unavailableReason:
        error instanceof Error ? error.message : "Search execution failed.",
    }
  }
}
