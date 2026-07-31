// Sync phase: video-subtitles
// Depends on: videos, languages, video-editions
//
// Core's checksum manifest is the source of truth. A mismatch identifies work,
// but only a complete, snapshot-bound detail response authorizes mutation. An
// absence-based delete is therefore always limited to one proved video.

import { Prisma, type PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"

import { assertSyncLockHeld } from "../lock"
import { CoreGraphQLError, coreQuery } from "../core-client"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import {
  SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
  emptySyncStats,
  type ProgressReporter,
  type SubtitleParityCompletedCheck,
  type SubtitleParityDiagnostic,
  type SubtitleParityInSyncCheck,
  type SubtitleParityResidualReason,
  type SyncStats,
} from "../types"
import {
  buildVideoSubtitleChecksumManifest,
  compareUtf8,
  fetchVideoSubtitleChecksumManifest,
  MAX_VIDEO_SUBTITLE_DETAIL_IDS,
  type CoreVideoSubtitleChecksumDetail,
  type CoreVideoSubtitleChecksumManifest,
  type CoreVideoSubtitleChecksumRecord,
  type VideoSubtitleChecksumSourceRecord,
} from "../video-subtitle-checksum"

const DIAGNOSTIC_SAMPLE_LIMIT = 20
const CORE_EDITION_RELATION_BATCH_SIZE = 100

const VIDEO_EDITION_RELATIONS_QUERY = /* GraphQL */ `
  query VideoSubtitleEditionRelations($videoIds: [ID!], $limit: Int!) {
    videos(where: { ids: $videoIds }, limit: $limit) {
      id
      videoEditions {
        id
        name
      }
    }
  }
`

type AdminProjectionIssue = {
  videoId: string
  code: string
  message: string
}

type AdminProjection = {
  manifest: CoreVideoSubtitleChecksumManifest
  issues: AdminProjectionIssue[]
  issueVideoIds: Set<string>
}

type ResolvedSubtitleRecord = {
  source: CoreVideoSubtitleChecksumRecord
  languageId: string
  videoEditionId: string
}

type ResolvedVideoDetail = {
  coreVideoId: string
  adminVideoId: string
  authoritativeCoreIds: string[]
  records: ResolvedSubtitleRecord[]
}

type CoreEditionRelation = {
  id: string
  name: string
}

class SubtitleReconciliationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "SubtitleReconciliationError"
  }
}

class ResidualVideoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ResidualVideoError"
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function sampleIds(values: Iterable<string>): string[] {
  return [...new Set(values)]
    .sort(compareUtf8)
    .slice(0, DIAGNOSTIC_SAMPLE_LIMIT)
}

function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}

function failureCode(error: unknown): string {
  if (error instanceof SubtitleReconciliationError) return error.code
  if (error instanceof CoreGraphQLError) {
    const code = error.errors[0]?.extensions?.code
    return typeof code === "string" ? code : "CORE_GRAPHQL_ERROR"
  }
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase()
  }
  return "SUBTITLE_RECONCILIATION_FAILED"
}

function isSnapshotMismatch(error: unknown): boolean {
  return (
    error instanceof CoreGraphQLError &&
    error.errors.some(
      (detail) => detail.extensions?.code === "SUBTITLE_SNAPSHOT_MISMATCH",
    )
  )
}

function asPreviousDiagnostic(value: unknown): SubtitleParityDiagnostic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const stats = value as Record<string, unknown>
  const diagnostic = stats.subtitleParity
  if (
    typeof diagnostic !== "object" ||
    diagnostic === null ||
    Array.isArray(diagnostic)
  ) {
    return null
  }
  const candidate = diagnostic as Record<string, unknown>
  if (
    candidate.version !== SUBTITLE_PARITY_DIAGNOSTIC_VERSION ||
    !("latestAttempt" in candidate) ||
    !("lastCompleted" in candidate) ||
    !("lastInParity" in candidate)
  ) {
    return null
  }
  return candidate as SubtitleParityDiagnostic
}

