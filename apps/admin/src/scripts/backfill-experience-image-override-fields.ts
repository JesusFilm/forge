#!/usr/bin/env tsx

import { Prisma, PrismaClient } from "@prisma/client"

import { normalizeLegacyExperienceBlockMediaFields } from "@/domain/blocks"

type Args = {
  execute: boolean
  locale?: string
  experienceLocaleId?: string
  limit?: number
}

function valueFor(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function positiveIntArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const value = valueFor(argv, name)
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return parsed
}

export function parseArgs(argv: readonly string[]): Args {
  return {
    execute: argv.includes("--execute"),
    locale: valueFor(argv, "locale"),
    experienceLocaleId: valueFor(argv, "experience-locale-id"),
    limit: positiveIntArg(argv, "limit"),
  }
}

function legacyOverrideFieldCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + legacyOverrideFieldCount(item), 0)
  }
  if (typeof value !== "object" || value === null) return 0

  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [key, nested]) =>
      sum +
      (key === "imageOverrideUrl" ||
      key === "imageOverrideAssetId" ||
      key === "imageOverrideBlurDataUrl" ||
      key === "imageOverrideDominantColor"
        ? 1
        : 0) +
      legacyOverrideFieldCount(nested),
    0,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()

  try {
    const rows = await prisma.experienceLocale.findMany({
      where: {
        ...(args.locale ? { locale: args.locale } : {}),
        ...(args.experienceLocaleId ? { id: args.experienceLocaleId } : {}),
      },
      select: { id: true, locale: true, slug: true, blocks: true },
      orderBy: { updatedAt: "asc" },
      ...(args.limit ? { take: args.limit } : {}),
    })

    let changedLocales = 0
    let removedFields = 0

    for (const row of rows) {
      const beforeCount = legacyOverrideFieldCount(row.blocks)
      if (beforeCount === 0) continue

      const normalized = normalizeLegacyExperienceBlockMediaFields(row.blocks)
      changedLocales += 1
      removedFields += beforeCount

      if (args.execute) {
        await prisma.experienceLocale.update({
          where: { id: row.id },
          data: { blocks: normalized as Prisma.InputJsonValue },
        })
      }

      process.stdout.write(
        JSON.stringify({
          event: args.execute
            ? "experience-image-override-fields.locale-updated"
            : "experience-image-override-fields.locale-would-update",
          experienceLocaleId: row.id,
          locale: row.locale,
          slug: row.slug,
          removedFields: beforeCount,
        }) + "\n",
      )
    }

    process.stdout.write(
      JSON.stringify({
        event: args.execute
          ? "experience-image-override-fields.backfill-complete"
          : "experience-image-override-fields.backfill-dry-run-complete",
        execute: args.execute,
        scannedLocales: rows.length,
        changedLocales,
        removedFields,
      }) + "\n",
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
