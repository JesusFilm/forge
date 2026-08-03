import {
  Prisma,
  type LocaleStatus,
  type MediaAssetKind,
  type MediaImageEnrichmentStatus,
  type MediaAssetStatus,
  type SourceTier,
  type UserRole,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { createServices } from "@/services"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import { DEFAULT_SYNC_LOCK_STALE_AFTER_MS } from "@/services/core-sync/lock"
import { getAllWatermarks } from "@/services/core-sync/watermark"
import {
  loadMastraStudioAccessByEmail,
  type MastraStudioAccessRole,
} from "@/services/mastra-studio-access.service"
import {
  mediaAssetDownloadUrl,
  mediaAssetPreviewUrl,
} from "@/services/media-asset.service"
import { loadWorkflowRuntimeRuns } from "@/services/workflow-runtime.service"
import { loadWorkflowWorkerStatusRows } from "@/services/workflow-worker-heartbeat.service"
import { normalizeVideoThumbnailUrl } from "@/app/dashboard/video-library-utils"

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
  statusTone: DashboardStatusTone
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
  statusTone: DashboardStatusTone
  meta: string
}

export type DashboardStatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted"

type UserProductAccessRoleValue =
  | "NO_ACCESS"
  | "OPERATOR"
  | "STUDIO_ACCESS"
  | UserRole

type UserProductAccessRoleOption = {
  value: UserProductAccessRoleValue
  label: string
}

export type UserProductAccess = {
  key: "admin" | "manager" | "mastra-studio"
  label: string
  selectedRole: UserProductAccessRoleValue
  roleOptions: UserProductAccessRoleOption[]
  statusTone: DashboardStatusTone
  disabled: boolean
  backed: boolean
  helperText: string
}

export type UserTableRow = TableRow & {
  productAccess: UserProductAccess[]
}

const ADMIN_ROLE_OPTIONS = [
  { value: "NO_ACCESS", label: "No access" },
  { value: "VIEWER", label: "Viewer" },
  { value: "EDITOR", label: "Editor" },
  { value: "ADMIN", label: "Admin" },
] satisfies UserProductAccessRoleOption[]

const MANAGER_ROLE_OPTIONS = [
  { value: "NO_ACCESS", label: "No access" },
  { value: "OPERATOR", label: "Operator" },
] satisfies UserProductAccessRoleOption[]

const MASTRA_STUDIO_ROLE_OPTIONS = [
  { value: "NO_ACCESS", label: "No access" },
  { value: "STUDIO_ACCESS", label: "Studio access" },
] satisfies UserProductAccessRoleOption[]

export type UserAccessSourceRow = {
  id: string
  email: string
  role: UserRole
  emailVerified: boolean
  updatedAt: Date
  managerMembership: {
    role: "OPERATOR"
    revokedAt: Date | null
  } | null
  mastraStudioAccess?: {
    selectedRole: MastraStudioAccessRole
    disabled: boolean
    helperText: string
  }
}

type UserAccessBaseRow = Omit<UserAccessSourceRow, "managerMembership">

type UserAccessMembershipRow = {
  userId: string
  role: "OPERATOR"
  revokedAt: Date | null
}

export type LanguageDiagnosticTone = DashboardStatusTone

export type LanguageDiagnosticName = {
  locale: string
  value: string
  primary: boolean
}

export type LanguageDiagnosticCountryPreview = {
  id: string
  coreId: string
  label: string
  continentLabel: string | null
  flagUrl: string | null
  speakers: string
  primary: boolean
  suggested: boolean
  order: number | null
}

export type LanguageDiagnosticCounts = {
  countryLanguages: number
  videoDubs: number
  videoSubtitles: number
  studyQuestions: number
  primaryVideos: number
  totalContentLinks: number
}

export type LanguageDiagnosticRow = {
  id: string
  coreId: string
  source: string
  title: string
  subtitle: string
  codeLabel: string
  bcp47: string | null
  iso3: string | null
  slug: string | null
  statusLabel: string
  statusTone: LanguageDiagnosticTone
  syncLabel: string
  syncTone: LanguageDiagnosticTone
  names: LanguageDiagnosticName[]
  countryPreviews: LanguageDiagnosticCountryPreview[]
  counts: LanguageDiagnosticCounts
  audioPreview: {
    available: boolean
    value: string | null
    duration: string | null
    size: string | null
    bitrate: string | null
    codec: string | null
  }
  timestamps: {
    createdAt: string
    createdAtIso: string
    updatedAt: string
    updatedAtIso: string
    syncedAt: string
    syncedAtIso: string | null
  }
  flags: {
    linked: boolean
    referenceOnly: boolean
    missingMetadata: boolean
    countryLinked: boolean
    hasDubs: boolean
    hasSubtitles: boolean
    hasStudyQuestions: boolean
    primaryVideoLanguage: boolean
    hasAudioPreview: boolean
    coreSynced: boolean
    syncMissing: boolean
    updatedAfterSync: boolean
    nonCoreSource: boolean
  }
  searchText: string
}

export type LanguageDiagnosticsSummary = {
  softDeletedLanguages: number
  lastSyncedAt: string
  lastSyncedAtIso: string | null
  lastSyncStats: Array<{ key: string; value: string }>
}