async function loadPreviousDiagnostic(
  prisma: PrismaClient,
): Promise<SubtitleParityDiagnostic | null> {
  const state = await prisma.syncState.findUnique({
    where: { phase: "video-subtitles" },
    select: { stats: true },
  })
  return asPreviousDiagnostic(state?.stats)
}

function issueVideoId(row: {
  id: string
  videoId: string | null
  video: { coreId: string; deletedAt: Date | null } | null
}): string {
  return row.video?.coreId || `admin-video:${row.videoId ?? row.id}`
}

async function loadAdminProjection(
  prisma: PrismaClient,
): Promise<AdminProjection> {
  const rows = await prisma.videoSubtitle.findMany({
    where: { source: "CORE", deletedAt: null },
    select: {
      id: true,
      coreId: true,
      videoId: true,
      primary: true,
      vttSrc: true,
      vttVersion: true,
      srtSrc: true,
      srtVersion: true,
      video: { select: { coreId: true, deletedAt: true } },
      language: { select: { coreId: true, deletedAt: true } },
      videoEdition: { select: { name: true, deletedAt: true } },
    },
  })

  const sources: VideoSubtitleChecksumSourceRecord[] = []
  const issues: AdminProjectionIssue[] = []

  for (const row of rows) {
    const videoId = issueVideoId(row)
    let code: string | null = null
    let message = ""

    if (!row.coreId) {
      code = "missing-subtitle-core-id"
      message = `Active Core subtitle ${row.id} has no Core ID.`
    } else if (!row.video || row.video.deletedAt) {
      code = "missing-video-relation"
      message = `Active Core subtitle ${row.id} has no active video relation.`
    } else if (
      !row.language ||
      row.language.deletedAt ||
      !row.language.coreId
    ) {
      code = "missing-language-relation"
      message = `Active Core subtitle ${row.id} has no active Core language relation.`
    } else if (row.videoEdition.deletedAt) {
      code = "missing-edition-relation"
      message = `Active Core subtitle ${row.id} has no active edition relation.`
    }

    if (code) {
      issues.push({ videoId, code, message })
      continue
    }

    sources.push({
      id: row.coreId!,
      videoId: row.video!.coreId,
      languageId: row.language!.coreId,
      edition: row.videoEdition.name,
      primary: row.primary,
      vttSrc: row.vttSrc,
      vttVersion: row.vttVersion,
      srtSrc: row.srtSrc,
      srtVersion: row.srtVersion,
    })
  }

  return {
    manifest: buildVideoSubtitleChecksumManifest(sources),
    issues,
    issueVideoIds: new Set(issues.map((issue) => issue.videoId)),
  }
}

function mismatchedVideoIds(
  core: CoreVideoSubtitleChecksumManifest,
  admin: CoreVideoSubtitleChecksumManifest,
): string[] {
  const coreBuckets = new Map(
    core.buckets.map((bucket) => [bucket.videoId, bucket]),
  )
  const adminBuckets = new Map(
    admin.buckets.map((bucket) => [bucket.videoId, bucket]),
  )
  const videoIds = new Set([...coreBuckets.keys(), ...adminBuckets.keys()])

  return [...videoIds]
    .filter((videoId) => {
      const coreBucket = coreBuckets.get(videoId)
      const adminBucket = adminBuckets.get(videoId)
      return (
        coreBucket?.count !== adminBucket?.count ||
        coreBucket?.checksum !== adminBucket?.checksum
      )
    })
    .sort(compareUtf8)
}

