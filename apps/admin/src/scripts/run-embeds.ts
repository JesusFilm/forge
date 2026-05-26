#!/usr/bin/env tsx
/**
 * Run scene, transcript, and/or experience embedding backfills from a
 * workstation against any DATABASE_URL.
 *
 * Bypasses the GraphQL `triggerSceneEmbeddingBackfill` /
 * `triggerTranscriptEmbeddingBackfill` /
 * `triggerExperienceEmbeddingBackfill` mutations (which are
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
 *   MASTRA_BASE_URL=...
 *   MASTRA_SERVICE_API_KEY=...
 *   pnpm --filter @forge/admin run-embeds --pipeline=transcript
 *
 *   # Filters (all optional, repeatable):
 *   --pipeline=scene|transcript|experience|both         # required
 *                                                       # `both` = scene + transcript
 *                                                       # (back-compat; experience runs only via its own pipeline)
 *   --mapping-key=admin-migrations/core-id-mapping.json # scene/transcript default
 *   --core-id=<id>                                      # scene/transcript filter (repeatable)
 *   --locale=<bcp47>                                    # scene + experience pipeline filter (repeatable)
 *   --language=<bcp47>                                  # transcript pipeline filter (repeatable)
 *   --scene-mode=idempotent|repair|force|model-upgrade
 *   --transcript-mode=idempotent|repair|force|model-upgrade
 *   --experience-mode=idempotent|repair|force|model-upgrade
 *   --experience-id=<cuid>                              # experience pipeline filter (repeatable)
 *   --force                                             # experience pipeline only — re-embed
 *                                                       # rows that already have a non-NULL embedding
 *   --report-out=<path>                                 # optional; dump final report JSON
 *   --from-report=<path>                                # scene retry only; retry failed targets
 *
 * The mapping snapshot must already exist at the configured S3 key
 * (or the local-fallback path when RAILWAY_S3_BUCKET is unset).
 * Run `pnpm --filter @forge/admin pull:mapping` first to populate
 * it from prod admin S3.
 *
 * `--report-out=<path>` writes the final `run-embeds.complete` JSON
 * payload to a file in addition to stdout, so PR2's
 * `pnpm trigger-enrichment --from-report=<path>` (feat-119) has a
 * stable input format. Stdout output is unchanged.
 *
 * **Structured stdout/stderr events emitted (single grep target for
 * CI parsers and downstream tooling):**
 *
 *   stdout:
 *     - `run-embeds.start` — one line at startup with resolved config
 *     - `run-embeds.scene.preflight`       (pipeline=scene|both)
 *     - `run-embeds.scene.start`           (pipeline=scene|both)
 *     - `run-embeds.scene.complete`        (pipeline=scene|both)
 *     - `run-embeds.scene.error`           (pipeline=scene|both, on error)
 *     - `run-embeds.transcript.start`      (pipeline=transcript|both)
 *     - `run-embeds.transcript.complete`   (pipeline=transcript|both)
 *     - `run-embeds.transcript.error`      (pipeline=transcript|both, on error)
 *     - `run-embeds.experience.start`      (pipeline=experience)
 *     - `run-embeds.experience.complete`   (pipeline=experience)
 *     - `run-embeds.experience.error`      (pipeline=experience, on error)
 *     - `run-embeds.experience.skipped`    (pipeline=both — both = scene+transcript only;
 *                                           experience is explicitly omitted)
 *     - `run-embeds.complete` — final aggregated report (pretty-printed JSON)
 *     - `run-embeds.report_out_written` — when --report-out succeeded
 *
 *   stderr:
 *     - `run-embeds.report_out_error` — write-to-file failed (NON-fatal)
 *     - `run-embeds.interrupted` — SIGINT/SIGTERM received
 *     - `run-embeds.fatal` — unhandled error in main()
 *
 * NOT run against prod by default — operator must set DATABASE_URL
 * explicitly. Local DB is the destination; the CLI does no safety
 * check beyond the explicit env var (mirrors run-sync.ts).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.constants"

/**
 * Resolve a `--report-out=<path>` argument to an absolute path, or
 * `undefined` if not set. Bare relative paths are anchored to
 * `process.cwd()` (matches how an operator naturally types
 * `--report-out=.tmp/report.json` from the repo root).
 *
 * Exported for tests; used internally by `main()`.
 */
