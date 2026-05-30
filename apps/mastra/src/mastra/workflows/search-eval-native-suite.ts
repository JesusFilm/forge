import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  callAdminCandidateList,
  type AdminCandidateListResponse,
  type AdminSearchEvalClientResult,
} from "../../services/admin-search-eval-client"
import {
  SearchEvalArtifactError,
  SearchEvalReportSchema,
  createSearchEvalArtifactStore,
  type SearchEvalArtifactStore,
} from "../../services/offline-search-eval/artifacts"
import {
  createSampleSearchEvalReport,
  isSampleNativeSearchEvalAllowed,
  searchEvalNativeEnvironmentLabel,
  syncPromotedCandidatesToNativeDataset,
  syncSearchEvalReportToNativeEvaluation,
  withNativeMastraEvaluationProjection,
  type NativeSearchEvalMastra,
} from "../../services/offline-search-eval/native-evaluation"

export const SEARCH_EVAL_NATIVE_SUITE_MAX_BODY_BYTES = 8192
const WORKFLOW_FAILURE_ERROR_PREFIX = "SEARCH_EVAL_NATIVE_SUITE_FAILED:"
const DEFAULT_SAMPLE_BASELINE_NAME = "local-smoke"

export const SearchEvalNativeSuiteWorkflowInputSchema = z
  .object({
    action: z
      .enum(["create-sample-report", "sync-report", "sync-promoted"])
      .default("create-sample-report")
      .describe(
        "Create a local sample report and native suite, sync an existing report, or sync promoted Admin candidates.",
      ),
    reportId: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
      .optional()
      .describe("Report id to sync when action is sync-report."),
    baselineName: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
      .default(DEFAULT_SAMPLE_BASELINE_NAME)
      .describe("Sample baseline name for create-sample-report."),
    environmentLabel: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Native Evaluation environment label. Defaults to Mastra env."),
    promotedLimit: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(100)
      .describe("Maximum promoted Admin candidates to sync."),
  })
  .strict()

export type SearchEvalNativeSuiteWorkflowInput = z.output<
  typeof SearchEvalNativeSuiteWorkflowInputSchema
>

const FailureReasonSchema = z.enum([
  "invalid_input",
  "runtime_unavailable",
  "sample_not_allowed",
  "artifact_not_found",
  "artifact_invalid",
  "artifact_read_failed",
  "artifact_write_failed",
  "native_sync_failed",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_read_failed",
  "admin_read_rejected",
])

const NativeSuiteResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      action: SearchEvalNativeSuiteWorkflowInputSchema.shape.action,
      mastraRunId: z.string(),
      environmentLabel: z.string(),
      reportId: z.string().optional(),
      reportPath: z.string().optional(),
      report: SearchEvalReportSchema.optional(),
      projection: z.unknown().optional(),
      dataset: z.unknown().optional(),
      scorer: z.unknown().optional(),
      experiment: z.unknown().optional(),
      promoted: z.unknown().optional(),
      skipped: z.array(z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: FailureReasonSchema,
      retryable: z.boolean(),
      reportPath: z.string().optional(),
      adminStatus: z.string().optional(),
      adminReason: z.string().optional(),
    })
    .strict(),
])

export type SearchEvalNativeSuiteWorkflowResult = z.infer<
  typeof NativeSuiteResultSchema
>
type SearchEvalNativeSuiteFailure = Extract<
  SearchEvalNativeSuiteWorkflowResult,
  { ok: false }
>

type NativeRuntimeResolver = () => NativeSearchEvalMastra | null | undefined
let nativeRuntimeResolver: NativeRuntimeResolver | null = null

export function configureSearchEvalNativeSuiteRuntime(
  resolver: NativeRuntimeResolver,
) {
  nativeRuntimeResolver = resolver
}

type WorkflowOptions = {
  runId?: string
  mastra?: NativeSearchEvalMastra
  artifactStore?: SearchEvalArtifactStore
  adminBearer?: string
  candidateUrl?: string
  listClient?: typeof callAdminCandidateList
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request?: Request
  readJson?: () => Promise<unknown>
  launch?: (
    input: SearchEvalNativeSuiteWorkflowInput,
    options: { runId: string },
  ) => Promise<SearchEvalNativeSuiteWorkflowResult>
}

export type SearchEvalNativeSuiteRouteOutcome = {
  status: number
  body: { result?: SearchEvalNativeSuiteWorkflowResult; error?: string }
}

class SearchEvalNativeSuiteWorkflowFailureError extends Error {
  constructor(readonly result: SearchEvalNativeSuiteFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "SearchEvalNativeSuiteWorkflowFailureError"
  }
}

class NativeSuiteRouteBodyError extends Error {
  constructor(
    readonly code: "payload_too_large" | "invalid_json",
    readonly cause?: unknown,
  ) {
    super(code)
    this.name = "NativeSuiteRouteBodyError"
  }
}