export type LanguageDiagnosticSourceRow = {
  id: string
  coreId: string
  source: SourceTier
  name: Prisma.JsonValue
  bcp47: string | null
  iso3: string | null
  slug: string | null
  audioPreviewValue: string | null
  audioPreviewDuration: number | null
  audioPreviewSize: bigint | null
  audioPreviewBitrate: number | null
  audioPreviewCodec: string | null
  syncedAt: Date | null
  createdAt: Date
  updatedAt: Date
  locales: Array<{
    id: string
    locale: string
    value: string
    primary: boolean
    order: number | null
  }>
  countryLanguages: Array<{
    id: string
    coreId: string | null
    speakers: number | null
    displaySpeakers: string | null
    primary: boolean | null
    suggested: boolean | null
    order: number | null
    country: {
      id: string
      coreId: string
      name: Prisma.JsonValue
      flagPngSrc: string | null
      flagWebpSrc: string | null
      continent: {
        coreId: string
        name: Prisma.JsonValue
      } | null
    }
  }>
  _count: {
    countryLanguages: number
    videoDubs: number
    videoSubtitles: number
    studyQuestions: number
    videosAsPrimary: number
  }
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
    statusTone: DashboardStatusTone
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
  diagnosticRows: LanguageDiagnosticRow[]
  diagnostics: LanguageDiagnosticsSummary
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
  rows: UserTableRow[]
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

export type WatchSearchAnalyticsResultRow = {
  id: string
  type: string
  slug: string | null
  title: string | null
  description: string | null
  imageUrl: string | null
  score: number | null
  scoreBreakdown: {
    total: number
    sourceRelevance: number
    evidenceBoost: number
    relevance: number
    availability: number
    match: number
    sourceScore: number
  }
  availabilityKind: string
  evidenceKind: string
  actionKind: string
  clicked: boolean
  position: number
}

export type WatchSearchAnalyticsLaneRow = {
  lane: string
  status: string
  startedOffsetMs: number
  elapsedMs: number | null
  resultCount: number | null
  reason: string | null
  detail: string | null
}

export type WatchSearchAnalyticsRequestRow = {
  id: string
  requestId: string
  queryText: string
  locale: string
  targetLanguageSlug: string
  targetLanguageLabel: string
  targetLanguageSource: string
  queryNamedLanguageSlug: string | null
  searchMode: string
  outcome: string
  resultCount: number
  latencyMs: number | null
  clickedPosition: number | null
  clickCount: number
  createdAt: string
  createdAtIso: string
  results: WatchSearchAnalyticsResultRow[]
  lanes: WatchSearchAnalyticsLaneRow[]
}

export type WatchSearchAnalyticsData = {
  metrics: Metric[]
  insights: Insight[]
  requests: WatchSearchAnalyticsRequestRow[]
  selectedRequest: WatchSearchAnalyticsRequestRow | null
  window: WatchSearchAnalyticsWindow
}

export type WatchSearchAnalyticsWindow = "24h" | "7d" | "30d"

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

function formatPercent(numerator: number, denominator: number) {
  if (denominator === 0) return "0%"
  return `${Math.round((numerator / denominator) * 100)}%`
}

function formatNullableDateTime(value: Date | null) {
  return value ? formatDateTime(value) : "None"
}

function configuredEmbeddingBackend(): "OpenRouter" | "Fireworks" | null {
  if (env.QUERY_EMBEDDING_PROVIDER === "fireworks") {
    return env.FIREWORKS_API_KEY ? "Fireworks" : null
  }
  if (env.OPENROUTER_API_PAID_KEY ?? env.OPENROUTER_API_KEY) {
    return "OpenRouter"
  }
  if (env.FIREWORKS_API_KEY) {
    return "Fireworks"
  }
  return null
}

function embeddingBackendUnavailableReason(): string {
  if (env.QUERY_EMBEDDING_PROVIDER === "fireworks") {
    return "Semantic search requires FIREWORKS_API_KEY when QUERY_EMBEDDING_PROVIDER=fireworks."
  }
  return "Semantic search requires OPENROUTER_API_PAID_KEY, OPENROUTER_API_KEY, or FIREWORKS_API_KEY."
}

function formatAudioPreviewBytes(value: bigint | null) {
  if (value === null) return null

  const bytes = Number(value)
  if (!Number.isSafeInteger(bytes)) {
    return `${value.toString()} B`
  }

  const units = ["B", "KB", "MB", "GB"]
  let amount = bytes
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return unitIndex === 0
    ? `${amount} ${units[unitIndex]}`
    : `${amount.toFixed(1)} ${units[unitIndex]}`
}

function formatJsonValue(value: Prisma.JsonValue): string {
  if (value === null) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return JSON.stringify(value)
}

function jsonObjectEntries(value: Prisma.JsonValue) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return []
  }

  return Object.entries(value)
    .filter(
      (entry): entry is [string, Prisma.JsonValue] =>
        typeof entry[0] === "string",
    )
    .map(([key, jsonValue]) => ({
      key,
      value: formatJsonValue(jsonValue),
    }))
}

function localizedNameEntries(row: LanguageDiagnosticSourceRow) {
  const localeEntries = row.locales
    .map((locale) => ({
      locale: locale.locale,
      value: locale.value.trim(),
      primary: locale.primary,
      order: locale.order,
    }))
    .filter((entry) => entry.value.length > 0)
  const seenLocales = new Set(localeEntries.map((entry) => entry.locale))
  const mapEntries = jsonObjectEntries(row.name)
    .map((entry) => ({ ...entry, value: entry.value.trim() }))
    .filter((entry) => entry.value.length > 0)
    .filter((entry) => !seenLocales.has(entry.key))
    .map((entry) => ({
      locale: entry.key,
      value: entry.value,
      primary: false,
      order: null,
    }))

  return [...localeEntries, ...mapEntries]
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1
      if (left.locale === "en") return -1
      if (right.locale === "en") return 1
      return (left.order ?? 9999) - (right.order ?? 9999)
    })
    .map(({ locale, value, primary }) => ({ locale, value, primary }))
}