export function resolveReportOutPath(
  arg: string | undefined,
): string | undefined {
  if (arg === undefined || arg === "") return undefined
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
}

/**
 * Write the final `run-embeds.complete` JSON to disk. Creates parent
 * directories as needed. On failure, logs a structured
 * `run-embeds.report_out_error` event to stderr but does NOT throw —
 * the report is already on stdout, so a side-channel write failure
 * (ENOSPC, EACCES, broken path) is a logging concern, not a workflow
 * outcome. PR2's `pnpm trigger-enrichment --from-report=<path>`
 * (feat-119) consumes the file format produced here.
 *
 * Exported for tests.
 */
export async function writeReportToPath(
  reportOutPath: string,
  finalReport: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(reportOutPath), { recursive: true })
    await writeFile(reportOutPath, JSON.stringify(finalReport, null, 2) + "\n")
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export type SceneRetryTargetFromReport = {
  coreId: string
  videoEditionId: string
  locale: string
  cmsVideoId: number
}

export type SceneRetrySelectionDetails = {
  requested: number
  matched: number
  unmatched: number
  unmatchedRetryTargets: ReadonlyArray<{
    coreId: string
    videoEditionId: string
    locale: string
  }>
}

export type PipelineErrorDetails = {
  retrySelection?: SceneRetrySelectionDetails
}

export class RunEmbedsConfigError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 = 2,
  ) {
    super(message)
    this.name = "RunEmbedsConfigError"
  }
}

export function resolveReportInPath(
  arg: string | undefined,
): string | undefined {
  if (arg === undefined || arg === "") return undefined
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
}

export function extractFailedSceneRetryTargetsFromReport(
  report: unknown,
): SceneRetryTargetFromReport[] {
  if (!report || typeof report !== "object") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --from-report is not an object",
    )
  }
  const reports = (report as Record<string, unknown>).reports
  if (!reports || typeof reports !== "object") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --from-report missing reports object",
    )
  }
  const scene = (reports as Record<string, unknown>).scene
  if (!scene || typeof scene !== "object") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --from-report missing reports.scene",
    )
  }
  const outcomes = (scene as Record<string, unknown>).outcomes
  if (!Array.isArray(outcomes)) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --from-report missing reports.scene.outcomes",
    )
  }

  const byKey = new Map<string, SceneRetryTargetFromReport>()
  outcomes.forEach((outcome, index) => {
    if (!outcome || typeof outcome !== "object") return
    const o = outcome as Record<string, unknown>
    if (o.status !== "failed") return
    const target = o.target
    if (!target || typeof target !== "object") {
      throw new RunEmbedsConfigError(
        `[run-embeds] failed scene outcome at reports.scene.outcomes[${index}] is missing target`,
      )
    }
    const t = target as Record<string, unknown>
    const coreId = typeof t.coreId === "string" ? t.coreId : undefined
    const videoEditionId =
      typeof t.videoEditionId === "string" ? t.videoEditionId : undefined
    const locale = typeof o.locale === "string" ? o.locale : undefined
    const cmsVideoId =
      typeof t.cmsVideoId === "number" ? t.cmsVideoId : undefined
    if (!coreId || !videoEditionId || !locale || cmsVideoId === undefined) {
      throw new RunEmbedsConfigError(
        `[run-embeds] failed scene outcome at reports.scene.outcomes[${index}] is missing target.coreId, target.videoEditionId, locale, or numeric target.cmsVideoId`,
      )
    }
    const key = `${coreId}::${videoEditionId}::${locale}`
    if (!byKey.has(key)) {
      byKey.set(key, { coreId, videoEditionId, locale, cmsVideoId })
    }
  })
  return [...byKey.values()].sort((a, b) => {
    const ak = `${a.coreId}::${a.videoEditionId}::${a.locale}`
    const bk = `${b.coreId}::${b.videoEditionId}::${b.locale}`
    return ak.localeCompare(bk)
  })
}

