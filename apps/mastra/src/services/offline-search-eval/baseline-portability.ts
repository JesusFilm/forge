import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { env, getServingSearchEvalConfig } from "../../config/env"
import {
  BaselineArtifactSchema,
  SearchEvalArtifactError,
  SearchEvalReportSchema,
  createSearchEvalArtifactStore,
  searchEvalArtifactRoot,
  type SearchEvalArtifactStore,
} from "./artifacts"
import { SEARCH_EVAL_SEED_PROMPT_SET_VERSION } from "./seed-prompt-set"
import type { BaselineArtifact, SearchEvalReport } from "./types"

export const SEARCH_EVAL_BASELINE_PORTABILITY_SCHEMA_VERSION = "1" as const
export const SEARCH_EVAL_BASELINE_PORTABILITY_MAX_REPORTS = 3
export const SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES = 32 * 1024 * 1024

export const SearchEvalBaselineExportArtifactSchema = z
  .object({
    schemaVersion: z.literal(SEARCH_EVAL_BASELINE_PORTABILITY_SCHEMA_VERSION),
    kind: z.literal("search-eval-baseline-export"),
    exportId: z.string().min(1).max(128),
    exportedAt: z.string(),
    sourceEnvironment: z.string().min(1).max(64),
    baselineName: z.string().min(1).max(128),
    promptSetVersion: z.string().min(1).max(128),
    baseline: BaselineArtifactSchema,
    reports: z
      .array(SearchEvalReportSchema)
      .max(SEARCH_EVAL_BASELINE_PORTABILITY_MAX_REPORTS),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.baseline.name !== artifact.baselineName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline", "name"],
        message: "baseline name must match export baselineName",
      })
    }
    if (artifact.baseline.metadata.baselineName !== artifact.baselineName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline", "metadata", "baselineName"],
        message: "baseline metadata must match export baselineName",
      })
    }
    if (
      artifact.baseline.metadata.promptSetVersion !== artifact.promptSetVersion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseline", "metadata", "promptSetVersion"],
        message: "baseline prompt set must match export promptSetVersion",
      })
    }
    artifact.reports.forEach((report, index) => {
      if (report.metadata.baselineName !== artifact.baselineName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reports", index, "metadata", "baselineName"],
          message: "report baseline name must match export baselineName",
        })
      }
      if (report.metadata.promptSetVersion !== artifact.promptSetVersion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reports", index, "metadata", "promptSetVersion"],
          message: "report prompt set must match export promptSetVersion",
        })
      }
    })
  })

export type SearchEvalBaselineExportArtifact = z.infer<
  typeof SearchEvalBaselineExportArtifactSchema
>

export type SearchEvalReadinessCheck = {
  name:
    | "admin_search_url"
    | "admin_search_bearer"
    | "admin_serving_search_url"
    | "admin_serving_search_bearer"
    | "mastra_service_keys"
    | "runtime_storage"
    | "database_url"
    | "artifact_root"
    | "artifact_store_probe"
  status: "pass" | "fail"
  reason?: string
}

export type SearchEvalBaselineReadiness = {
  ok: boolean
  artifactRoot: string | null
  checks: SearchEvalReadinessCheck[]
}

export type SearchEvalPortabilityAudit = {
  action: "preflight" | "export-baseline" | "import-baseline"
  environment: string
  baselineName?: string
  reportIds: string[]
  artifactBytes: number
  result: "ready" | "not_ready" | "exported" | "imported" | "failed" | "blocked"
}

export class SearchEvalPortabilityError extends Error {
  constructor(
    readonly code:
      | "artifact_invalid"
      | "artifact_not_found"
      | "artifact_read_failed"
      | "artifact_write_failed"
      | "artifact_too_large"
      | "import_disabled"
      | "invalid_input"
      | "not_seed_only"
      | "readiness_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SearchEvalPortabilityError"
  }
}

type PortabilityOptions = {
  artifactStore?: SearchEvalArtifactStore
  now?: () => Date
  exportId?: string
  sourceEnvironment?: string
  allowProductionImport?: boolean
}