async function fetchAllDetails(
  manifest: CoreVideoSubtitleChecksumManifest,
  videoIds: readonly string[],
): Promise<Map<string, CoreVideoSubtitleChecksumDetail>> {
  const details = new Map<string, CoreVideoSubtitleChecksumDetail>()
  const recordIds = new Set<string>()

  for (const videoIdChunk of chunks(videoIds, MAX_VIDEO_SUBTITLE_DETAIL_IDS)) {
    const response = await fetchVideoSubtitleChecksumManifest({
      detailsForVideoIds: videoIdChunk,
      expectedSnapshot: manifest.snapshot,
    })
    if (
      response.snapshot !== manifest.snapshot ||
      response.rootChecksum !== manifest.rootChecksum ||
      response.totalCount !== manifest.totalCount
    ) {
      throw new SubtitleReconciliationError(
        "MANIFEST_CHANGED_WITHOUT_SNAPSHOT_ERROR",
        "Core subtitle detail response did not match the discovered manifest.",
      )
    }

    for (const detail of response.details) {
      if (details.has(detail.videoId)) {
        throw new SubtitleReconciliationError(
          "DUPLICATE_DETAIL_VIDEO",
          `Core returned duplicate detail for video ${detail.videoId}.`,
        )
      }
      for (const record of detail.records) {
        if (recordIds.has(record.id)) {
          throw new SubtitleReconciliationError(
            "DUPLICATE_DETAIL_RECORD",
            `Core returned duplicate subtitle ID ${record.id} across videos.`,
          )
        }
        recordIds.add(record.id)
      }
      details.set(detail.videoId, detail)
    }
  }

  if (
    details.size !== videoIds.length ||
    videoIds.some((videoId) => !details.has(videoId))
  ) {
    throw new SubtitleReconciliationError(
      "INCOMPLETE_DETAIL_SET",
      "Core did not return the complete requested subtitle detail set.",
    )
  }

  return details
}

function parseCoreEditionRelationResponse(
  input: unknown,
  requestedVideoIds: ReadonlySet<string>,
): Map<string, CoreEditionRelation[]> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SubtitleReconciliationError(
      "INVALID_EDITION_RELATION_RESPONSE",
      "Core edition relation response was malformed.",
    )
  }
  const videos = (input as { videos?: unknown }).videos
  if (!Array.isArray(videos)) {
    throw new SubtitleReconciliationError(
      "INVALID_EDITION_RELATION_RESPONSE",
      "Core edition relation response did not contain videos.",
    )
  }

  const result = new Map<string, CoreEditionRelation[]>()
  for (const value of videos) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new SubtitleReconciliationError(
        "INVALID_EDITION_RELATION_RESPONSE",
        "Core edition relation video was malformed.",
      )
    }
    const video = value as { id?: unknown; videoEditions?: unknown }
    if (
      typeof video.id !== "string" ||
      !requestedVideoIds.has(video.id) ||
      !Array.isArray(video.videoEditions) ||
      result.has(video.id)
    ) {
      throw new SubtitleReconciliationError(
        "INVALID_EDITION_RELATION_RESPONSE",
        "Core edition relation response contained unexpected video data.",
      )
    }

    const editions: CoreEditionRelation[] = []
    const editionIds = new Set<string>()
    for (const editionValue of video.videoEditions) {
      if (
        typeof editionValue !== "object" ||
        editionValue === null ||
        Array.isArray(editionValue)
      ) {
        throw new SubtitleReconciliationError(
          "INVALID_EDITION_RELATION_RESPONSE",
          `Core edition relation was malformed for video ${video.id}.`,
        )
      }
      const edition = editionValue as { id?: unknown; name?: unknown }
      if (
        typeof edition.id !== "string" ||
        typeof edition.name !== "string" ||
        editionIds.has(edition.id)
      ) {
        throw new SubtitleReconciliationError(
          "INVALID_EDITION_RELATION_RESPONSE",
          `Core edition relation was invalid for video ${video.id}.`,
        )
      }
      editionIds.add(edition.id)
      editions.push({ id: edition.id, name: edition.name })
    }
    result.set(video.id, editions)
  }
  return result
}

