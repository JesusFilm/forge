#!/usr/bin/env tsx

import { Prisma, PrismaClient } from "@prisma/client"

import { backfillExperienceVideoLanguageIds } from "@/services/experience-video-language-backfill"

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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()

  try {
    const rows = await prisma.experienceLocale.findMany({
      where: {
        ...(args.locale ? { locale: args.locale } : {}),
        ...(args.experienceLocaleId ? { id: args.experienceLocaleId } : {}),
      },
      select: { id: true, locale: true, blocks: true },
      orderBy: { updatedAt: "asc" },
      ...(args.limit ? { take: args.limit } : {}),
    })

    let changedLocales = 0
    let updatedRecords = 0

    for (const row of rows) {
      const result = await backfillExperienceVideoLanguageIds({
        prisma,
        blocks: row.blocks,
        locale: row.locale,
      })

      if (!result.changed) continue

      changedLocales += 1
      updatedRecords += result.updatedRecords

      if (args.execute) {
        await prisma.experienceLocale.update({
          where: { id: row.id },
          data: { blocks: result.blocks as Prisma.InputJsonValue },
        })
      }

      process.stdout.write(
        JSON.stringify({
          event: args.execute
            ? "experience-video-language-ids.locale-updated"
            : "experience-video-language-ids.locale-would-update",
          experienceLocaleId: row.id,
          locale: row.locale,
          updatedRecords: result.updatedRecords,
          targetLanguageId: result.targetLanguageId,
          fallbackLanguageId: result.fallbackLanguageId,
        }) + "\n",
      )
    }

    process.stdout.write(
      JSON.stringify({
        event: args.execute
          ? "experience-video-language-ids.backfill-complete"
          : "experience-video-language-ids.backfill-dry-run-complete",
        execute: args.execute,
        scannedLocales: rows.length,
        changedLocales,
        updatedRecords,
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