function failure(
  reason: SearchEvalNativeSuiteFailure["reason"],
  options: {
    retryable: boolean
    reportPath?: string
    adminStatus?: string
    adminReason?: string
  },
): SearchEvalNativeSuiteFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    reportPath: options.reportPath,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

function throwWorkflowFailure(result: SearchEvalNativeSuiteFailure): never {
  throw new SearchEvalNativeSuiteWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): SearchEvalNativeSuiteFailure | null {
  if (value instanceof SearchEvalNativeSuiteWorkflowFailureError) {
    return value.result
  }
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : ""
  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null
  let payload: unknown
  try {
    payload = JSON.parse(
      message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
    )
  } catch {
    return null
  }
  const parsed = NativeSuiteResultSchema.safeParse(payload)
  return parsed.success && !parsed.data.ok ? parsed.data : null
}

function resolveMastra(
  options: WorkflowOptions,
): NativeSearchEvalMastra | null {
  return options.mastra ?? nativeRuntimeResolver?.() ?? null
}

function artifactFailure(error: unknown): SearchEvalNativeSuiteFailure | null {
  if (!(error instanceof SearchEvalArtifactError)) return null
  if (error.code === "not_found") {
    return failure("artifact_not_found", { retryable: false })
  }
  if (error.code === "invalid_artifact" || error.code === "invalid_name") {
    return failure("artifact_invalid", { retryable: false })
  }
  if (error.code === "write_failed") {
    return failure("artifact_write_failed", { retryable: true })
  }
  return failure("artifact_read_failed", { retryable: true })
}

function adminFailure(
  result: Exclude<
    AdminSearchEvalClientResult<AdminCandidateListResponse>,
    { ok: true; result: AdminCandidateListResponse }
  >,
): SearchEvalNativeSuiteFailure {
  if (result.reason === "config_missing") {
    return failure("admin_config_missing", { retryable: false })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
      adminReason: result.adminReason,
    })
  }
  if (result.reason === "rejected") {
    return failure("admin_read_rejected", {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
      adminReason: result.adminReason,
    })
  }
  return failure("admin_read_failed", {
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

export async function runSearchEvalNativeSuiteWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<SearchEvalNativeSuiteWorkflowResult> {
  const parsed = SearchEvalNativeSuiteWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) return failure("invalid_input", { retryable: false })

  const input = parsed.data
  const mastraRunId = options.runId ?? randomUUID()
  const environmentLabel = searchEvalNativeEnvironmentLabel(
    input.environmentLabel,
  )
  const mastra = resolveMastra(options)
  if (!mastra) return failure("runtime_unavailable", { retryable: true })

  const artifactStore = options.artifactStore ?? createSearchEvalArtifactStore()

  if (input.action === "create-sample-report") {
    if (!isSampleNativeSearchEvalAllowed(environmentLabel)) {
      return failure("sample_not_allowed", { retryable: false })
    }
    const report = createSampleSearchEvalReport({
      runId: mastraRunId,
      baselineName: input.baselineName,
    })
    let reportPath: string
    try {
      reportPath = (await artifactStore.writeReport(report)).path
    } catch (error) {
      return (
        artifactFailure(error) ??
        failure("artifact_write_failed", { retryable: true })
      )
    }
    try {
      const synced = await syncSearchEvalReportToNativeEvaluation({
        mastra,
        report,
        reportPath,
        environmentLabel,
      })
      const syncedReport = withNativeMastraEvaluationProjection(
        report,
        synced.projection,
      )
      await artifactStore.writeReport(syncedReport)
      return {
        ok: true,
        action: input.action,
        mastraRunId,
        environmentLabel,
        reportId: report.reportId,
        reportPath,
        report: syncedReport,
        projection: synced.projection,
        dataset: {
          datasetId: synced.dataset.datasetId,
          name: synced.dataset.name,
          status: synced.dataset.status,
          itemCount: synced.dataset.itemCount,
          createdItems: synced.dataset.createdItems,
          updatedItems: synced.dataset.updatedItems,
        },
        scorer: {
          scorerId: synced.scorer.scorerId,
          status: synced.scorer.status,
        },
        experiment: synced.experiment,
      }
    } catch {
      return failure("native_sync_failed", { retryable: true, reportPath })
    }
  }

  if (input.action === "sync-report") {
    if (!input.reportId) return failure("invalid_input", { retryable: false })
    try {
      const report = await artifactStore.readReport(input.reportId)
      const reportPath = `${artifactStore.rootDir.replace(/\/$/, "")}/reports/${input.reportId}.json`
      const synced = await syncSearchEvalReportToNativeEvaluation({
        mastra,
        report,
        reportPath,
        environmentLabel,
      })
      const syncedReport = withNativeMastraEvaluationProjection(
        report,
        synced.projection,
      )
      await artifactStore.writeReport(syncedReport)
      return {
        ok: true,
        action: input.action,
        mastraRunId,
        environmentLabel,
        reportId: report.reportId,
        reportPath,
        report: syncedReport,
        projection: synced.projection,
        dataset: {
          datasetId: synced.dataset.datasetId,
          name: synced.dataset.name,
          status: synced.dataset.status,
          itemCount: synced.dataset.itemCount,
          createdItems: synced.dataset.createdItems,
          updatedItems: synced.dataset.updatedItems,
        },
        scorer: {
          scorerId: synced.scorer.scorerId,
          status: synced.scorer.status,
        },
        experiment: synced.experiment,
      }
    } catch (error) {
      return (
        artifactFailure(error) ??
        failure("native_sync_failed", { retryable: true })
      )
    }
  }

  const result = await (options.listClient ?? callAdminCandidateList)({
    url: options.candidateUrl ?? env.ADMIN_SEARCH_EVAL_CANDIDATES_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    filters: { statuses: ["promoted"], limit: input.promotedLimit },
  })
  if (!result.ok) return adminFailure(result)
  try {
    const synced = await syncPromotedCandidatesToNativeDataset({
      mastra,
      candidates: result.result.candidates,
      environmentLabel,
    })
    return {
      ok: true,
      action: input.action,
      mastraRunId,
      environmentLabel,
      dataset: {
        datasetId: synced.dataset.datasetId,
        name: synced.dataset.name,
        status: synced.dataset.status,
        itemCount: synced.dataset.itemCount,
        createdItems: synced.dataset.createdItems,
        updatedItems: synced.dataset.updatedItems,
      },
      scorer: {
        scorerId: synced.scorer.scorerId,
        status: synced.scorer.status,
      },
      promoted: { received: result.result.candidates.length },
      skipped: synced.skipped,
    }
  } catch {
    return failure("native_sync_failed", { retryable: true })
  }
}

const nativeSuiteStep = createStep({
  id: "run-search-eval-native-suite",
  description:
    "Project search eval report artifacts and promoted candidates into native Mastra Evaluation records.",
  inputSchema: SearchEvalNativeSuiteWorkflowInputSchema,
  outputSchema: NativeSuiteResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSearchEvalNativeSuiteWorkflow(inputData, { runId })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const searchEvalNativeSuiteWorkflow = createWorkflow({
  id: "search-eval-native-suite",
  description:
    "Sync Forge search eval artifacts and promoted truth into native Mastra Evaluation datasets, scorers, and experiments.",
  inputSchema: SearchEvalNativeSuiteWorkflowInputSchema,
  outputSchema: NativeSuiteResultSchema,
})
  .then(nativeSuiteStep)
  .commit()

export async function launchSearchEvalNativeSuiteWorkflow(
  rawInput: SearchEvalNativeSuiteWorkflowInput,
  options: { runId?: string } = {},
): Promise<SearchEvalNativeSuiteWorkflowResult> {
  const parsed = SearchEvalNativeSuiteWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) return failure("invalid_input", { retryable: false })
  const runId = options.runId ?? randomUUID()
  const run = await searchEvalNativeSuiteWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("native_sync_failed", { retryable: true })
    )
  }
  if (result?.status === "success") {
    return result.result as SearchEvalNativeSuiteWorkflowResult
  }
  return failure("native_sync_failed", { retryable: true })
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isFinite(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > SEARCH_EVAL_NATIVE_SUITE_MAX_BODY_BYTES
    ) {
      throw new NativeSuiteRouteBodyError("payload_too_large")
    }
  }

  const body = request.body
  if (body == null) throw new NativeSuiteRouteBodyError("invalid_json")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > SEARCH_EVAL_NATIVE_SUITE_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new NativeSuiteRouteBodyError("payload_too_large")
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new NativeSuiteRouteBodyError("invalid_json", cause)
  }
}