async function fetchCoreEditionRelations(
  videoIds: readonly string[],
): Promise<Map<string, CoreEditionRelation[]>> {
  const result = new Map<string, CoreEditionRelation[]>()
  for (const videoIdChunk of chunks(
    [...new Set(videoIds)].sort(compareUtf8),
    CORE_EDITION_RELATION_BATCH_SIZE,
  )) {
    const response = await coreQuery<{ videos: unknown }>(
      VIDEO_EDITION_RELATIONS_QUERY,
      { videoIds: videoIdChunk, limit: videoIdChunk.length },
      { requireInteropToken: true },
    )
    if (response.data == null) {
      throw new SubtitleReconciliationError(
        "INVALID_EDITION_RELATION_RESPONSE",
        "Core edition relation response had no data.",
      )
    }
    const parsed = parseCoreEditionRelationResponse(
      response.data,
      new Set(videoIdChunk),
    )
    for (const [videoId, editions] of parsed) result.set(videoId, editions)
  }
  return result
}

function addResidual(
  residualVideoIds: Set<string>,
  residualReasons: SubtitleParityResidualReason[],
  videoId: string,
  code: string,
  message: string,
) {
  residualVideoIds.add(videoId)
  residualReasons.push({ videoId, code, message })
}

async function resolveDetails(
  prisma: PrismaClient,
  details: ReadonlyMap<string, CoreVideoSubtitleChecksumDetail>,
  projection: AdminProjection,
  residualVideoIds: Set<string>,
  residualReasons: SubtitleParityResidualReason[],
): Promise<Map<string, ResolvedVideoDetail>> {
  const requestedVideoIds = [...details.keys()]
  const requestedLanguageIds = [
    ...new Set(
      [...details.values()].flatMap((detail) =>
        detail.records.map((record) => record.languageId),
      ),
    ),
  ]
  const requestedEditionNames = [
    ...new Set(
      [...details.values()].flatMap((detail) =>
        detail.records.map((record) => record.edition),
      ),
    ),
  ]

  const [videos, languages] = await Promise.all([
    prisma.video.findMany({
      where: { deletedAt: null, coreId: { in: requestedVideoIds } },
      select: { id: true, coreId: true },
    }),
    prisma.language.findMany({
      where: { deletedAt: null, coreId: { in: requestedLanguageIds } },
      select: { id: true, coreId: true },
    }),
  ])
  const videosByCoreId = new Map(videos.map((video) => [video.coreId, video]))
  const languagesByCoreId = new Map(
    languages.map((language) => [language.coreId, language.id]),
  )

  const sameVideoEditions = new Map<
    string,
    Map<string, Array<{ id: string; coreId: string }>>
  >()
  for (const videoId of requestedVideoIds) {
    sameVideoEditions.set(videoId, new Map())
  }

  const adminVideoIds = videos.map((video) => video.id)
  const coreVideoIdByAdminId = new Map(
    videos.map((video) => [video.id, video.coreId]),
  )
  const associatedEditions =
    adminVideoIds.length === 0 || requestedEditionNames.length === 0
      ? []
      : await prisma.videoEdition.findMany({
          where: {
            deletedAt: null,
            name: { in: requestedEditionNames },
            OR: [
              { subtitles: { some: { videoId: { in: adminVideoIds } } } },
              { dubs: { some: { videoId: { in: adminVideoIds } } } },
            ],
          },
          select: {
            id: true,
            coreId: true,
            name: true,
            subtitles: {
              where: { videoId: { in: adminVideoIds } },
              select: { videoId: true },
            },
            dubs: {
              where: { videoId: { in: adminVideoIds } },
              select: { videoId: true },
            },
          },
        })

  for (const edition of associatedEditions) {
    const associatedAdminVideoIds = new Set([
      ...edition.subtitles.flatMap((subtitle) =>
        subtitle.videoId ? [subtitle.videoId] : [],
      ),
      ...edition.dubs.map((dub) => dub.videoId),
    ])
    for (const adminVideoId of associatedAdminVideoIds) {
      const coreVideoId = coreVideoIdByAdminId.get(adminVideoId)
      if (!coreVideoId) continue
      const byName = sameVideoEditions.get(coreVideoId)!
      const current = byName.get(edition.name) ?? []
      current.push({ id: edition.id, coreId: edition.coreId })
      byName.set(edition.name, current)
    }
  }

  const unresolvedVideoIds = new Set<string>()

  for (const detail of details.values()) {
    const adminVideo = videosByCoreId.get(detail.videoId)
    if (!adminVideo || projection.issueVideoIds.has(detail.videoId)) continue
    const names = [...new Set(detail.records.map((record) => record.edition))]
    const byName = sameVideoEditions.get(detail.videoId)!
    if (names.some((name) => byName.get(name)?.length !== 1)) {
      unresolvedVideoIds.add(detail.videoId)
    }
  }

  let coreRelations = new Map<string, CoreEditionRelation[]>()
  if (unresolvedVideoIds.size > 0) {
    coreRelations = await fetchCoreEditionRelations([...unresolvedVideoIds])
  }
  const fallbackCoreEditionIds = [
    ...new Set(
      [...coreRelations.values()].flatMap((editions) =>
        editions.map((edition) => edition.id),
      ),
    ),
  ]
  const fallbackEditions =
    fallbackCoreEditionIds.length === 0
      ? []
      : await prisma.videoEdition.findMany({
          where: {
            deletedAt: null,
            coreId: { in: fallbackCoreEditionIds },
          },
          select: { id: true, coreId: true },
        })
  const editionsByCoreId = new Map(
    fallbackEditions.map((edition) => [edition.coreId, edition.id]),
  )

  const resolved = new Map<string, ResolvedVideoDetail>()
  for (const detail of details.values()) {
    const adminVideo = videosByCoreId.get(detail.videoId)
    if (!adminVideo) {
      addResidual(
        residualVideoIds,
        residualReasons,
        detail.videoId,
        "missing-video",
        "No active Admin video matches the Core video ID.",
      )
      continue
    }
    if (projection.issueVideoIds.has(detail.videoId)) {
      addResidual(
        residualVideoIds,
        residualReasons,
        detail.videoId,
        "unprojectable-admin-row",
        "An active Core-owned Admin subtitle for this video cannot be checksummed safely.",
      )
      continue
    }

    const records: ResolvedSubtitleRecord[] = []
    let resolutionFailed = false
    for (const record of detail.records) {
      const languageId = languagesByCoreId.get(record.languageId)
      if (!languageId) {
        addResidual(
          residualVideoIds,
          residualReasons,
          detail.videoId,
          "missing-language",
          `No active Admin language matches Core language ${record.languageId}.`,
        )
        resolutionFailed = true
        break
      }

      const sameVideoCandidates = sameVideoEditions
        .get(detail.videoId)
        ?.get(record.edition)
      let videoEditionId: string | undefined
      if (sameVideoCandidates?.length === 1) {
        videoEditionId = sameVideoCandidates[0]?.id
      } else {
        const coreCandidates = (coreRelations.get(detail.videoId) ?? []).filter(
          (edition) => edition.name === record.edition,
        )
        if (coreCandidates.length === 1) {
          videoEditionId = editionsByCoreId.get(coreCandidates[0]!.id)
        }
      }

      if (!videoEditionId) {
        addResidual(
          residualVideoIds,
          residualReasons,
          detail.videoId,
          "unresolved-edition",
          `Edition ${record.edition} could not be resolved uniquely for this video.`,
        )
        resolutionFailed = true
        break
      }
      records.push({ source: record, languageId, videoEditionId })
    }

    if (!resolutionFailed) {
      resolved.set(detail.videoId, {
        coreVideoId: detail.videoId,
        adminVideoId: adminVideo.id,
        authoritativeCoreIds: detail.records.map((record) => record.id),
        records,
      })
    }
  }
  return resolved
}