export function pipelineErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function pipelineErrorDetails(
  error: unknown,
): PipelineErrorDetails | undefined {
  if (!error || typeof error !== "object") return undefined
  const retrySelection = (error as Record<string, unknown>).retrySelection
  if (!isSceneRetrySelectionDetails(retrySelection)) return undefined
  return { retrySelection }
}

function isSceneRetrySelectionDetails(
  value: unknown,
): value is SceneRetrySelectionDetails {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.requested === "number" &&
    typeof record.matched === "number" &&
    typeof record.unmatched === "number" &&
    Array.isArray(record.unmatchedRetryTargets) &&
    record.unmatchedRetryTargets.every(isSceneRetryTargetSummary)
  )
}

function isSceneRetryTargetSummary(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.coreId === "string" &&
    typeof record.videoEditionId === "string" &&
    typeof record.locale === "string"
  )
}

export async function loadSceneRetryTargetsFromReport(
  reportPath: string,
): Promise<SceneRetryTargetFromReport[]> {
  let raw: string
  try {
    raw = await readFile(reportPath, "utf8")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new RunEmbedsConfigError(
      `[run-embeds] failed to read --from-report=${reportPath}: ${message}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new RunEmbedsConfigError(
      `[run-embeds] --from-report=${reportPath} is not valid JSON`,
    )
  }
  const retryTargets = extractFailedSceneRetryTargetsFromReport(parsed)
  if (retryTargets.length === 0) {
    throw new RunEmbedsConfigError(
      `[run-embeds] no failed scene outcomes found in ${reportPath}`,
    )
  }
  return retryTargets
}

export type SceneBranchPreflightReport = {
  ok: boolean
  checks: ReadonlyArray<{
    name: string
    status: string
    reason: string
  }>
}

export type SceneBranchReport = {
  totalTargets: number
  succeeded: number
  skipped: number
  failed: number
}

export type SceneBranchResult =
  | { ok: true; report: SceneBranchReport }
  | { ok: false; error: string; details?: PipelineErrorDetails }

export type EmbeddingBackfillMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export async function runSceneBranch(args: {
  mappingS3Key: string
  coreIds: readonly string[]
  locales: readonly string[]
  sceneMode?: EmbeddingBackfillMode
  sceneRetryTargets: readonly SceneRetryTargetFromReport[] | undefined
  runManagerArtifactsPreflight: (input: {
    mappingS3Key: string
    sampleSceneAssetId?: number
  }) => Promise<SceneBranchPreflightReport>
  runSceneEmbeddingBackfill: (input: {
    mappingS3Key: string
    coreIds?: readonly string[]
    locales?: readonly string[]
    retryTargets?: readonly SceneRetryTargetFromReport[]
    mode?: EmbeddingBackfillMode
  }) => Promise<SceneBranchReport>
  writeStdout?: (line: string) => void
}): Promise<SceneBranchResult> {
  const writeStdout = args.writeStdout ?? ((line) => process.stdout.write(line))

  try {
    const preflight = await args.runManagerArtifactsPreflight({
      mappingS3Key: args.mappingS3Key,
      sampleSceneAssetId: args.sceneRetryTargets?.[0]?.cmsVideoId,
    })
    writeStdout(
      JSON.stringify({
        event: "run-embeds.scene.preflight",
        ok: preflight.ok,
        checks: preflight.checks,
      }) + "\n",
    )
    if (!preflight.ok) {
      throw new Error(
        `scene preflight failed: ${preflight.checks
          .filter((check) => check.status === "failed")
          .map((check) => `${check.name}:${check.reason}`)
          .join(", ")}`,
      )
    }
    writeStdout(
      JSON.stringify({
        event: "run-embeds.scene.start",
        mappingS3Key: args.mappingS3Key,
        mode: args.sceneMode ?? "idempotent",
        retryTargets: args.sceneRetryTargets?.length ?? null,
      }) + "\n",
    )
    const report = await args.runSceneEmbeddingBackfill({
      mappingS3Key: args.mappingS3Key,
      coreIds: args.coreIds.length > 0 ? args.coreIds : undefined,
      locales: args.locales.length > 0 ? args.locales : undefined,
      retryTargets: args.sceneRetryTargets,
      mode: args.sceneMode,
    })
    writeStdout(
      JSON.stringify({
        event: "run-embeds.scene.complete",
        totalTargets: report.totalTargets,
        succeeded: report.succeeded,
        skipped: report.skipped,
        failed: report.failed,
      }) + "\n",
    )
    return { ok: true, report }
  } catch (err) {
    const error = pipelineErrorMessage(err)
    const details = pipelineErrorDetails(err)
    writeStdout(
      JSON.stringify({
        event: "run-embeds.scene.error",
        error,
        details,
      }) + "\n",
    )
    return details ? { ok: false, error, details } : { ok: false, error }
  }
}

type Pipeline = "scene" | "transcript" | "experience" | "both"

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

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function isPipeline(v: string): v is Pipeline {
  return (
    v === "scene" || v === "transcript" || v === "experience" || v === "both"
  )
}

function isEmbeddingBackfillMode(v: string): v is EmbeddingBackfillMode {
  return (
    v === "idempotent" ||
    v === "repair" ||
    v === "force" ||
    v === "model-upgrade"
  )
}

async function main(): Promise<void> {
  const pipelineArg = parseSingle("pipeline")
  if (!pipelineArg) {
    process.stderr.write(
      "[run-embeds] --pipeline=scene|transcript|experience|both is required\n",
    )
    process.exit(2)
  }
  if (!isPipeline(pipelineArg)) {
    process.stderr.write(
      `[run-embeds] invalid --pipeline=${pipelineArg}; expected scene|transcript|experience|both\n`,
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
  const sceneMode = parseSingle("scene-mode")
  const transcriptMode = parseSingle("transcript-mode")
  const experienceMode = parseSingle("experience-mode")
  const experienceIds = parseRepeated("experience-id")
  const force = parseFlag("force")
  // feat-119 PR1 — operators piping the report into PR2's
  // `pnpm trigger-enrichment --from-report=<path>` need a stable
  // file format. When unset, behavior is unchanged (stdout only).
  const reportOutPath = resolveReportOutPath(parseSingle("report-out"))
  const reportInPath = resolveReportInPath(parseSingle("from-report"))

  if (reportInPath !== undefined && pipelineArg !== "scene") {
    process.stderr.write(
      "[run-embeds] --from-report is only supported with --pipeline=scene\n",
    )
    process.exit(2)
  }
  if (sceneMode !== undefined && !isEmbeddingBackfillMode(sceneMode)) {
    process.stderr.write(
      `[run-embeds] invalid --scene-mode=${sceneMode}; expected idempotent|repair|force|model-upgrade\n`,
    )
    process.exit(1)
  }
  if (
    transcriptMode !== undefined &&
    !isEmbeddingBackfillMode(transcriptMode)
  ) {
    process.stderr.write(
      `[run-embeds] invalid --transcript-mode=${transcriptMode}; expected idempotent|repair|force|model-upgrade\n`,
    )
    process.exit(1)
  }
  if (
    experienceMode !== undefined &&
    !isEmbeddingBackfillMode(experienceMode)
  ) {
    process.stderr.write(
      `[run-embeds] invalid --experience-mode=${experienceMode}; expected idempotent|repair|force|model-upgrade\n`,
    )
    process.exit(1)
  }
  if (
    reportInPath !== undefined &&
    (coreIds.length > 0 || locales.length > 0 || languages.length > 0)
  ) {
    process.stderr.write(
      "[run-embeds] --from-report is mutually exclusive with --core-id/--locale/--language filters\n",
    )
    process.exit(2)
  }

  let sceneRetryTargets: SceneRetryTargetFromReport[] | undefined
  if (reportInPath !== undefined) {
    try {
      sceneRetryTargets = await loadSceneRetryTargetsFromReport(reportInPath)
    } catch (err) {
      if (err instanceof RunEmbedsConfigError) {
        process.stderr.write(err.message + "\n")
        process.exit(err.exitCode)
      }
      throw err
    }
  }

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
  const { runExperienceEmbeddingBackfill } =
    await import("@/workflows/experienceEmbeddingBackfill")
  const { prisma } = await import("@/db/client")
  const { env } = await import("@/config/env")
  const { runManagerArtifactsPreflight } =
    await import("@/services/manager-artifacts-preflight.service")

  const sceneConcurrency =
    env.SCENE_EMBEDDING_CONCURRENCY ?? DEFAULT_SCENE_EMBEDDING_CONCURRENCY
  const transcriptConcurrency =
    env.TRANSCRIPT_EMBEDDING_CONCURRENCY ??
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY
  const resolvedExperienceMode =
    experienceMode ?? (force ? "force" : "idempotent")
  const resolvedExperienceForce =
    experienceMode === undefined
      ? force
      : resolvedExperienceMode !== "idempotent"

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
      sceneMode: sceneMode ?? null,
      transcriptMode: transcriptMode ?? null,
      experienceMode: resolvedExperienceMode,
      experienceIds: experienceIds.length > 0 ? experienceIds : null,
      force: resolvedExperienceForce,
      sceneConcurrency,
      transcriptConcurrency,
      managerArtifactsBucket:
        process.env.MANAGER_ARTIFACTS_S3_BUCKET ?? "(unset)",
      fromReport: reportInPath ?? null,
      sceneRetryTargets: sceneRetryTargets?.length ?? null,
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
  const errorDetails: Record<string, PipelineErrorDetails> = {}

  try {
    if (pipelineArg === "scene" || pipelineArg === "both") {
      const sceneResult = await runSceneBranch({
        mappingS3Key,
        coreIds,
        locales,
        sceneMode,
        sceneRetryTargets,
        runManagerArtifactsPreflight,
        runSceneEmbeddingBackfill,
      })
      if (sceneResult.ok) {
        reports.scene = sceneResult.report
      } else {
        errors.scene = sceneResult.error
        if (sceneResult.details) {
          errorDetails.scene = sceneResult.details
        }
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
          mode: transcriptMode as
            | "idempotent"
            | "repair"
            | "force"
            | "model-upgrade"
            | undefined,
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

    // `pipeline=both` deliberately runs the original R1+R2 pair only.
    // Emit a structured `experience.skipped` event so agents/operators
    // parsing the event stream see the omission as an explicit signal
    // rather than absence-of-event. Pair with `--pipeline=experience`
    // (or, in the future, `--pipeline=all`) to also run R3.
    if (pipelineArg === "both") {
      process.stdout.write(
        JSON.stringify({
          event: "run-embeds.experience.skipped",
          reason: "pipeline_both_excludes_experience",
        }) + "\n",
      )
    }

    if (pipelineArg === "experience") {
      try {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.start",
            experienceIds: experienceIds.length > 0 ? experienceIds : null,
            locales: locales.length > 0 ? locales : null,
            force: resolvedExperienceForce,
            mode: resolvedExperienceMode,
          }) + "\n",
        )
        const experienceReport = await runExperienceEmbeddingBackfill({
          experienceIds: experienceIds.length > 0 ? experienceIds : undefined,
          bcp47Locales: locales.length > 0 ? locales : undefined,
          force: resolvedExperienceForce,
          mode: experienceMode as
            | "idempotent"
            | "repair"
            | "force"
            | "model-upgrade"
            | undefined,
        })
        reports.experience = experienceReport
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.complete",
            totalTargets: experienceReport.totalTargets,
            succeeded: experienceReport.succeeded,
            failed: experienceReport.failed,
          }) + "\n",
        )
      } catch (err) {
        errors.experience = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.error",
            error: errors.experience,
          }) + "\n",
        )
      }
    }

    const finalReport = {
      event: "run-embeds.complete" as const,
      pipeline: pipelineArg,
      wallClockMs: Date.now() - startedAt,
      reports,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      errorDetails:
        Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
    }

    process.stdout.write(JSON.stringify(finalReport, null, 2) + "\n")

    // feat-119 PR1 — optional file dump. Side-channel write failures
    // do NOT alter the script's exit code (the report is already on
    // stdout). See `writeReportToPath`.
    if (reportOutPath !== undefined) {
      const writeResult = await writeReportToPath(reportOutPath, finalReport)
      if (writeResult.ok) {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.report_out_written",
            path: reportOutPath,
          }) + "\n",
        )
      } else {
        process.stderr.write(
          JSON.stringify({
            event: "run-embeds.report_out_error",
            path: reportOutPath,
            error: writeResult.error,
          }) + "\n",
        )
      }
    }

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
