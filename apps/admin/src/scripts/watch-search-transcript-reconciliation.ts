#!/usr/bin/env tsx
/**
 * Manual dry-run-first watermark audit for the existing Watch Search
 * transcript corpus. See
 * src/services/typesense-watch-search-transcript-reconciliation.ts for the
 * reconciliation logic this CLI drives.
 *
 * Dry-run is the default and never requires
 * WATCH_SEARCH_TRANSCRIPT_RECONCILIATION_ENABLED. `--execute` mutates the
 * durable publication ledger (never Typesense directly) and requires that
 * flag to be `true` first — the production reconciliation path stays
 * independently disabled by default.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export class WatchSearchTranscriptReconciliationCliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchTranscriptReconciliationCliError"
  }
}

export type ReconciliationCliArgs = {
  execute: boolean
  reportOutPath: string
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-")
}

export function resolveReportOutPath(
  arg: string | undefined,
  now: Date = new Date(),
): string {
  const raw =
    arg && arg.length > 0
      ? arg
      : `.tmp/watch-search-transcript-reconciliation/${timestamp(now)}.json`
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

export function parseArgs(
  args: readonly string[],
  now: Date = new Date(),
): ReconciliationCliArgs {
  return {
    execute: hasFlag(args, "execute"),
    reportOutPath: resolveReportOutPath(readFlag(args, "report-out"), now),
  }
}

export async function writeReportToPath(
  reportOutPath: string,
  report: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(reportOutPath), { recursive: true })
    await writeFile(reportOutPath, `${JSON.stringify(report, null, 2)}\n`)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function resolveTypesenseApiKey(): string | undefined {
  // A dedicated collection-scoped export/read credential is the intended
  // long-term shape (the parent epic's least-privilege sub-issue), but it
  // does not exist yet. Reconciliation never calls a Typesense write
  // method, so any configured read-capable key works in the meantime.
  return (
    process.env.TYPESENSE_RECONCILIATION_API_KEY ??
    process.env.TYPESENSE_OPERATOR_API_KEY ??
    process.env.TYPESENSE_SEARCH_API_KEY ??
    process.env.TYPESENSE_API_KEY
  )
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv)

  const { resolveWatchSearchTranscriptReconciliationEnabled } =
    await import("@/config/env")
  if (args.execute && !resolveWatchSearchTranscriptReconciliationEnabled()) {
    throw new WatchSearchTranscriptReconciliationCliError(
      "Refusing --execute: set WATCH_SEARCH_TRANSCRIPT_RECONCILIATION_ENABLED=true first. Dry-run reporting never requires this flag.",
    )
  }

  const host = process.env.TYPESENSE_HOST
  const apiKey = resolveTypesenseApiKey()
  if (!host || !apiKey) {
    throw new WatchSearchTranscriptReconciliationCliError(
      "TYPESENSE_HOST and a read-capable Typesense API key (TYPESENSE_RECONCILIATION_API_KEY, TYPESENSE_OPERATOR_API_KEY, TYPESENSE_SEARCH_API_KEY, or TYPESENSE_API_KEY) are required",
    )
  }

  const { prisma } = await import("@/db/client")
  const { TypesenseClient } = await import("@/services/typesense-client")
  const { auditWatchSearchTranscriptCorpus } =
    await import("@/services/typesense-watch-search-transcript-reconciliation")

  try {
    const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 120_000 })
    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: !args.execute,
    })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

    const writeResult = await writeReportToPath(args.reportOutPath, report)
    if (!writeResult.ok) {
      throw new WatchSearchTranscriptReconciliationCliError(
        `failed to write report: ${writeResult.error}`,
      )
    }
    process.stdout.write(
      `${JSON.stringify({
        event: "watch-search-transcript-reconciliation.report_out_written",
        path: args.reportOutPath,
      })}\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "watch-search-transcript-reconciliation.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })}\n`,
    )
    process.exitCode = 1
  })
}