async function bulkUpsertVideoSubtitles(
  tx: Prisma.TransactionClient,
  detail: ResolvedVideoDetail,
): Promise<number> {
  if (detail.records.length === 0) return 0

  const values = detail.records.map(
    ({ source, languageId, videoEditionId }) =>
      Prisma.sql`(
      ${randomUUID()},
      ${source.id},
      'core'::"SourceTier",
      ${detail.adminVideoId},
      ${videoEditionId},
      ${languageId},
      ${source.value},
      ${source.primary},
      ${source.vttSrc},
      ${source.vttVersion},
      ${source.srtSrc},
      ${source.srtVersion},
      false,
      NOW(),
      NOW(),
      NOW()
    )`,
  )

  return tx.$executeRaw(Prisma.sql`
    INSERT INTO "video_subtitle" (
      "id", "core_id", "source", "video_id", "video_edition_id",
      "language_id", "value", "primary", "vtt_src", "vtt_version",
      "srt_src", "srt_version", "ai_generated", "synced_at",
      "created_at", "updated_at"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "video_edition_id" = EXCLUDED."video_edition_id",
      "language_id" = EXCLUDED."language_id",
      "value" = EXCLUDED."value",
      "primary" = EXCLUDED."primary",
      "vtt_src" = EXCLUDED."vtt_src",
      "vtt_version" = EXCLUDED."vtt_version",
      "srt_src" = EXCLUDED."srt_src",
      "srt_version" = EXCLUDED."srt_version",
      "ai_generated" = false,
      "synced_at" = NOW(),
      "updated_at" = NOW(),
      "deleted_at" = NULL
    WHERE "video_subtitle"."source" = 'core'::"SourceTier"
      AND "video_subtitle"."video_id" = EXCLUDED."video_id"
  `)
}

