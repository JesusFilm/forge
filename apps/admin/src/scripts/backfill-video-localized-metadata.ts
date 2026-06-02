#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client"

import {
  acquireSyncLock,
  refreshSyncLock,
  releaseSyncLock,
} from "@/services/core-sync/lock"
import { coreQuery } from "@/services/core-sync/core-client"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "@/services/core-sync/transaction-options"
import {
  syncVideoLocalizedMetadata,
  type CoreVideoLocalizedMetadata,
  type VideoLocalizedMetadataResult,
} from "@/services/core-sync/video-localized-metadata"

const DEFAULT_BATCH_SIZE = 10
const LOCK_HEARTBEAT_INTERVAL_MS = 60_000

const LOCALIZED_METADATA_QUERY = `
  query LocalizedVideoMetadata($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      publishedAt
      title(primary: false) { value primary language { id bcp47 } }
      description(primary: false) { value primary language { id bcp47 } }
      snippet(primary: false) { value primary language { id bcp47 } }
      imageAlt(primary: false) { value primary language { id bcp47 } }
      studyQuestions(primary: false) {
        id
        value
        primary
        order
        language { id bcp47 }
      }
    }
  }
`

export type BackfillVideoLocalizedMetadataArgs = {
  slug?: string
  coreId?: string
  limit?: number
  fullCatalog: boolean
  execute: boolean
  verbose: boolean
  batchSize: number
  resumeAfter?: Date
  transactionTimeoutMs?: number
}

export type BackfillVideoLocalizedMetadataProgress = {
  batch: number
  batches: number
  batchSize: number
  selected: number
  selectedProcessed: number
  coreVideosFetched: number
  videosProcessed: number
  videoLocalesUpserted: number
  videoLocalesStaled: number
  studyQuestionsUpserted: number
  studyQuestionsStaled: number
  skippedLanguages: number
  errors: number
}