function displayNameFromJson(value: Prisma.JsonValue, fallback: string) {
  const entries = jsonObjectEntries(value)
    .map((entry) => ({ ...entry, value: entry.value.trim() }))
    .filter((entry) => entry.value.length > 0)
  return (
    entries.find((entry) => entry.key === "en")?.value ??
    entries[0]?.value ??
    fallback
  )
}

function displayLanguageTitle(
  names: LanguageDiagnosticName[],
  row: LanguageDiagnosticSourceRow,
) {
  return (
    names.find((name) => name.locale === "en")?.value ??
    names.find((name) => name.primary)?.value ??
    names[0]?.value ??
    row.bcp47 ??
    row.iso3 ??
    row.slug ??
    row.coreId ??
    row.id
  )
}

function displayCodeLabel(row: LanguageDiagnosticSourceRow) {
  const codes = [row.bcp47, row.iso3, row.slug]
    .filter((value): value is string => Boolean(value))
    .join(" / ")
  return codes || "No language codes"
}

function syncStateFor(row: LanguageDiagnosticSourceRow) {
  const nonCoreSource = row.source !== "CORE"
  const syncMissing = !row.syncedAt
  const updatedAfterSync = Boolean(
    row.syncedAt && row.updatedAt.getTime() > row.syncedAt.getTime(),
  )

  if (nonCoreSource) {
    return {
      label: "Non-Core source",
      tone: "info" as const,
      nonCoreSource,
      syncMissing,
      updatedAfterSync,
      coreSynced: false,
    }
  }

  if (syncMissing) {
    return {
      label: "Sync missing",
      tone: "warning" as const,
      nonCoreSource,
      syncMissing,
      updatedAfterSync,
      coreSynced: false,
    }
  }

  if (updatedAfterSync) {
    return {
      label: "Updated after sync",
      tone: "warning" as const,
      nonCoreSource,
      syncMissing,
      updatedAfterSync,
      coreSynced: false,
    }
  }

  return {
    label: "Core synced",
    tone: "success" as const,
    nonCoreSource,
    syncMissing,
    updatedAfterSync,
    coreSynced: true,
  }
}

function syncStatsEntries(value: Prisma.JsonValue | null | undefined) {
  if (!value) return []

  return jsonObjectEntries(value)
    .slice(0, 8)
    .map((entry) => ({ key: entry.key, value: entry.value }))
}

export function buildLanguageDiagnosticRow(
  row: LanguageDiagnosticSourceRow,
): LanguageDiagnosticRow {
  const names = localizedNameEntries(row)
  const title = displayLanguageTitle(names, row)
  const codeLabel = displayCodeLabel(row)
  const counts: LanguageDiagnosticCounts = {
    countryLanguages: row._count.countryLanguages,
    videoDubs: row._count.videoDubs,
    videoSubtitles: row._count.videoSubtitles,
    studyQuestions: row._count.studyQuestions,
    primaryVideos: row._count.videosAsPrimary,
    totalContentLinks:
      row._count.videoDubs +
      row._count.videoSubtitles +
      row._count.studyQuestions +
      row._count.videosAsPrimary,
  }
  const hasAudioPreview = Boolean(
    row.audioPreviewValue?.trim() ||
    row.audioPreviewDuration !== null ||
    row.audioPreviewSize !== null ||
    row.audioPreviewBitrate !== null ||
    row.audioPreviewCodec?.trim(),
  )
  const missingMetadata =
    !row.bcp47 || !row.iso3 || !row.slug || names.length === 0
  const syncState = syncStateFor(row)
  const linked = counts.totalContentLinks > 0
  const statusLabel = missingMetadata
    ? "Missing metadata"
    : linked
      ? "Linked"
      : "Reference only"
  const statusTone: LanguageDiagnosticTone = missingMetadata
    ? "warning"
    : linked
      ? "success"
      : "muted"
  const countryPreviews = row.countryLanguages.map((countryLanguage) => ({
    id: countryLanguage.id,
    coreId: countryLanguage.country.coreId,
    label: displayNameFromJson(
      countryLanguage.country.name,
      countryLanguage.country.coreId,
    ),
    continentLabel: countryLanguage.country.continent
      ? displayNameFromJson(
          countryLanguage.country.continent.name,
          countryLanguage.country.continent.coreId,
        )
      : null,
    flagUrl:
      countryLanguage.country.flagWebpSrc ??
      countryLanguage.country.flagPngSrc ??
      null,
    speakers:
      countryLanguage.displaySpeakers ??
      countryLanguage.speakers?.toLocaleString("en-US") ??
      "Unknown speakers",
    primary: Boolean(countryLanguage.primary),
    suggested: Boolean(countryLanguage.suggested),
    order: countryLanguage.order,
  }))
  const flagLabels = [
    linked && "Linked",
    !linked && "Reference only",
    missingMetadata && "Missing metadata",
    counts.countryLanguages > 0 && "Country linked",
    counts.countryLanguages === 0 && "No country links",
    counts.videoDubs > 0 && "Has dubs",
    counts.videoSubtitles > 0 && "Has subtitles",
    counts.studyQuestions > 0 && "Has study questions",
    counts.primaryVideos > 0 && "Primary video language",
    hasAudioPreview && "Audio preview",
    syncState.label,
  ].filter((value): value is string => Boolean(value))

  return {
    id: row.id,
    coreId: row.coreId,
    source: row.source,
    title,
    subtitle: codeLabel,
    codeLabel,
    bcp47: row.bcp47,
    iso3: row.iso3,
    slug: row.slug,
    statusLabel,
    statusTone,
    syncLabel: syncState.label,
    syncTone: syncState.tone,
    names,
    countryPreviews,
    counts,
    audioPreview: {
      available: hasAudioPreview,
      value: row.audioPreviewValue,
      duration:
        row.audioPreviewDuration === null
          ? null
          : `${row.audioPreviewDuration}s`,
      size: formatAudioPreviewBytes(row.audioPreviewSize),
      bitrate:
        row.audioPreviewBitrate === null
          ? null
          : `${row.audioPreviewBitrate} kbps`,
      codec: row.audioPreviewCodec,
    },
    timestamps: {
      createdAt: formatDateTime(row.createdAt),
      createdAtIso: row.createdAt.toISOString(),
      updatedAt: formatDateTime(row.updatedAt),
      updatedAtIso: row.updatedAt.toISOString(),
      syncedAt: formatNullableDateTime(row.syncedAt),
      syncedAtIso: row.syncedAt?.toISOString() ?? null,
    },
    flags: {
      linked,
      referenceOnly: !linked,
      missingMetadata,
      countryLinked: counts.countryLanguages > 0,
      hasDubs: counts.videoDubs > 0,
      hasSubtitles: counts.videoSubtitles > 0,
      hasStudyQuestions: counts.studyQuestions > 0,
      primaryVideoLanguage: counts.primaryVideos > 0,
      hasAudioPreview,
      coreSynced: syncState.coreSynced,
      syncMissing: syncState.syncMissing,
      updatedAfterSync: syncState.updatedAfterSync,
      nonCoreSource: syncState.nonCoreSource,
    },
    searchText: [
      row.id,
      row.coreId,
      row.source,
      title,
      codeLabel,
      row.bcp47,
      row.iso3,
      row.slug,
      statusLabel,
      syncState.label,
      ...names.flatMap((name) => [name.locale, name.value]),
      ...countryPreviews.flatMap((country) => [
        country.coreId,
        country.label,
        country.continentLabel,
        country.speakers,
      ]),
      ...flagLabels,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase(),
  }
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
          where: { deletedAt: null },
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
        locale: string | null
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
      title: row.title?.trim() || `Video locale ${row.locale ?? "unmapped"}`,
      detail: row.locale ?? "No public locale",
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
      const [admins, editors, viewers] = await Promise.all([
        prisma.user.count({ where: { role: "ADMIN" } }),
        prisma.user.count({ where: { role: "EDITOR" } }),
        prisma.user.count({ where: { role: "VIEWER" } }),
      ])
      return { admins, editors, viewers }
    },
    { admins: 0, editors: 0, viewers: 0 },
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
        detail: "Local admin role mappings for Auth SSO principals.",
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
      row.error ??
      row.summary ??
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
  const embeddingBackend = configuredEmbeddingBackend()

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
        value: embeddingBackend ?? "Missing",
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
    providerReady: embeddingBackend != null,
  }
}

