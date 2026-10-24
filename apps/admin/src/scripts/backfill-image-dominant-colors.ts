#!/usr/bin/env tsx

import type { PrismaClient } from "@prisma/client"
import { generateDominantColor } from "@/services/image-metadata.service"

const DEFAULT_LIMIT = 100

export type BackfillImageDominantColorsArgs = {
  source: "video-image" | "mux-image-derivative" | "all"
  limit: number
  execute: boolean
}

type Target = {
  source: "video-image" | "mux-image-derivative"
  id: string
  blurDataUrl: string
}

type Result = {
  selected: number
  processed: number
  updated: number
  skipped: number
  failed: number
  dryRun: boolean
}

export function parseArgs(
  argv: readonly string[],
): BackfillImageDominantColorsArgs {
  const valueFor = (name: string): string | undefined => {
    const prefix = `--${name}=`
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }

  const source = valueFor("source") ?? "all"
  if (
    source !== "video-image" &&
    source !== "mux-image-derivative" &&
    source !== "all"
  ) {
    throw new Error(
      "--source must be video-image, mux-image-derivative, or all",
    )
  }

  const rawLimit = valueFor("limit")
  if (rawLimit != null && !/^\d+$/.test(rawLimit)) {
    throw new Error("--limit must be a positive integer")
  }
  const limit = rawLimit == null ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10)
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer")
  }

  return {
    source,
    limit,
    execute: argv.includes("--execute"),
  }
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  if (!match?.[1]) return null
  return Buffer.from(match[1], "base64")
}

export async function selectTargets(
  prisma: PrismaClient,
  args: BackfillImageDominantColorsArgs,
): Promise<Target[]> {
  const targets: Target[] = []

  if (args.source === "video-image" || args.source === "all") {
    const rows = await prisma.videoImage.findMany({
      where: {
        deletedAt: null,
        dominantColor: null,
        blurDataUrl: { not: null },
      },
      select: { id: true, blurDataUrl: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: args.limit,
    })
    targets.push(
      ...rows.flatMap((row) =>
        row.blurDataUrl
          ? [
              {
                source: "video-image" as const,
                id: row.id,
                blurDataUrl: row.blurDataUrl,
              },
            ]
          : [],
      ),
    )
  }

  if (args.source === "mux-image-derivative" || args.source === "all") {
    const remaining = Math.max(args.limit - targets.length, 0)
    const rows = await prisma.muxImageDerivative.findMany({
      where: {
        dominantColor: null,
      },
      select: { id: true, blurDataUrl: true },
      orderBy: [{ generatedAt: "desc" }, { id: "asc" }],
      take: args.source === "all" ? remaining : args.limit,
    })
    targets.push(
      ...rows.map((row) => ({
        source: "mux-image-derivative" as const,
        id: row.id,
        blurDataUrl: row.blurDataUrl,
      })),
    )
  }

  return targets
}

export async function runBackfill(
  prisma: PrismaClient,
  args: BackfillImageDominantColorsArgs,
): Promise<Result> {
  const targets = await selectTargets(prisma, args)
  const result: Result = {
    selected: targets.length,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun: !args.execute,
  }

  for (const target of targets) {
    result.processed += 1
    const bytes = decodeDataUrl(target.blurDataUrl)
    if (!bytes || bytes.byteLength === 0) {
      result.skipped += 1
      continue
    }

    try {
      const dominantColor = await generateDominantColor(bytes)
      if (!args.execute) {
        result.updated += 1
        continue
      }

      let count: number
      if (target.source === "video-image") {
        const update = await prisma.videoImage.updateMany({
          where: {
            id: target.id,
            dominantColor: null,
            blurDataUrl: target.blurDataUrl,
          },
          data: { dominantColor },
        })
        count = update.count
      } else {
        const update = await prisma.muxImageDerivative.updateMany({
          where: {
            id: target.id,
            dominantColor: null,
            blurDataUrl: target.blurDataUrl,
          },
          data: { dominantColor },
        })
        count = update.count
      }

      if (count === 0) {
        result.skipped += 1
        continue
      }
      result.updated += 1
    } catch (error) {
      result.failed += 1
      console.warn("[image-dominant-colors] target failed", {
        source: target.source,
        id: target.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export async function runBackfillCli(argv = process.argv.slice(2)) {
  const { prisma } = await import("@/db/client")
  const args = parseArgs(argv)
  const result = await runBackfill(prisma, args)
  console.info("[image-dominant-colors] complete", result)
  await prisma.$disconnect()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfillCli().catch((error) => {
    console.error(
      "[image-dominant-colors] fatal",
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
}