export async function checkSearchEvalBaselineReadiness(
  options: {
    artifactRoot?: string
    probe?: boolean
  } = {},
): Promise<SearchEvalBaselineReadiness> {
  const rootDir = options.artifactRoot ?? searchEvalArtifactRoot()
  const serving = getServingSearchEvalConfig()
  const checks: SearchEvalReadinessCheck[] = [
    env.ADMIN_SEARCH_EVAL_SEARCH_URL
      ? pass("admin_search_url")
      : fail("admin_search_url", "missing_admin_search_eval_search_url"),
    env.ADMIN_SEARCH_EVAL_API_KEY
      ? pass("admin_search_bearer")
      : fail("admin_search_bearer", "missing_admin_search_eval_api_key"),
    serving.url
      ? pass("admin_serving_search_url")
      : fail(
          "admin_serving_search_url",
          "missing_admin_search_eval_serving_url",
        ),
    serving.bearer
      ? pass("admin_serving_search_bearer")
      : fail(
          "admin_serving_search_bearer",
          "missing_admin_search_eval_serving_api_key",
        ),
    env.MASTRA_SERVICE_API_KEYS
      ? pass("mastra_service_keys")
      : fail("mastra_service_keys", "missing_mastra_service_api_keys"),
    env.NODE_ENV === "production" && env.MASTRA_STORAGE_BACKEND === "memory"
      ? fail("runtime_storage", "memory_storage_not_allowed_in_production")
      : pass("runtime_storage"),
    env.NODE_ENV === "production" && !env.DATABASE_URL
      ? fail("database_url", "missing_database_url")
      : pass("database_url"),
    productionArtifactRootIsPersistent()
      ? pass("artifact_root")
      : fail("artifact_root", "missing_persistent_artifact_root"),
  ]

  if (options.probe ?? true) {
    checks.push(await probeArtifactRoot(rootDir))
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    artifactRoot: rootDir,
    checks,
  }
}

export async function exportSearchEvalBaselineArtifact(input: {
  baselineName: string
  reportIds?: readonly string[]
  options?: PortabilityOptions
}): Promise<{
  artifact: SearchEvalBaselineExportArtifact
  audit: SearchEvalPortabilityAudit
}> {
  const artifactStore =
    input.options?.artifactStore ?? createSearchEvalArtifactStore()
  const reportIds = [...(input.reportIds ?? [])]
  if (reportIds.length > SEARCH_EVAL_BASELINE_PORTABILITY_MAX_REPORTS) {
    throw new SearchEvalPortabilityError(
      "invalid_input",
      "too many report ids requested for export",
    )
  }

  let baseline: BaselineArtifact
  let reports: SearchEvalReport[]
  try {
    baseline = await artifactStore.readBaseline(input.baselineName)
    reports = await Promise.all(
      reportIds.map((reportId) => artifactStore.readReport(reportId)),
    )
  } catch (error) {
    throw portabilityFailure(error)
  }

  assertSeedOnlyBaseline(baseline)
  for (const report of reports) {
    assertSeedOnlyReport(report, baseline)
  }

  const now = input.options?.now ?? (() => new Date())
  const artifact = SearchEvalBaselineExportArtifactSchema.parse({
    schemaVersion: SEARCH_EVAL_BASELINE_PORTABILITY_SCHEMA_VERSION,
    kind: "search-eval-baseline-export",
    exportId: input.options?.exportId ?? randomUUID(),
    exportedAt: now().toISOString(),
    sourceEnvironment:
      input.options?.sourceEnvironment ?? searchEvalPortabilityEnvironment(),
    baselineName: baseline.name,
    promptSetVersion: baseline.metadata.promptSetVersion,
    baseline,
    reports,
  })
  const artifactBytes = byteLength(artifact)
  if (artifactBytes > SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES) {
    throw new SearchEvalPortabilityError(
      "artifact_too_large",
      "search eval baseline export exceeds portability byte limit",
    )
  }

  return {
    artifact,
    audit: auditFor({
      action: "export-baseline",
      baselineName: baseline.name,
      reportIds,
      artifactBytes,
      result: "exported",
    }),
  }
}

export async function importSearchEvalBaselineArtifact(input: {
  artifact: unknown
  options?: PortabilityOptions
}): Promise<{
  baselineName: string
  reportIds: string[]
  audit: SearchEvalPortabilityAudit
}> {
  if (
    env.NODE_ENV === "production" &&
    input.options?.allowProductionImport !== true &&
    env.MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT !== "true"
  ) {
    throw new SearchEvalPortabilityError(
      "import_disabled",
      "search eval baseline import is disabled in production",
    )
  }

  const artifactBytes = byteLength(input.artifact)
  if (artifactBytes > SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES) {
    throw new SearchEvalPortabilityError(
      "artifact_too_large",
      "search eval baseline import exceeds portability byte limit",
    )
  }

  const parsed = SearchEvalBaselineExportArtifactSchema.safeParse(
    input.artifact,
  )
  if (!parsed.success) {
    throw new SearchEvalPortabilityError(
      "artifact_invalid",
      "search eval baseline import failed validation",
      parsed.error,
    )
  }
  const artifact = parsed.data
  assertSeedOnlyBaseline(artifact.baseline)
  for (const report of artifact.reports) {
    assertSeedOnlyReport(report, artifact.baseline)
  }

  const artifactStore =
    input.options?.artifactStore ?? createSearchEvalArtifactStore()
  try {
    for (const report of artifact.reports) {
      await artifactStore.writeReport(report)
    }
    await artifactStore.writeBaseline(artifact.baseline)
  } catch (error) {
    throw portabilityFailure(error)
  }

  const reportIds = artifact.reports.map((report) => report.reportId)
  return {
    baselineName: artifact.baselineName,
    reportIds,
    audit: auditFor({
      action: "import-baseline",
      baselineName: artifact.baselineName,
      reportIds,
      artifactBytes,
      result: "imported",
    }),
  }
}

