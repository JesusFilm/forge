#!/usr/bin/env tsx
/**
 * Generate and persist the admin-owned Watch SEO sitemap manifest snapshot.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin watch-seo-manifest:generate
 *
 * Optional:
 *   --print   Also print the full manifest payload after the summary.
 *
 * Safety: refuses production-like DATABASE_URL values. This script
 * mutates the snapshot table and is intended for local/operator refresh
 * workflows, not ad-hoc production pokes.
 */

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import type { PrismaClient } from "@prisma/client"
import type { refreshWatchSeoManifest } from "@/services/watch-seo-manifest-refresh.service"
import type { WatchSeoManifestSnapshotRecord } from "@/services/watch-seo-manifest-store"

const PROD_HOST_DENY_SET = new Set<string>([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])

export type GenerateWatchSeoManifestOptions = {
  printManifest: boolean
}

export class CliConfigError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 = 2,
  ) {
    super(message)
    this.name = "CliConfigError"
  }
}

export function parseGenerateWatchSeoManifestArgs(
  argv: readonly string[],
): GenerateWatchSeoManifestOptions {
  const unknown = argv.filter((arg) => arg !== "--print")
  if (unknown.length > 0) {
    throw new CliConfigError(
      `[generate-watch-seo-manifest] unknown argument(s): ${unknown.join(", ")}`,
    )
  }
  return { printManifest: argv.includes("--print") }
}

function isProdDatabaseUrl(rawUrl: string): {
  isProd: boolean
  reason: string
} {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { isProd: true, reason: "DATABASE_URL is not a parseable URL" }
  }

  const host = parsed.hostname.toLowerCase()
  if (host.endsWith(".railway.app")) {
    return { isProd: true, reason: `host ${host} ends with .railway.app` }
  }
  if (host.endsWith(".jesusfilm.org")) {
    return { isProd: true, reason: `host ${host} ends with .jesusfilm.org` }
  }
  if (PROD_HOST_DENY_SET.has(host)) {
    return { isProd: true, reason: `host ${host} is on the prod deny set` }
  }
  return { isProd: false, reason: "" }
}

export function assertNotProdUrl(rawUrl: string | undefined): void {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required (no value set).")
  }
  const verdict = isProdDatabaseUrl(rawUrl)
  if (verdict.isProd) {
    throw new Error(
      `[generate-watch-seo-manifest] Refusing to run: ${verdict.reason}. ` +
        `Point DATABASE_URL at a local or reviewed non-production Postgres and try again.`,
    )
  }
}

type RefreshWatchSeoManifest = typeof refreshWatchSeoManifest

type OutputStream = {
  write(chunk: string): unknown
}

type RunDeps = {
  prisma: PrismaClient
  refreshWatchSeoManifest: RefreshWatchSeoManifest
  getLatestSnapshot: () => Promise<WatchSeoManifestSnapshotRecord | null>
  stdout?: OutputStream
}

export async function runGenerateWatchSeoManifest(
  options: GenerateWatchSeoManifestOptions,
  deps: RunDeps,
): Promise<void> {
  const stdout = deps.stdout ?? process.stdout
  const outcome = await deps.refreshWatchSeoManifest({
    prisma: deps.prisma,
    reason: "operator-script",
  })

  if (outcome.status !== "refreshed") {
    const detail =
      outcome.status === "failed"
        ? outcome.detail
        : "refresh skipped unexpectedly"
    throw new Error(`[generate-watch-seo-manifest] refresh failed: ${detail}`)
  }

  const snapshot = await deps.getLatestSnapshot()
  if (!snapshot) {
    throw new Error(
      "[generate-watch-seo-manifest] refresh completed but no latest snapshot was found",
    )
  }

  stdout.write(
    JSON.stringify({
      event: "watch_seo_manifest.generate.complete",
      version: snapshot.version,
      generatedAt: snapshot.payload.generatedAt,
      payloadSizeBytes: snapshot.payloadSizeBytes,
      counts: outcome.counts,
      durationMs: outcome.durationMs,
    }) + "\n",
  )

  if (options.printManifest) {
    stdout.write(
      JSON.stringify({
        event: "watch_seo_manifest.generate.manifest",
        manifest: snapshot.payload,
      }) + "\n",
    )
  }
}

async function main(argv: readonly string[] = process.argv.slice(2)) {
  const options = parseGenerateWatchSeoManifestArgs(argv)
  assertNotProdUrl(process.env.DATABASE_URL)

  const { prisma } = await import("@/db/client")
  const { refreshWatchSeoManifest } =
    await import("@/services/watch-seo-manifest-refresh.service")
  const { WatchSeoManifestStore } =
    await import("@/services/watch-seo-manifest-store")
  const store = new WatchSeoManifestStore(prisma)

  try {
    await runGenerateWatchSeoManifest(options, {
      prisma,
      refreshWatchSeoManifest,
      getLatestSnapshot: () => store.getLatest(),
    })
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectInvoke =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectInvoke) {
  main().catch((error) => {
    const exitCode = error instanceof CliConfigError ? error.exitCode : 1
    process.stderr.write(
      `[generate-watch-seo-manifest] fatal: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`,
    )
    process.exit(exitCode)
  })
}
