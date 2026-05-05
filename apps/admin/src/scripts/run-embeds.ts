#!/usr/bin/env tsx
/**
 * Run scene and/or transcript embedding backfills from a workstation
 * against any DATABASE_URL.
 *
 * Bypasses the GraphQL `triggerSceneEmbeddingBackfill` /
 * `triggerTranscriptEmbeddingBackfill` mutations (which are
 * ADMIN-gated and dispatch via the useworkflow runtime). Calls the
 * workflow functions directly with the in-process Prisma singleton
 * — same pattern apps/admin/src/scripts/run-sync.ts uses for
 * `runSync()`.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *   MANAGER_ARTIFACTS_S3_ENDPOINT=... \
 *   MANAGER_ARTIFACTS_S3_REGION=... \
 *   MANAGER_ARTIFACTS_S3_BUCKET=... \
 *   MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID=... \
 *   MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY=... \
 *   OPENROUTER_API_KEY=...   # R1 only — R2 reuses vectors from artifact
 *   pnpm --filter @forge/admin run-embeds --pipeline=transcript
 *
 *   # Filters (all optional, repeatable):
 *   --pipeline=scene|transcript|both         # required
 *   --mapping-key=admin-migrations/core-id-mapping.json   # default
 *   --core-id=<id>                                         # repeatable
 *   --locale=<bcp47>                                       # scene pipeline filter
 *   --language=<bcp47>                                     # transcript pipeline filter
 *
 * The mapping snapshot must already exist at the configured S3 key
 * (or the local-fallback path when RAILWAY_S3_BUCKET is unset).
 * Run `pnpm --filter @forge/admin pull:mapping` first to populate
 * it from prod admin S3.
 *
 * NOT run against prod by default — operator must set DATABASE_URL
 * explicitly. Local DB is the destination; the CLI does no safety
 * check beyond the explicit env var (mirrors run-sync.ts).
 */

import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.constants"

type Pipeline = "scene" | "transcript" | "both"

function parseSingle(name: string): string | undefined {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseRepeated(name: string): string[] {
  const flag = `--${name}=`
  return process.argv
    .filter((a) => a.startsWith(flag))
    .map((a) => a.slice(flag.length))
    .filter((v) => v.length > 0)
}

function isPipeline(v: string): v is Pipeline {
  return v === "scene" || v === "transcript" || v === "both"
}

async function main(): Promise<void> {
  const pipelineArg = parseSingle("pipeline")
  if (!pipelineArg) {
    process.stderr.write(
      "[run-embeds] --pipeline=scene|transcript|both is required\n",
    )
    process.exit(2)
  }
  if (!isPipeline(pipelineArg)) {
    process.stderr.write(
      `[run-embeds] invalid --pipeline=${pipelineArg}; expected scene|transcript|both\n`,
    )
    process.exit(2)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    process.stderr.write("[run-embeds] DATABASE_URL is required\n")
    process.exit(2)
  }

  const mappingS3Key =
    parseSingle("mapping-key") ?? DEFAULT_CORE_ID_MAPPING_S3_KEY
  const coreIds = parseRepeated("core-id")
  const locales = parseRepeated("locale")
  const languages = parseRepeated("language")

  // Lazy-import the workflow modules AFTER the DATABASE_URL guard
  // above so a missing var produces our friendly stderr line instead
  // of zod's validation crash on the transitive `@/config/env` import.
  // Imports happen BEFORE the try/finally so the finally always sees
  // a bound prisma reference. Importing the workflows here also pulls
  // in the validated `env` and the workflow defaults — single source
  // of truth for both the CLI's start-event log and the workflow body.
  const { runSceneEmbeddingBackfill, DEFAULT_SCENE_EMBEDDING_CONCURRENCY } =
    await import("@/workflows/sceneEmbeddingBackfill")
  const {
    runTranscriptEmbeddingBackfill,
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY,
  } = await import("@/workflows/transcriptEmbeddingBackfill")
  const { prisma } = await import("@/db/client")
  const { env } = await import("@/config/env")

  const sceneConcurrency =
    env.SCENE_EMBEDDING_CONCURRENCY ?? DEFAULT_SCENE_EMBEDDING_CONCURRENCY
  const transcriptConcurrency =
    env.TRANSCRIPT_EMBEDDING_CONCURRENCY ??
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY

  const redacted = databaseUrl.replace(/:\/\/[^@]+@/, "://***:***@")
  process.stdout.write(
    JSON.stringify({
      event: "run-embeds.start",
      pipeline: pipelineArg,
      databaseUrl: redacted,
      mappingS3Key,
      coreIds: coreIds.length > 0 ? coreIds : null,
      locales: locales.length > 0 ? locales : null,
      languages: languages.length > 0 ? languages : null,
      sceneConcurrency,
      transcriptConcurrency,
      managerArtifactsBucket:
        process.env.MANAGER_ARTIFACTS_S3_BUCKET ?? "(unset)",
    }) + "\n",
  )

  // SIGINT/SIGTERM handler so Ctrl-C / docker stop / Railway stop
  // doesn't leak the prisma connection. Workflow upserts are
  // idempotent (composite-key), so partial work is safe to resume
  // by re-running.
  let interrupted = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return
    interrupted = true
    process.stderr.write(
      JSON.stringify({
        event: "run-embeds.interrupted",
        signal,
      }) + "\n",
    )
    void prisma.$disconnect().finally(() => process.exit(130))
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  const startedAt = Date.now()

  const reports: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  try {
    if (pipelineArg === "scene" || pipelineArg === "both") {
      try {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.scene.start",
            mappingS3Key,
          }) + "\n",
        )
        const sceneReport = await runSceneEmbeddingBackfill({
          mappingS3Key,
          coreIds: coreIds.length > 0 ? coreIds : undefined,
          locales: locales.length > 0 ? locales : undefined,
        })
        reports.scene = sceneReport
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.scene.complete",
            totalTargets: sceneReport.totalTargets,
            succeeded: sceneReport.succeeded,
            skipped: sceneReport.skipped,
            failed: sceneReport.failed,
          }) + "\n",
        )
      } catch (err) {
        errors.scene = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.scene.error",
            error: errors.scene,
          }) + "\n",
        )
      }
    }

    if (pipelineArg === "transcript" || pipelineArg === "both") {
      try {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.start",
            mappingS3Key,
          }) + "\n",
        )
        const transcriptReport = await runTranscriptEmbeddingBackfill({
          mappingS3Key,
          coreIds: coreIds.length > 0 ? coreIds : undefined,
          languages: languages.length > 0 ? languages : undefined,
        })
        reports.transcript = transcriptReport
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.complete",
            totalTargets: transcriptReport.totalTargets,
            succeeded: transcriptReport.succeeded,
            skipped: transcriptReport.skipped,
            failed: transcriptReport.failed,
          }) + "\n",
        )
      } catch (err) {
        errors.transcript = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.error",
            error: errors.transcript,
          }) + "\n",
        )
      }
    }

    process.stdout.write(
      JSON.stringify(
        {
          event: "run-embeds.complete",
          pipeline: pipelineArg,
          wallClockMs: Date.now() - startedAt,
          reports,
          errors: Object.keys(errors).length > 0 ? errors : undefined,
        },
        null,
        2,
      ) + "\n",
    )

    if (Object.keys(errors).length > 0) {
      process.exit(1)
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "run-embeds.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
