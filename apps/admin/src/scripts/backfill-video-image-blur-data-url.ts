#!/usr/bin/env tsx

import type { PrismaClient } from "@prisma/client"

import { getOrCreateVideoImageBlurDataUrl } from "@/services/video-image-blur-data-url.service"

const DEFAULT_BATCH_SIZE = 10

export type BackfillVideoImageBlurDataUrlArgs = {
  imageId?: string
  videoId?: string
  slug?: string
  limit?: number
  fullCatalog: boolean
  execute: boolean
  verbose: boolean
  batchSize: number
}

export type VideoImageBlurDataUrlTarget = {
  id: string
  videoId: string
  slug: string | null
  imageUrl: string | null
  blurDataUrl: string | null
  dominantColor: string | null
}

export type BackfillVideoImageBlurDataUrlResult = {
  selected: number
  processed: number
  generated: number
  skipped: number
  failed: number
  dryRun: boolean
}

export function parseArgs(
  argv: readonly string[],
): BackfillVideoImageBlurDataUrlArgs {
  const valueFor = (name: string): string | undefined => {
    const prefix = `--${name}=`
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const intFor = (name: string): number | undefined => {
    const raw = valueFor(name)
    if (!raw) return undefined
    if (!/^\d+$/.test(raw)) {
      throw new Error(`--${name} must be a positive integer`)
    }
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${name} must be a positive integer`)
    }
    return parsed
  }

  return {
    imageId: valueFor("image-id"),
    videoId: valueFor("video-id"),
    slug: valueFor("slug"),
    limit: intFor("limit"),
    fullCatalog: argv.includes("--full-catalog"),
    execute: argv.includes("--execute"),
    verbose: argv.includes("--verbose"),
    batchSize: intFor("batch-size") ?? DEFAULT_BATCH_SIZE,
  }
}

export function validateArgs(args: BackfillVideoImageBlurDataUrlArgs): void {
  if (
    !args.fullCatalog &&
    !args.imageId &&
    !args.videoId &&
    !args.slug &&
    !args.limit
  ) {
    throw new Error(
      "Refusing broad video-image blur-data-url backfill: pass --image-id, --video-id, --slug, --limit, or --full-catalog.",
    )
  }
}

export async function selectVideoImageBlurDataUrlTargets(
  prisma: PrismaClient,
  args: BackfillVideoImageBlurDataUrlArgs,
): Promise<VideoImageBlurDataUrlTarget[]> {
  const rows = await prisma.videoImage.findMany({
    where: {
      deletedAt: null,
      OR: [{ blurDataUrl: null }, { dominantColor: null }],
      ...(args.imageId ? { id: args.imageId } : {}),
      ...(args.videoId ? { videoId: args.videoId } : {}),
      ...(args.slug ? { video: { slug: args.slug, deletedAt: null } } : {}),
      AND: [
        {
          OR: [
            { mobileCinematicHigh: { not: null } },
            { mobileCinematicLow: { not: null } },
            { videoStill: { not: null } },
            { thumbnail: { not: null } },
            { url: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true,
      videoId: true,
      mobileCinematicHigh: true,
      mobileCinematicLow: true,
      videoStill: true,
      thumbnail: true,
      url: true,
      blurDataUrl: true,
      dominantColor: true,
      video: { select: { slug: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: args.fullCatalog ? undefined : (args.limit ?? 1),
  })

  return rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    slug: row.video?.slug ?? null,
    imageUrl:
      row.mobileCinematicHigh ??
      row.mobileCinematicLow ??
      row.videoStill ??
      row.thumbnail ??
      row.url,
    blurDataUrl: row.blurDataUrl,
    dominantColor: row.dominantColor,
  }))
}

export async function runBackfill(
  prisma: PrismaClient,
  args: BackfillVideoImageBlurDataUrlArgs,
): Promise<BackfillVideoImageBlurDataUrlResult> {
  validateArgs(args)
  const targets = await selectVideoImageBlurDataUrlTargets(prisma, args)
  const result: BackfillVideoImageBlurDataUrlResult = {
    selected: targets.length,
    processed: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    dryRun: !args.execute,
  }

  for (let index = 0; index < targets.length; index += args.batchSize) {
    const batch = targets.slice(index, index + args.batchSize)
    await Promise.all(
      batch.map(async (target) => {
        if (!target.imageUrl) {
          result.skipped += 1
          return
        }

        result.processed += 1
        if (!args.execute) {
          if (args.verbose) {
            console.info("[video-image-blur-data-url] dry-run target", {
              imageId: target.id,
              videoId: target.videoId,
              slug: target.slug,
              imageUrl: target.imageUrl,
            })
          }
          return
        }

        try {
          const blurDataUrl = await getOrCreateVideoImageBlurDataUrl({
            prisma,
            imageId: target.id,
            imageUrl: target.imageUrl,
          })
          if (blurDataUrl) {
            result.generated += 1
          } else {
            result.skipped += 1
          }
        } catch (error) {
          result.failed += 1
          console.warn("[video-image-blur-data-url] target failed", {
            imageId: target.id,
            videoId: target.videoId,
            slug: target.slug,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )

    console.info("[video-image-blur-data-url] progress", {
      selected: result.selected,
      processed: result.processed,
      generated: result.generated,
      skipped: result.skipped,
      failed: result.failed,
      dryRun: result.dryRun,
    })
  }

  return result
}

export async function runBackfillCli(argv = process.argv.slice(2)) {
  const { prisma } = await import("@/db/client")
  const args = parseArgs(argv)
  const result = await runBackfill(prisma, args)
  console.info("[video-image-blur-data-url] complete", result)
  await prisma.$disconnect()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfillCli().catch((error) => {
    console.error(
      "[video-image-blur-data-url] fatal",
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
}