async function reconcileVideo(
  prisma: PrismaClient,
  lockOwnerId: string,
  detail: ResolvedVideoDetail,
): Promise<{ created: number; updated: number; softDeleted: number }> {
  return prisma.$transaction(async (tx) => {
    await assertSyncLockHeld(tx, lockOwnerId)

    const coreIds = detail.authoritativeCoreIds
    const existing =
      coreIds.length === 0
        ? []
        : await tx.$queryRaw<
            Array<{ coreId: string; source: string; videoId: string | null }>
          >(Prisma.sql`
            SELECT core_id AS "coreId", source::text AS "source", video_id AS "videoId"
            FROM video_subtitle
            WHERE core_id IN (${Prisma.join(coreIds)})
            FOR UPDATE
          `)

    if (
      existing.some(
        (row) => row.source !== "core" || row.videoId !== detail.adminVideoId,
      )
    ) {
      throw new ResidualVideoError(
        "subtitle-id-owned-elsewhere",
        "A requested Core subtitle ID is owned by Manager or another Admin video.",
      )
    }

    const affected = await bulkUpsertVideoSubtitles(tx, detail)
    if (affected !== detail.records.length) {
      throw new ResidualVideoError(
        "subtitle-id-collision",
        "A requested Core subtitle ID changed ownership during reconciliation.",
      )
    }

    const deleted = await tx.videoSubtitle.updateMany({
      where: {
        videoId: detail.adminVideoId,
        source: "CORE",
        deletedAt: null,
        ...(coreIds.length > 0
          ? { OR: [{ coreId: null }, { coreId: { notIn: coreIds } }] }
          : {}),
      },
      data: { deletedAt: new Date() },
    })

    return {
      created: detail.records.length - existing.length,
      updated: existing.length,
      softDeleted: deleted.count,
    }
  }, CORE_SYNC_TRANSACTION_OPTIONS)
}

