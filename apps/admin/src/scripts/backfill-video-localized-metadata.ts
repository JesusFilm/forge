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
  batchSize: number
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

  return {
    slug: valueFor("slug"),
    coreId: valueFor("core-id"),
    limit: intFor("limit"),
    fullCatalog: argv.includes("--full-catalog"),
    execute: argv.includes("--execute"),
    batchSize: intFor("batch-size") ?? DEFAULT_BATCH_SIZE,
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
        id: { in: [...coreIds] },
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

export async function runBackfill(
  prisma: PrismaClient,
  args: BackfillVideoLocalizedMetadataArgs,
  options: { assertLockActive?: () => Promise<void> } = {},
): Promise<
  VideoLocalizedMetadataResult & { dryRun: boolean; selected: number }
> {
  validateArgs(args)
  const selected = await selectAdminVideos(prisma, args)
  const summary: VideoLocalizedMetadataResult & {
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
    dryRun: !args.execute,
    selected: selected.length,
  }

  if (!args.execute) return summary

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true, bcp47: true },
  })
  const languageIdByCoreId = new Map(
    languages.map((language) => [language.coreId, language.id]),
  )
  const bcp47ByCoreId = new Map(
    languages.map((language) => [language.coreId, language.bcp47]),
  )

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
          complete: true,
        }),
      CORE_SYNC_TRANSACTION_OPTIONS,
    )
    mergeResults(summary, result)
    await options.assertLockActive?.()
  }

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
    const summary = await runBackfill(prisma, args, { assertLockActive })
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