function routeStatusForResult(result: SearchEvalNativeSuiteWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "sample_not_allowed") return 403
  if (result.reason === "runtime_unavailable") return 503
  if (result.reason === "artifact_not_found") return 404
  if (result.reason === "artifact_invalid") return 400
  if (result.reason === "admin_config_missing") return 503
  if (result.reason === "admin_auth_failed") return 502
  if (result.reason === "admin_read_rejected") return 409
  return 502
}

export async function handleSearchEvalNativeSuiteRouteRequest({
  authHeader,
  serviceKeys,
  request,
  readJson,
  launch = launchSearchEvalNativeSuiteWorkflow,
}: RouteHandlerInput): Promise<SearchEvalNativeSuiteRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  let body: unknown
  try {
    body = request ? await readBoundedJson(request) : await readJson?.()
  } catch (error) {
    return {
      status:
        error instanceof NativeSuiteRouteBodyError &&
        error.code === "payload_too_large"
          ? 413
          : 400,
      body: { result: failure("invalid_input", { retryable: false }) },
    }
  }
  const parsed = SearchEvalNativeSuiteWorkflowInputSchema.safeParse(body)
  const result = parsed.success
    ? await launch(parsed.data, { runId }).catch(() =>
        failure("native_sync_failed", { retryable: true }),
      )
    : failure("invalid_input", { retryable: false })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internal = {
  FailureReasonSchema,
  NativeSuiteResultSchema,
  workflowFailureFromUnknown,
}