function completedDiagnostic({
  checkId,
  startedAt,
  completedAt,
  core,
  admin,
  initialMismatchVideoIds,
  repairedVideoIds,
  residualVideoIds,
  residualReasons,
}: {
  checkId: string
  startedAt: string
  completedAt: string
  core: CoreVideoSubtitleChecksumManifest
  admin: AdminProjection
  initialMismatchVideoIds: Set<string>
  repairedVideoIds: Set<string>
  residualVideoIds: Set<string>
  residualReasons: SubtitleParityResidualReason[]
}): SubtitleParityCompletedCheck {
  const inSync =
    core.rootChecksum === admin.manifest.rootChecksum &&
    core.totalCount === admin.manifest.totalCount &&
    admin.issues.length === 0 &&
    residualVideoIds.size === 0

  return {
    checkId,
    startedAt,
    completedAt,
    status: inSync ? "in-sync" : "out-of-sync",
    manifestVersion: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
    core: {
      snapshot: core.snapshot,
      rootChecksum: core.rootChecksum,
      totalCount: core.totalCount,
    },
    admin: {
      rootChecksum: admin.manifest.rootChecksum,
      totalCount: admin.manifest.totalCount,
      unprojectableCount: admin.issues.length,
    },
    initialMismatchTotal: initialMismatchVideoIds.size,
    repairedTotal: repairedVideoIds.size,
    residualTotal: residualVideoIds.size,
    initialMismatchVideoIds: sampleIds(initialMismatchVideoIds),
    repairedVideoIds: sampleIds(repairedVideoIds),
    residualVideoIds: sampleIds(residualVideoIds),
    residualReasons: residualReasons.slice(0, DIAGNOSTIC_SAMPLE_LIMIT),
    residualReasonTruncatedCount: Math.max(
      0,
      residualReasons.length - DIAGNOSTIC_SAMPLE_LIMIT,
    ),
  }
}

function inSyncEvidence(
  completed: SubtitleParityCompletedCheck,
): SubtitleParityInSyncCheck {
  return {
    checkId: completed.checkId,
    completedAt: completed.completedAt,
    snapshot: completed.core.snapshot,
    rootChecksum: completed.core.rootChecksum,
    totalCount: completed.core.totalCount,
  }
}