export async function loadLanguagesData(): Promise<LanguagesData> {
  const [
    languageCount,
    countryCount,
    localesInUse,
    softDeletedLanguages,
    rows,
    syncState,
  ] = await Promise.all([
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
      () => prisma.language.count({ where: { deletedAt: { not: null } } }),
      0,
    ),
    withTableFallback(
      () =>
        prisma.language.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            coreId: true,
            source: true,
            name: true,
            bcp47: true,
            iso3: true,
            slug: true,
            audioPreviewValue: true,
            audioPreviewDuration: true,
            audioPreviewSize: true,
            audioPreviewBitrate: true,
            audioPreviewCodec: true,
            syncedAt: true,
            createdAt: true,
            updatedAt: true,
            locales: {
              where: { deletedAt: null },
              select: {
                id: true,
                locale: true,
                value: true,
                primary: true,
                order: true,
              },
              orderBy: [
                { primary: "desc" },
                { order: "asc" },
                { locale: "asc" },
              ],
            },
            countryLanguages: {
              where: { deletedAt: null },
              select: {
                id: true,
                coreId: true,
                speakers: true,
                displaySpeakers: true,
                primary: true,
                suggested: true,
                order: true,
                country: {
                  select: {
                    id: true,
                    coreId: true,
                    name: true,
                    flagPngSrc: true,
                    flagWebpSrc: true,
                    continent: {
                      select: {
                        coreId: true,
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: [
                { primary: "desc" },
                { suggested: "desc" },
                { order: "asc" },
              ],
              take: 8,
            },
            _count: {
              select: {
                countryLanguages: { where: { deletedAt: null } },
                videoDubs: { where: { deletedAt: null } },
                videoSubtitles: { where: { deletedAt: null } },
                studyQuestions: { where: { deletedAt: null } },
                videosAsPrimary: { where: { deletedAt: null } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
      [] as LanguageDiagnosticSourceRow[],
    ),
    withTableFallback(
      () =>
        prisma.syncState.findUnique({
          where: { phase: "languages" },
          select: { lastSyncedAt: true, stats: true },
        }),
      null as { lastSyncedAt: Date; stats: Prisma.JsonValue } | null,
    ),
  ])
  const diagnosticRows = rows
    .map((row) => buildLanguageDiagnosticRow(row))
    .sort((left, right) =>
      left.title.localeCompare(right.title, "en", { sensitivity: "base" }),
    )
  const linkedLanguages = diagnosticRows.filter(
    (row) => row.flags.linked,
  ).length
  const missingMetadata = diagnosticRows.filter(
    (row) => row.flags.missingMetadata,
  ).length

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
    diagnosticRows,
    diagnostics: {
      softDeletedLanguages,
      lastSyncedAt: formatNullableDateTime(syncState?.lastSyncedAt ?? null),
      lastSyncedAtIso: syncState?.lastSyncedAt.toISOString() ?? null,
      lastSyncStats: syncStatsEntries(syncState?.stats),
    },
    insights: [
      {
        label: "Locale Footprint",
        value: localesInUse.toString(),
        detail:
          "Distinct locale codes currently present on experience content.",
      },
      {
        label: "Linked Languages",
        value: linkedLanguages.toString(),
        detail:
          "Active reference languages with at least one content relationship.",
      },
      {
        label: "Metadata Gaps",
        value: missingMetadata.toString(),
        detail: "Active languages missing codes, slugs, or localized names.",
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
  const [counts, userRows] = await Promise.all([
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
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
      [] as UserAccessBaseRow[],
    ),
  ])
  const userIds = userRows.map((row) => row.id)
  const managerMemberships =
    userIds.length > 0
      ? await withTableFallback(
          () =>
            prisma.managerMembership.findMany({
              where: { userId: { in: userIds } },
              select: {
                userId: true,
                role: true,
                revokedAt: true,
              },
            }),
          [] as UserAccessMembershipRow[],
        )
      : []
  const managerMembershipByUserId = new Map(
    managerMemberships.map((membership) => [membership.userId, membership]),
  )
  const mastraStudioAccess = await loadMastraStudioAccessByEmail(
    userRows.map((row) => row.email),
  )
  const rows = userRows.map((row): UserAccessSourceRow => {
    const managerMembership = managerMembershipByUserId.get(row.id)
    const mastraStudioEmail = row.email.trim().toLowerCase()
    return {
      ...row,
      managerMembership: managerMembership
        ? {
            role: managerMembership.role,
            revokedAt: managerMembership.revokedAt,
          }
        : null,
      mastraStudioAccess: {
        selectedRole:
          mastraStudioAccess.accessByEmail.get(mastraStudioEmail) ??
          "NO_ACCESS",
        disabled: mastraStudioAccess.disabled,
        helperText: mastraStudioAccess.helperText,
      },
    }
  })

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
        label: "Access Requests",
        value: counts.viewers.toString(),
        footer: "PENDING_APPROVAL",
      },
    ],
    rows: rows.map(buildUserTableRow),
    insights: [
      {
        label: "Role Mappings",
        value: (counts.admins + counts.editors + counts.viewers).toString(),
        detail:
          "Admin-local roles keyed by Auth SSO subject or verified email.",
      },
      {
        label: "Access Requests",
        value: counts.viewers.toString(),
        detail: "Signed-in users waiting for admin approval.",
      },
      {
        label: "Auth Issuer",
        value: new URL(env.AUTH_ISSUER_URL).host,
        detail: "Standalone Auth service used for admin OAuth.",
      },
    ],
  }
}

export function buildUserTableRow(row: UserAccessSourceRow): UserTableRow {
  const hasManagerAccess = Boolean(
    row.managerMembership && !row.managerMembership.revokedAt,
  )
  const mastraStudioAccess = row.mastraStudioAccess ?? {
    selectedRole: "NO_ACCESS" as const,
    disabled: true,
    helperText: "Configure",
  }
  const hasMastraStudioAccess =
    mastraStudioAccess.selectedRole === "STUDIO_ACCESS"

  return {
    key: row.id,
    title: row.email,
    detail: row.id,
    statusLabel: row.emailVerified ? row.role : "UNVERIFIED",
    statusTone:
      !row.emailVerified || row.role === "VIEWER" ? "warning" : "success",
    meta: formatDateTime(row.updatedAt),
    productAccess: [
      {
        key: "admin",
        label: "Admin",
        selectedRole: row.emailVerified ? row.role : "NO_ACCESS",
        roleOptions: ADMIN_ROLE_OPTIONS,
        statusTone:
          !row.emailVerified || row.role === "VIEWER" ? "warning" : "success",
        disabled: true,
        backed: false,
        helperText: "Status role",
      },
      {
        key: "manager",
        label: "Manager",
        selectedRole: hasManagerAccess ? "OPERATOR" : "NO_ACCESS",
        roleOptions: MANAGER_ROLE_OPTIONS,
        statusTone: hasManagerAccess ? "success" : "muted",
        disabled: false,
        backed: true,
        helperText: "Backed",
      },
      {
        key: "mastra-studio",
        label: "Mastra Studio",
        selectedRole: mastraStudioAccess.selectedRole,
        roleOptions: MASTRA_STUDIO_ROLE_OPTIONS,
        statusTone: hasMastraStudioAccess ? "success" : "muted",
        disabled: mastraStudioAccess.disabled,
        backed: !mastraStudioAccess.disabled,
        helperText: mastraStudioAccess.helperText,
      },
    ],
  }
}

export async function loadSettingsData(): Promise<SettingsData> {
  const embeddingBackend = configuredEmbeddingBackend()
  const corsOrigins = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []

  const rows: TableRow[] = [
    {
      key: "admin-session",
      title: "Admin session secret",
      detail: "Local OAuth session signing secret",
      statusLabel: env.ADMIN_SESSION_SECRET ? "Configured" : "Missing",
      statusTone: env.ADMIN_SESSION_SECRET ? "success" : "danger",
      meta: env.AUTH_ISSUER_URL,
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
        label: "Auth Client",
        value: env.AUTH_ADMIN_CLIENT_ID,
        footer: "OAUTH_CLIENT",
      },
      {
        label: "Admin Origin",
        value: new URL(env.ADMIN_BASE_URL ?? "http://localhost:3003").host,
        footer: "CALLBACK",
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
        value: embeddingBackend ?? "Missing",
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
  const providerReady = configuredEmbeddingBackend() != null

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
      unavailableReason: embeddingBackendUnavailableReason(),
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

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, Prisma.JsonValue>
}

function jsonString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function jsonNumber(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function emptyWatchSearchScoreBreakdown() {
  return {
    total: 0,
    sourceRelevance: 0,
    evidenceBoost: 0,
    relevance: 0,
    availability: 0,
    match: 0,
    sourceScore: 0,
  }
}

function watchSearchAvailabilityScoreForKind(kind: string | null): number {
  if (kind === "target_audio") return 0.25
  if (kind === "target_subtitle") return 0.18
  if (kind === "related_language") return 0.08
  return 0
}

function emptyWatchSearchScoreBreakdownForAvailability(kind: string | null) {
  return {
    ...emptyWatchSearchScoreBreakdown(),
    availability: watchSearchAvailabilityScoreForKind(kind),
  }
}

function watchSearchScoreBreakdown(
  value: Prisma.JsonValue | undefined,
  availabilityKind: string | null,
) {
  const row = jsonRecord(value)
  if (!row) {
    return emptyWatchSearchScoreBreakdownForAvailability(availabilityKind)
  }
  const total = jsonNumber(row.total)
  const sourceRelevance = jsonNumber(row.sourceRelevance)
  const evidenceBoost = jsonNumber(row.evidenceBoost)
  const relevance = jsonNumber(row.relevance)
  const availability =
    jsonNumber(row.availability) ||
    watchSearchAvailabilityScoreForKind(availabilityKind)
  const match = jsonNumber(row.match)
  const sourceScore = jsonNumber(row.sourceScore)
  if (total == null || availability == null || sourceScore == null) {
    return emptyWatchSearchScoreBreakdownForAvailability(availabilityKind)
  }
  const resolvedEvidenceBoost = evidenceBoost ?? match ?? 0
  const resolvedSourceRelevance = sourceRelevance ?? relevance ?? 0
  const resolvedRelevance =
    relevance ?? resolvedSourceRelevance + resolvedEvidenceBoost
  return {
    total,
    sourceRelevance: resolvedSourceRelevance,
    evidenceBoost: resolvedEvidenceBoost,
    relevance: resolvedRelevance,
    availability,
    match: resolvedEvidenceBoost,
    sourceScore,
  }
}

function watchSearchTraceResults(
  metadata: Prisma.JsonValue | null,
): Omit<WatchSearchAnalyticsResultRow, "clicked" | "position">[] {
  const root = jsonRecord(metadata)
  const results = root?.results
  if (!Array.isArray(results)) return []

  return results.flatMap((value) => {
    const row = jsonRecord(value)
    if (!row) return []
    const id = jsonString(row.id)
    if (!id) return []
    const availabilityKind = jsonString(row.availabilityKind) ?? "unknown"
    return [
      {
        id,
        type: jsonString(row.type) ?? "unknown",
        slug: jsonString(row.slug),
        title: jsonString(row.title),
        description: jsonString(row.description) ?? jsonString(row.snippet),
        imageUrl: normalizeVideoThumbnailUrl(jsonString(row.imageUrl)),
        score: jsonNumber(row.score),
        scoreBreakdown: watchSearchScoreBreakdown(
          row.scoreBreakdown,
          availabilityKind,
        ),
        availabilityKind,
        evidenceKind: jsonString(row.evidenceKind) ?? "unknown",
        actionKind: jsonString(row.actionKind) ?? "unknown",
      },
    ]
  })
}

function watchSearchTraceLanes(
  metadata: Prisma.JsonValue | null,
): WatchSearchAnalyticsLaneRow[] {
  const root = jsonRecord(metadata)
  const lanes = root?.laneStatuses
  if (!Array.isArray(lanes)) return []

  return lanes.flatMap((value) => {
    const row = jsonRecord(value)
    if (!row) return []
    const lane = jsonString(row.lane)
    if (!lane) return []
    return [
      {
        lane,
        status: jsonString(row.status) ?? "unknown",
        startedOffsetMs: jsonNumber(row.startedOffsetMs) ?? 0,
        elapsedMs: jsonNumber(row.elapsedMs),
        resultCount: jsonNumber(row.resultCount),
        reason: jsonString(row.reason),
        detail: jsonString(row.detail),
      },
    ]
  })
}

function watchSearchLanguage(metadata: Prisma.JsonValue | null) {
  const root = jsonRecord(metadata)
  const language = jsonRecord(root?.language)
  return {
    targetLanguageSlug: jsonString(language?.targetLanguageSlug) ?? "unknown",
    targetLanguageSource:
      jsonString(language?.targetLanguageSource) ?? "unknown",
    queryNamedLanguageSlug: jsonString(language?.queryNamedLanguageSlug),
  }
}

function watchSearchLatency(metadata: Prisma.JsonValue | null) {
  return jsonNumber(jsonRecord(metadata)?.latencyMs)
}

function watchSearchOffset(metadata: Prisma.JsonValue | null) {
  return jsonNumber(jsonRecord(metadata)?.offset) ?? 0
}

type WatchSearchAnalyticsHydratedVideo = {
  id: string
  slug: string
  locales: Array<{
    locale: string | null
    languageSlug: string | null
    title: string | null
    description: string | null
  }>
  images: Array<{
    url: string | null
    kind: string | null
    createdAt: Date
  }>
}

type WatchSearchAnalyticsLanguage = {
  bcp47: string | null
  name: Prisma.JsonValue
  slug: string | null
}

async function loadWatchSearchAnalyticsLanguages(values: string[]) {
  const normalizedValues = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ]
  if (normalizedValues.length === 0) {
    return new Map<string, WatchSearchAnalyticsLanguage>()
  }

  const languages = await withTableFallback(
    () =>
      prisma.language.findMany({
        where: {
          deletedAt: null,
          OR: [
            { slug: { in: normalizedValues } },
            { bcp47: { in: normalizedValues } },
          ],
        },
        select: {
          bcp47: true,
          name: true,
          slug: true,
        },
      }),
    [],
  )

  const byValue = new Map<string, WatchSearchAnalyticsLanguage>()
  for (const language of languages) {
    if (language.slug) byValue.set(language.slug.toLowerCase(), language)
    if (language.bcp47) byValue.set(language.bcp47.toLowerCase(), language)
  }
  return byValue
}

function watchSearchLanguageName(
  language: WatchSearchAnalyticsLanguage | undefined,
) {
  const names = jsonRecord(language?.name)
  return (
    jsonString(names?.en) ??
    jsonString(names?.native) ??
    language?.slug ??
    language?.bcp47 ??
    null
  )
}

async function loadWatchSearchAnalyticsVideos(videoIds: string[]) {
  const ids = [...new Set(videoIds.filter(Boolean))]
  if (ids.length === 0)
    return new Map<string, WatchSearchAnalyticsHydratedVideo>()

  const videos = await withTableFallback(
    () =>
      prisma.video.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          slug: true,
          locales: {
            where: { deletedAt: null },
            select: {
              locale: true,
              languageSlug: true,
              title: true,
              description: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 24,
          },
          images: {
            where: { deletedAt: null },
            select: {
              url: true,
              kind: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 12,
          },
        },
      }),
    [],
  )

  return new Map(videos.map((video) => [video.id, video]))
}

function preferredWatchSearchAnalyticsImage(
  images: WatchSearchAnalyticsHydratedVideo["images"],
) {
  const priority = ["videoStill", "mobileCinematicHigh", "poster", "still"]
  for (const kind of priority) {
    const match = images.find((image) => image.kind === kind && image.url)
    if (match?.url) return normalizeVideoThumbnailUrl(match.url)
  }
  return normalizeVideoThumbnailUrl(images.find((image) => image.url)?.url)
}

function preferredWatchSearchAnalyticsLocale(
  video: WatchSearchAnalyticsHydratedVideo | undefined,
  targetLanguageSlug: string,
) {
  if (!video) return null
  const target = targetLanguageSlug.toLowerCase()
  return (
    video.locales.find(
      (locale) => locale.languageSlug?.toLowerCase() === target && locale.title,
    ) ??
    video.locales.find(
      (locale) => locale.locale?.toLowerCase() === "en" && locale.title,
    ) ??
    video.locales.find((locale) => locale.title) ??
    null
  )
}

function eventVisibleIds(metadata: Prisma.JsonValue | null) {
  const root = jsonRecord(metadata)
  return Array.isArray(root?.visibleResultIds)
    ? root.visibleResultIds.filter(
        (value): value is string => typeof value === "string",
      )
    : []
}

export async function loadWatchSearchAnalyticsData(
  params: {
    requestId?: string | null
    window?: string | null
    now?: Date
  } = {},
): Promise<WatchSearchAnalyticsData> {
  const now = params.now ?? new Date()
  const window = normalizeWatchSearchAnalyticsWindow(params.window)
  const windowMs =
    window === "30d"
      ? 30 * 24 * 60 * 60 * 1000
      : window === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000
  const since = new Date(now.getTime() - windowMs)
  const traces = await withTableFallback(
    () =>
      prisma.searchTrace.findMany({
        where: {
          searchMode: "watch-search",
          routeSource: "GRAPHQL",
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: window === "24h" ? 50 : 100,
        select: {
          id: true,
          requestId: true,
          queryText: true,
          locale: true,
          searchMode: true,
          resultCount: true,
          outcome: true,
          metadata: true,
          createdAt: true,
        },
      }),
    [],
  )
  const tracesByRequestId = new Map<string, typeof traces>()
  for (const trace of traces) {
    const requestId = trace.requestId ?? trace.id
    tracesByRequestId.set(requestId, [
      ...(tracesByRequestId.get(requestId) ?? []),
      trace,
    ])
  }
  const traceGroups = [...tracesByRequestId.entries()].map(
    ([requestId, groupedTraces]) => {
      const sortedTraces = [...groupedTraces].sort((left, right) => {
        const offsetDiff =
          watchSearchOffset(left.metadata) - watchSearchOffset(right.metadata)
        if (offsetDiff !== 0) return offsetDiff
        return left.createdAt.getTime() - right.createdAt.getTime()
      })
      return {
        requestId,
        traces: sortedTraces,
        primaryTrace: sortedTraces[0] ?? groupedTraces[0],
      }
    },
  )
  const requestIds = traceGroups.map((group) => group.requestId)
  const events =
    requestIds.length === 0
      ? []
      : await withTableFallback(
          () =>
            prisma.watchSearchEvent.findMany({
              where: {
                requestId: { in: requestIds },
                occurredAt: { gte: since },
              },
              orderBy: { occurredAt: "asc" },
              take: window === "24h" ? 300 : 600,
              select: {
                requestId: true,
                eventType: true,
                resultId: true,
                position: true,
                metadata: true,
              },
            }),
          [],
        )
  const eventsByRequestId = new Map<string, typeof events>()
  for (const event of events) {
    eventsByRequestId.set(event.requestId, [
      ...(eventsByRequestId.get(event.requestId) ?? []),
      event,
    ])
  }
  const visibleResultIdsByRequestId = new Map<string, string[]>()
  const analyticsVideoIds = new Set<string>()
  const targetLanguageValues = new Set<string>()
  for (const group of traceGroups) {
    const language = watchSearchLanguage(group.primaryTrace.metadata)
    if (language.targetLanguageSlug !== "unknown") {
      targetLanguageValues.add(language.targetLanguageSlug)
    }
    const relatedEvents = eventsByRequestId.get(group.requestId) ?? []
    const visibleIds = relatedEvents.flatMap((event) =>
      eventVisibleIds(event.metadata),
    )
    const traceResultIds = group.traces.flatMap((trace) =>
      watchSearchTraceResults(trace.metadata).map((row) => row.id),
    )
    const resultIds = [...traceResultIds, ...visibleIds]

    visibleResultIdsByRequestId.set(group.requestId, [...new Set(resultIds)])
    for (const id of resultIds) analyticsVideoIds.add(id)
  }
  const videosById = await loadWatchSearchAnalyticsVideos([
    ...analyticsVideoIds,
  ])
  const languagesByValue = await loadWatchSearchAnalyticsLanguages([
    ...targetLanguageValues,
  ])

  const requests: WatchSearchAnalyticsRequestRow[] = traceGroups.map(
    (group) => {
      const trace = group.primaryTrace
      const requestId = group.requestId
      const relatedEvents = eventsByRequestId.get(requestId) ?? []
      const clickedIds = new Set(
        relatedEvents
          .filter((event) => event.eventType === "result_clicked")
          .map((event) => event.resultId)
          .filter((value): value is string => Boolean(value)),
      )
      const firstClick = relatedEvents.find(
        (event) => event.eventType === "result_clicked",
      )
      const resultIds = visibleResultIdsByRequestId.get(requestId) ?? []
      const resultsById = new Map(
        group.traces.flatMap((traceRow) =>
          watchSearchTraceResults(traceRow.metadata).map((row) => [
            row.id,
            row,
          ]),
        ),
      )
      const language = watchSearchLanguage(trace.metadata)

      return {
        id: trace.id,
        requestId,
        queryText: trace.queryText,
        locale: trace.locale,
        targetLanguageSlug: language.targetLanguageSlug,
        targetLanguageLabel:
          watchSearchLanguageName(
            languagesByValue.get(language.targetLanguageSlug.toLowerCase()),
          ) ?? language.targetLanguageSlug,
        targetLanguageSource: language.targetLanguageSource,
        queryNamedLanguageSlug: language.queryNamedLanguageSlug,
        searchMode: trace.searchMode,
        outcome: String(trace.outcome).toLowerCase(),
        resultCount: Math.max(trace.resultCount, resultIds.length),
        latencyMs: watchSearchLatency(trace.metadata),
        clickedPosition: firstClick?.position ?? null,
        clickCount: clickedIds.size,
        createdAt: formatDateTime(trace.createdAt),
        createdAtIso: trace.createdAt.toISOString(),
        lanes: watchSearchTraceLanes(trace.metadata),
        results: resultIds.map((id, index) => {
          const row = resultsById.get(id)
          const video = videosById.get(id)
          const locale = preferredWatchSearchAnalyticsLocale(
            video,
            language.targetLanguageSlug,
          )
          return {
            id,
            type: row?.type ?? "unknown",
            slug: row?.slug ?? video?.slug ?? null,
            title: row?.title ?? locale?.title?.trim() ?? video?.slug ?? null,
            description:
              row?.description ?? locale?.description?.trim() ?? null,
            imageUrl:
              row?.imageUrl ??
              (video ? preferredWatchSearchAnalyticsImage(video.images) : null),
            score: row?.score ?? null,
            scoreBreakdown:
              row?.scoreBreakdown ?? emptyWatchSearchScoreBreakdown(),
            availabilityKind: row?.availabilityKind ?? "unknown",
            evidenceKind: row?.evidenceKind ?? "unknown",
            actionKind: row?.actionKind ?? "unknown",
            clicked: clickedIds.has(id),
            position: index + 1,
          }
        }),
      }
    },
  )

  const selectedRequest =
    params.requestId == null
      ? null
      : (requests.find((request) => request.requestId === params.requestId) ??
        null)
  const clickedRequests = requests.filter(
    (request) => request.clickCount > 0,
  ).length
  const noResultRequests = requests.filter(
    (request) => request.resultCount === 0,
  ).length
  const degradedRequests = requests.filter(
    (request) => request.outcome === "degraded",
  ).length
  const latencies = requests
    .map((request) => request.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)
  const p95Latency =
    latencies.length === 0
      ? null
      : latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)]

  return {
    metrics: [
      {
        label: "Searches",
        value: requests.length.toString(),
        footer: `LAST_${window.toUpperCase()}_RAW_ROWS`,
      },
      {
        label: "Click Rate",
        value: formatPercent(clickedRequests, requests.length),
        footer: "REQUESTS_WITH_CLICK",
      },
      {
        label: "No Results",
        value: noResultRequests.toString(),
        footer: "ZERO_RESULT_REQUESTS",
      },
      {
        label: "P95 Latency",
        value: p95Latency === null ? "n/a" : `${Math.round(p95Latency)}ms`,
        footer: "TRACE_METADATA",
      },
    ],
    insights: [
      {
        label: "Degraded",
        value: degradedRequests.toString(),
        detail:
          "Requests where one or more optional lanes failed or timed out.",
      },
      {
        label: "Selected",
        value: selectedRequest?.requestId.slice(0, 8) ?? "None",
        detail:
          "Select a request row to view result order, evidence, and clicks.",
      },
      {
        label: "Raw Query",
        value: requests.some((request) => request.queryText)
          ? "Visible"
          : "None",
        detail:
          "This operator view reads short-lived SearchTrace rows under the existing retention policy.",
      },
      {
        label: "Unavailable",
        value: requests
          .reduce(
            (count, request) =>
              count +
              request.results.filter(
                (result) => result.availabilityKind === "unavailable",
              ).length,
            0,
          )
          .toString(),
        detail: "Returned result rows marked unavailable by watchability.",
      },
    ],
    requests,
    selectedRequest,
    window,
  }
}

function normalizeWatchSearchAnalyticsWindow(
  value: string | null | undefined,
): WatchSearchAnalyticsWindow {
  if (value === "7d" || value === "30d") return value
  return "24h"
}