export function assertSeedOnlyBaseline(baseline: BaselineArtifact) {
  if (
    baseline.metadata.promptSetVersion !== SEARCH_EVAL_SEED_PROMPT_SET_VERSION
  ) {
    throw new SearchEvalPortabilityError(
      "not_seed_only",
      "baseline prompt set is not the committed seed prompt set",
    )
  }
  if (
    baseline.cases.some(
      (entry) => entry.source !== "seed" || entry.searchFailure != null,
    )
  ) {
    throw new SearchEvalPortabilityError(
      "not_seed_only",
      "baseline contains non-seed or failed cases",
    )
  }
}

export function assertSeedOnlyReport(
  report: SearchEvalReport,
  baseline: BaselineArtifact,
) {
  const behavior = report.generatedCandidateBehavior
  const seedOnlyPromptMix =
    Object.keys(report.promptSourceMix).length === 1 &&
    report.promptSourceMix.seed === report.totals.queries
  if (
    report.metadata.baselineName !== baseline.name ||
    report.metadata.promptSetVersion !== baseline.metadata.promptSetVersion ||
    !seedOnlyPromptMix ||
    behavior.included !== 0 ||
    behavior.searched !== 0 ||
    behavior.traceDerived !== 0 ||
    behavior.skippedTraceDerived !== 0 ||
    behavior.searchFailures !== 0 ||
    behavior.readFailure != null ||
    report.exploratoryGenerated.length !== 0 ||
    report.outcomes.some((outcome) => outcome.source !== "seed")
  ) {
    throw new SearchEvalPortabilityError(
      "not_seed_only",
      "report is not eligible for seed-only portability export",
    )
  }
}

function searchEvalPortabilityEnvironment() {
  const raw = env.MASTRA_NATIVE_EVAL_ENVIRONMENT ?? env.NODE_ENV
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 64)
}

function auditFor(input: {
  action: SearchEvalPortabilityAudit["action"]
  baselineName?: string
  reportIds?: readonly string[]
  artifactBytes?: number
  result: SearchEvalPortabilityAudit["result"]
}): SearchEvalPortabilityAudit {
  return {
    action: input.action,
    environment: searchEvalPortabilityEnvironment(),
    baselineName: input.baselineName,
    reportIds: [...(input.reportIds ?? [])],
    artifactBytes: input.artifactBytes ?? 0,
    result: input.result,
  }
}

function productionArtifactRootIsPersistent() {
  if (env.NODE_ENV !== "production") return true
  return Boolean(
    env.MASTRA_SEARCH_EVAL_ARTIFACT_DIR ||
    env.MASTRA_STORAGE_DIR ||
    env.RAILWAY_VOLUME_MOUNT_PATH,
  )
}

function pass(
  name: SearchEvalReadinessCheck["name"],
): SearchEvalReadinessCheck {
  return { name, status: "pass" }
}

function fail(
  name: SearchEvalReadinessCheck["name"],
  reason: string,
): SearchEvalReadinessCheck {
  return { name, status: "fail", reason }
}

async function probeArtifactRoot(
  rootDir: string,
): Promise<SearchEvalReadinessCheck> {
  const probeDir = path.join(rootDir, "probes")
  const probePath = path.join(probeDir, `.probe-${randomUUID()}.json`)
  try {
    await mkdir(probeDir, { recursive: true })
    await writeFile(probePath, '{"ok":true}\n', "utf8")
    const text = await readFile(probePath, "utf8")
    if (text !== '{"ok":true}\n') {
      return fail("artifact_store_probe", "artifact_probe_read_mismatch")
    }
    await rm(probePath, { force: true })
    return pass("artifact_store_probe")
  } catch {
    await rm(probePath, { force: true }).catch(() => undefined)
    return fail("artifact_store_probe", "artifact_probe_failed")
  }
}

function portabilityFailure(error: unknown): SearchEvalPortabilityError {
  if (error instanceof SearchEvalPortabilityError) return error
  if (error instanceof SearchEvalArtifactError) {
    if (error.code === "not_found") {
      return new SearchEvalPortabilityError(
        "artifact_not_found",
        error.message,
        error,
      )
    }
    if (error.code === "write_failed") {
      return new SearchEvalPortabilityError(
        "artifact_write_failed",
        error.message,
        error,
      )
    }
    if (error.code === "read_failed") {
      return new SearchEvalPortabilityError(
        "artifact_read_failed",
        error.message,
        error,
      )
    }
    return new SearchEvalPortabilityError(
      "artifact_invalid",
      error.message,
      error,
    )
  }
  return new SearchEvalPortabilityError(
    "artifact_invalid",
    "search eval portability operation failed",
    error,
  )
}

function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

export const _internal = {
  auditFor,
  byteLength,
  productionArtifactRootIsPersistent,
  probeArtifactRoot,
}
