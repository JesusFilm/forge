#!/usr/bin/env tsx
/**
 * Run a Core sync from a workstation against any DATABASE_URL.
 *
 * Bypasses the GraphQL `triggerSync` path (which is gated behind a
 * 100s Cloudflare edge timeout for synchronous responses). Calls
 * `runSync()` directly via Prisma; prints per-phase results as they
 * complete.
 *
 * Usage:
 *   DATABASE_URL='...' \
 *   CORE_API_URL='https://api-gateway.central.jesusfilm.org/' \
 *   pnpm --filter @forge/admin exec tsx src/scripts/run-sync.ts \
 *     [--scope=all|languages,videos] [--incremental=false]
 *
 * Defaults: scope=all, incremental=false (full backfill).
 *
 * NOT run against prod by default — operator must set DATABASE_URL
 * explicitly. There is no guard inside this script; the safety is
 * the explicit env var.
 */

import { PrismaClient } from "@prisma/client"
import { runSync, type RunSyncOptions } from "@/services/core-sync/orchestrator"

function parseArg(name: string, fallback: string): string {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : fallback
}

async function main(): Promise<void> {
  const scopeArg = parseArg("scope", "all")
  const incrementalArg = parseArg("incremental", "false")
  const incremental = incrementalArg === "true"
  const scope = scopeArg === "all" ? "all" : scopeArg

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL is required")
    process.exit(2)
  }

  // Print a redacted form so the operator can confirm which env we're
  // hitting without leaking the password.
  const redacted = databaseUrl.replace(/:\/\/[^@]+@/, "://***:***@")
  console.log(
    JSON.stringify({
      event: "run-sync.start",
      scope,
      incremental,
      databaseUrl: redacted,
      coreApiUrl: process.env.CORE_API_URL ?? "(default — see core-client.ts)",
    }),
  )

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: ["error", "warn"],
  })
  const startedAt = Date.now()

  try {
    const result = await runSync(prisma, {
      scope,
      incremental,
      onProgress: logProgress,
    })

    const phasesSummary = result.phases.map((p) => ({
      phase: p.phase,
      durationMs: p.durationMs,
      ...("fetched" in p ? { fetched: p.fetched } : {}),
      ...("written" in p ? { written: p.written } : {}),
      ...("created" in p ? { created: p.created } : {}),
      ...("updated" in p ? { updated: p.updated } : {}),
      ...("errors" in p ? { errors: p.errors } : {}),
    }))

    console.log(
      JSON.stringify(
        {
          event: "run-sync.complete",
          incremental: result.incremental,
          totalDurationMs: result.durationMs,
          wallClockMs: Date.now() - startedAt,
          phases: phasesSummary,
          coverageAudit: result.coverageAudit,
          skipped: result.skipped ?? false,
        },
        null,
        2,
      ),
    )
  } finally {
    await prisma.$disconnect()
  }
}

const logProgress: NonNullable<RunSyncOptions["onProgress"]> = (progress) => {
  console.log(
    `[core-sync] event=core-sync.phase.progress phase=${progress.phase} completed=${progress.completed} total=${progress.total} elapsedMs=${progress.elapsedMs}`,
  )
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "run-sync.fatal",
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  )
  process.exit(1)
})