export function parseArgs(
  argv: readonly string[],
): BackfillVideoLocalizedMetadataArgs {
  const valueFor = (name: string): string | undefined => {
    const prefix = `--${name}=`
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const intFor = (name: string): number | undefined => {
    const raw = valueFor(name)
    if (!raw) return undefined
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${name} must be a positive integer`)
    }
    return parsed
  }
  const dateFor = (name: string): Date | undefined => {
    const raw = valueFor(name)
    if (!raw) return undefined
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`--${name} must be a valid ISO date`)
    }
    return parsed
  }

  return {
    slug: valueFor("slug"),
    coreId: valueFor("core-id"),
    limit: intFor("limit"),
    fullCatalog: argv.includes("--full-catalog"),
    execute: argv.includes("--execute"),
    verbose: argv.includes("--verbose"),
    batchSize: intFor("batch-size") ?? DEFAULT_BATCH_SIZE,
    resumeAfter: dateFor("resume-after"),
    transactionTimeoutMs: intFor("transaction-timeout-ms"),
  }
}

export function validateArgs(args: BackfillVideoLocalizedMetadataArgs): void {
  if (!args.fullCatalog && !args.slug && !args.coreId && !args.limit) {
    throw new Error(
      "Refusing broad backfill: pass --slug, --core-id, --limit, or --full-catalog.",
    )
  }
}

type AdminVideoTarget = {
  id: string
  coreId: string
  source: "CORE" | "MANAGER"
  publishedAt: Date | null
}

type LocalizedVariantCoverageAudit = {
  videoLocaleDuplicateBcp47Groups: number
  studyQuestionDuplicateBcp47Groups: number
  videoLocaleExactIdentityWithoutBcp47: number
  studyQuestionExactIdentityWithoutBcp47: number
}

export async function selectAdminVideos(
  prisma: PrismaClient,
  args: BackfillVideoLocalizedMetadataArgs,
): Promise<AdminVideoTarget[]> {
  return prisma.video.findMany({
    where: {
      source: "CORE",
      deletedAt: null,
      ...(args.slug ? { slug: args.slug } : {}),
      ...(args.coreId ? { coreId: args.coreId } : {}),
      ...(args.resumeAfter
        ? {
            videoLocales: {
              none: {
                source: "CORE",
                deletedAt: null,
                languageCoreId: { not: null },
                syncedAt: { gte: args.resumeAfter },
              },
            },
          }
        : {}),
    },
    select: { id: true, coreId: true, source: true, publishedAt: true },
    orderBy: { updatedAt: "desc" },
    take: args.fullCatalog ? undefined : (args.limit ?? 1),
  })
}

async function fetchCoreLocalizedMetadata(
  coreIds: readonly string[],
): Promise<CoreVideoLocalizedMetadata[]> {
  if (coreIds.length === 0) return []
  const result = await coreQuery<{ videos: CoreVideoLocalizedMetadata[] }>(
    LOCALIZED_METADATA_QUERY,
    {
      offset: 0,
      limit: coreIds.length,
      where: {
        published: true,
        ids: [...coreIds],
      },
    },
  )
  return result.data?.videos ?? []
}

function mergeResults(
  target: VideoLocalizedMetadataResult,
  source: VideoLocalizedMetadataResult,
): void {
  target.videosProcessed += source.videosProcessed
  target.videoLocalesUpserted += source.videoLocalesUpserted
  target.videoLocalesStaled += source.videoLocalesStaled
  target.studyQuestionsUpserted += source.studyQuestionsUpserted
  target.studyQuestionsStaled += source.studyQuestionsStaled
  target.skippedLanguages += source.skippedLanguages
  target.errors += source.errors
  target.diagnostics.push(...source.diagnostics)
}

function emptyVariantCoverageAudit(): LocalizedVariantCoverageAudit {
  return {
    videoLocaleDuplicateBcp47Groups: 0,
    studyQuestionDuplicateBcp47Groups: 0,
    videoLocaleExactIdentityWithoutBcp47: 0,
    studyQuestionExactIdentityWithoutBcp47: 0,
  }
}

async function auditLocalizedVariantCoverage(
  prisma: PrismaClient,
  videoIds: readonly string[],
): Promise<LocalizedVariantCoverageAudit> {
  if (videoIds.length === 0) return emptyVariantCoverageAudit()

  const baseWhere = {
    videoId: { in: [...videoIds] },
    source: "CORE" as const,
    deletedAt: null,
  }
  const exactIdentityWhere = {
    OR: [{ languageSlug: { not: null } }, { languageCoreId: { not: null } }],
  }

  const [
    videoLocaleGroups,
    studyQuestionGroups,
    videoLocaleExactIdentityWithoutBcp47,
    studyQuestionExactIdentityWithoutBcp47,
  ] = await Promise.all([
    prisma.videoLocale.groupBy({
      by: ["videoId", "locale"],
      where: {
        ...baseWhere,
        locale: { not: null },
        ...exactIdentityWhere,
      },
      _count: { _all: true },
    }),
    prisma.videoStudyQuestion.groupBy({
      by: ["videoId", "locale"],
      where: {
        ...baseWhere,
        locale: { not: null },
        ...exactIdentityWhere,
      },
      _count: { _all: true },
    }),
    prisma.videoLocale.count({
      where: {
        ...baseWhere,
        locale: null,
        ...exactIdentityWhere,
      },
    }),
    prisma.videoStudyQuestion.count({
      where: {
        ...baseWhere,
        locale: null,
        ...exactIdentityWhere,
      },
    }),
  ])

  return {
    videoLocaleDuplicateBcp47Groups: videoLocaleGroups.filter(
      (group) => group._count._all > 1,
    ).length,
    studyQuestionDuplicateBcp47Groups: studyQuestionGroups.filter(
      (group) => group._count._all > 1,
    ).length,
    videoLocaleExactIdentityWithoutBcp47,
    studyQuestionExactIdentityWithoutBcp47,
  }
}

export async function runBackfill(
  prisma: PrismaClient,
  args: BackfillVideoLocalizedMetadataArgs,
  options: {
    assertLockActive?: () => Promise<void>
    onProgress?: (progress: BackfillVideoLocalizedMetadataProgress) => void
  } = {},
): Promise<
  VideoLocalizedMetadataResult &
    LocalizedVariantCoverageAudit & { dryRun: boolean; selected: number }
> {
  validateArgs(args)
  const selected = await selectAdminVideos(prisma, args)
  const summary: VideoLocalizedMetadataResult & {
    videoLocaleDuplicateBcp47Groups: number
    studyQuestionDuplicateBcp47Groups: number
    videoLocaleExactIdentityWithoutBcp47: number
    studyQuestionExactIdentityWithoutBcp47: number
    dryRun: boolean
    selected: number
  } = {
    videosProcessed: 0,
    videoLocalesUpserted: 0,
    videoLocalesStaled: 0,
    studyQuestionsUpserted: 0,
    studyQuestionsStaled: 0,
    skippedLanguages: 0,
    errors: 0,
    diagnostics: [],
    ...emptyVariantCoverageAudit(),
    dryRun: !args.execute,
    selected: selected.length,
  }

  const applyVariantCoverageAudit = async (): Promise<void> => {
    Object.assign(
      summary,
      await auditLocalizedVariantCoverage(
        prisma,
        selected.map((video) => video.id),
      ),
    )
  }

  if (!args.execute) {
    await applyVariantCoverageAudit()
    return summary
  }

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true, bcp47: true, slug: true },
  })
  const languageIdByCoreId = new Map(
    languages.map((language) => [language.coreId, language.id]),
  )
  const bcp47ByCoreId = new Map(
    languages.map((language) => [language.coreId, language.bcp47]),
  )
  const slugByCoreId = new Map(
    languages.map((language) => [language.coreId, language.slug]),
  )

  const batches = Math.ceil(selected.length / args.batchSize)
  const transactionOptions = {
    ...CORE_SYNC_TRANSACTION_OPTIONS,
    timeout: args.transactionTimeoutMs ?? CORE_SYNC_TRANSACTION_OPTIONS.timeout,
  }
  for (let index = 0; index < selected.length; index += args.batchSize) {
    await options.assertLockActive?.()
    const batch = selected.slice(index, index + args.batchSize)
    const coreVideos = await fetchCoreLocalizedMetadata(
      batch.map((video) => video.coreId),
    )
    const result = await prisma.$transaction(
      (tx) =>
        syncVideoLocalizedMetadata({
          prisma: tx,
          adminVideos: batch,
          coreVideos,
          languageIdByCoreId,
          bcp47ByCoreId,
          slugByCoreId,
          complete: true,
        }),
      transactionOptions,
    )
    mergeResults(summary, result)
    options.onProgress?.({
      batch: Math.floor(index / args.batchSize) + 1,
      batches,
      batchSize: args.batchSize,
      selected: selected.length,
      selectedProcessed: Math.min(index + batch.length, selected.length),
      coreVideosFetched: coreVideos.length,
      videosProcessed: summary.videosProcessed,
      videoLocalesUpserted: summary.videoLocalesUpserted,
      videoLocalesStaled: summary.videoLocalesStaled,
      studyQuestionsUpserted: summary.studyQuestionsUpserted,
      studyQuestionsStaled: summary.studyQuestionsStaled,
      skippedLanguages: summary.skippedLanguages,
      errors: summary.errors,
    })
    await options.assertLockActive?.()
  }

  await applyVariantCoverageAudit()

  return summary
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  validateArgs(args)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required")

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: ["error", "warn"],
  })
  const lockId = `video-localized-metadata-backfill-${Date.now()}`
  const locked = await acquireSyncLock(prisma, lockId)
  if (!locked) {
    throw new Error("Core sync lock is held; refusing to run backfill.")
  }
  let lockLostError: Error | null = null
  const assertLockActive = async (): Promise<void> => {
    if (lockLostError) throw lockLostError
    const ownsLock = await refreshSyncLock(prisma, lockId)
    if (!ownsLock) {
      lockLostError = new Error("Core sync lock lost during backfill.")
      throw lockLostError
    }
  }
  const heartbeat = setInterval(() => {
    void assertLockActive().catch((error) => {
      lockLostError =
        error instanceof Error
          ? error
          : new Error("Core sync lock refresh failed during backfill.")
    })
  }, LOCK_HEARTBEAT_INTERVAL_MS)
  heartbeat.unref?.()

  try {
    if (args.verbose) {
      console.log(
        JSON.stringify({
          event: "video-localized-metadata.backfill.start",
          execute: args.execute,
          fullCatalog: args.fullCatalog,
          slug: args.slug,
          coreId: args.coreId,
          limit: args.limit,
          batchSize: args.batchSize,
          resumeAfter: args.resumeAfter?.toISOString(),
          transactionTimeoutMs: args.transactionTimeoutMs,
        }),
      )
    }
    const summary = await runBackfill(prisma, args, {
      assertLockActive,
      onProgress: args.verbose
        ? (progress) => {
            console.log(
              JSON.stringify({
                event: "video-localized-metadata.backfill.progress",
                ...progress,
              }),
            )
          }
        : undefined,
    })
    console.log(
      JSON.stringify(
        {
          event: "video-localized-metadata.backfill.complete",
          ...summary,
        },
        null,
        2,
      ),
    )
  } finally {
    clearInterval(heartbeat)
    await releaseSyncLock(prisma, lockId).catch(() => {})
    await prisma.$disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: "video-localized-metadata.backfill.fatal",
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    process.exit(1)
  })
}