export async function syncVideoSubtitles({
  prisma,
  progress,
  lockOwnerId,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
  lockOwnerId?: string
}): Promise<SyncStats> {
  const stats: SyncStats = { ...emptySyncStats }
  const checkId = randomUUID()
  const startedAt = new Date().toISOString()
  let previous: SubtitleParityDiagnostic | null = null
  const repairedVideoIds = new Set<string>()
  const observedMismatchVideoIds = new Set<string>()

  try {
    previous = await loadPreviousDiagnostic(prisma)
    let snapshotRestarted = false

    while (true) {
      try {
        const [coreManifest, initialAdmin] = await Promise.all([
          fetchVideoSubtitleChecksumManifest(),
          loadAdminProjection(prisma),
        ])
        const bucketMismatches = mismatchedVideoIds(
          coreManifest,
          initialAdmin.manifest,
        )
        const requestedVideoIds = bucketMismatches.filter(
          (videoId) => !videoId.startsWith("admin-video:"),
        )
        for (const videoId of bucketMismatches) {
          observedMismatchVideoIds.add(videoId)
        }
        for (const issue of initialAdmin.issues) {
          observedMismatchVideoIds.add(issue.videoId)
        }

        progress.setTotal(observedMismatchVideoIds.size)

        if (
          coreManifest.rootChecksum === initialAdmin.manifest.rootChecksum &&
          coreManifest.totalCount === initialAdmin.manifest.totalCount &&
          initialAdmin.issues.length === 0
        ) {
          const completedAt = new Date().toISOString()
          const completed = completedDiagnostic({
            checkId,
            startedAt,
            completedAt,
            core: coreManifest,
            admin: initialAdmin,
            initialMismatchVideoIds: observedMismatchVideoIds,
            repairedVideoIds,
            residualVideoIds: new Set(),
            residualReasons: [],
          })
          stats.subtitleParity = {
            version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
            latestAttempt: {
              checkId,
              startedAt,
              completedAt,
              status: "completed",
            },
            lastCompleted: completed,
            lastInParity: inSyncEvidence(completed),
          }
          return stats
        }

        const details = await fetchAllDetails(coreManifest, requestedVideoIds)
        const residualVideoIds = new Set<string>()
        const residualReasons: SubtitleParityResidualReason[] = []
        for (const issue of initialAdmin.issues) {
          addResidual(
            residualVideoIds,
            residualReasons,
            issue.videoId,
            issue.code,
            issue.message,
          )
        }
        const resolved = await resolveDetails(
          prisma,
          details,
          initialAdmin,
          residualVideoIds,
          residualReasons,
        )

        if (resolved.size > 0 && !lockOwnerId) {
          throw new SubtitleReconciliationError(
            "MISSING_LOCK_OWNER",
            "Subtitle reconciliation requires the active Core Sync lock owner.",
          )
        }

        for (const videoId of requestedVideoIds) {
          const detail = resolved.get(videoId)
          if (!detail) {
            progress.increment()
            continue
          }
          try {
            const changes = await reconcileVideo(prisma, lockOwnerId!, detail)
            stats.created += changes.created
            stats.updated += changes.updated
            stats.softDeleted += changes.softDeleted
            if (changes.created + changes.updated + changes.softDeleted > 0) {
              repairedVideoIds.add(videoId)
            }
          } catch (error) {
            if (error instanceof ResidualVideoError) {
              addResidual(
                residualVideoIds,
                residualReasons,
                videoId,
                error.code,
                error.message,
              )
            } else {
              throw error
            }
          }
          progress.increment()
        }

        const [finalCore, finalAdmin] = await Promise.all([
          fetchVideoSubtitleChecksumManifest({
            expectedSnapshot: coreManifest.snapshot,
          }),
          loadAdminProjection(prisma),
        ])
        for (const issue of finalAdmin.issues) {
          addResidual(
            residualVideoIds,
            residualReasons,
            issue.videoId,
            issue.code,
            issue.message,
          )
        }
        for (const videoId of mismatchedVideoIds(
          finalCore,
          finalAdmin.manifest,
        )) {
          if (!residualVideoIds.has(videoId)) {
            addResidual(
              residualVideoIds,
              residualReasons,
              videoId,
              "final-checksum-mismatch",
              "Admin still differs from Core after targeted reconciliation.",
            )
          }
        }

        const completedAt = new Date().toISOString()
        const completed = completedDiagnostic({
          checkId,
          startedAt,
          completedAt,
          core: finalCore,
          admin: finalAdmin,
          initialMismatchVideoIds: observedMismatchVideoIds,
          repairedVideoIds,
          residualVideoIds,
          residualReasons,
        })
        stats.subtitleParity = {
          version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
          latestAttempt: {
            checkId,
            startedAt,
            completedAt,
            status: "completed",
          },
          lastCompleted: completed,
          lastInParity:
            completed.status === "in-sync"
              ? inSyncEvidence(completed)
              : (previous?.lastInParity ?? null),
        }
        return stats
      } catch (error) {
        if (isSnapshotMismatch(error) && !snapshotRestarted) {
          snapshotRestarted = true
          continue
        }
        if (isSnapshotMismatch(error)) {
          throw new SubtitleReconciliationError(
            "SUBTITLE_SNAPSHOT_UNSTABLE",
            "Core subtitle snapshot changed twice during reconciliation.",
          )
        }
        throw error
      }
    }
  } catch (error) {
    const completedAt = new Date().toISOString()
    stats.errors = 1
    stats.subtitleParity = {
      version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
      latestAttempt: {
        checkId,
        startedAt,
        completedAt,
        status: "failed",
        failure: {
          code: failureCode(error),
          message: safeFailureMessage(error),
        },
      },
      lastCompleted: previous?.lastCompleted ?? null,
      lastInParity: previous?.lastInParity ?? null,
    }
    console.error(
      JSON.stringify({
        event: "core-sync.video-subtitle.reconciliation-failed",
        checkId,
        code: failureCode(error),
        error: safeFailureMessage(error),
      }),
    )
    return stats
  }
}
