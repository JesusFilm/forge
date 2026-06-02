import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES,
  SEARCH_EVAL_BASELINE_PORTABILITY_MAX_REPORTS,
  SearchEvalBaselineExportArtifactSchema,
  SearchEvalPortabilityError,
  checkSearchEvalBaselineReadiness,
  exportSearchEvalBaselineArtifact,
  importSearchEvalBaselineArtifact,
  type SearchEvalBaselineReadiness,
  type SearchEvalPortabilityAudit,
} from "../../services/offline-search-eval/baseline-portability"

const WORKFLOW_FAILURE_ERROR_PREFIX = "SEARCH_EVAL_BASELINE_PORTABILITY_FAILED:"
const DEFAULT_BASELINE_NAME = "seed-baseline"

const SafeNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
const ActionSchema = z.enum(["preflight", "export-baseline", "import-baseline"])

export const SearchEvalBaselinePortabilityInputSchema = z
  .object({
    action: ActionSchema.default("preflight"),
    baselineName: SafeNameSchema.default(DEFAULT_BASELINE_NAME),
    reportIds: z
      .array(SafeNameSchema)
      .max(SEARCH_EVAL_BASELINE_PORTABILITY_MAX_REPORTS)
      .default([]),
    artifact: SearchEvalBaselineExportArtifactSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "import-baseline" && !input.artifact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact"],
        message: "artifact is required for import-baseline",
      })
    }
  })

export type SearchEvalBaselinePortabilityInput = z.output<
  typeof SearchEvalBaselinePortabilityInputSchema
>

const ReadinessResultSchema = z
  .object({
    ok: z.boolean(),
    artifactRoot: z.string().nullable(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["pass", "fail"]),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()

const AuditSchema = z
  .object({
    action: z.enum(["preflight", "export-baseline", "import-baseline"]),
    environment: z.string(),
    baselineName: z.string().optional(),
    reportIds: z.array(z.string()),
    artifactBytes: z.number().int().nonnegative(),
    result: z.enum([
      "ready",
      "not_ready",
      "exported",
      "imported",
      "failed",
      "blocked",
    ]),
  })
  .strict()

const FailureReasonSchema = z.enum([
  "invalid_input",
  "artifact_not_found",
  "artifact_invalid",
  "artifact_read_failed",
  "artifact_write_failed",
  "artifact_too_large",
  "import_disabled",
  "not_seed_only",
  "readiness_failed",
])

const SearchEvalBaselinePortabilityResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      action: ActionSchema,
      mastraRunId: z.string(),
      readiness: ReadinessResultSchema.optional(),
      artifact: SearchEvalBaselineExportArtifactSchema.optional(),
      baselineName: z.string().optional(),
      reportIds: z.array(z.string()).optional(),
      audit: AuditSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: FailureReasonSchema,
      retryable: z.boolean(),
      mastraRunId: z.string(),
      audit: AuditSchema.optional(),
    })
    .strict(),
])

export type SearchEvalBaselinePortabilityResult = z.infer<
  typeof SearchEvalBaselinePortabilityResultSchema
>
type SearchEvalBaselinePortabilityFailure = Extract<
  SearchEvalBaselinePortabilityResult,
  { ok: false }
>

type WorkflowOptions = {
  runId?: string
  checkReadiness?: () => Promise<SearchEvalBaselineReadiness>
  exportBaseline?: typeof exportSearchEvalBaselineArtifact
  importBaseline?: typeof importSearchEvalBaselineArtifact
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request?: Request
  readJson?: () => Promise<unknown>
  launch?: (
    input: SearchEvalBaselinePortabilityInput,
    options: { runId: string },
  ) => Promise<SearchEvalBaselinePortabilityResult>
}

export type SearchEvalBaselinePortabilityRouteOutcome = {
  status: number
  body: {
    result?: SearchEvalBaselinePortabilityResult
    error?: string
  }
}

class SearchEvalBaselinePortabilityWorkflowFailureError extends Error {
  constructor(readonly result: SearchEvalBaselinePortabilityFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "SearchEvalBaselinePortabilityWorkflowFailureError"
  }
}

class PortabilityRouteBodyError extends Error {
  constructor(readonly code: "payload_too_large" | "invalid_json") {
    super(code)
    this.name = "PortabilityRouteBodyError"
  }
}

function failure(
  reason: z.infer<typeof FailureReasonSchema>,
  options: {
    retryable: boolean
    mastraRunId: string
    audit?: SearchEvalPortabilityAudit
  },
): SearchEvalBaselinePortabilityFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    audit: options.audit,
  }
}

function auditFor(input: {
  action: SearchEvalBaselinePortabilityInput["action"]
  baselineName?: string
  reportIds?: readonly string[]
  result: SearchEvalPortabilityAudit["result"]
}): SearchEvalPortabilityAudit {
  return {
    action: input.action,
    environment: "unknown",
    baselineName: input.baselineName,
    reportIds: [...(input.reportIds ?? [])],
    artifactBytes: 0,
    result: input.result,
  }
}

function portabilityFailure(
  error: unknown,
  mastraRunId: string,
  input: SearchEvalBaselinePortabilityInput,
): SearchEvalBaselinePortabilityFailure {
  if (error instanceof SearchEvalPortabilityError) {
    return failure(error.code, {
      retryable:
        error.code === "artifact_read_failed" ||
        error.code === "artifact_write_failed",
      mastraRunId,
      audit: auditFor({
        action: input.action,
        baselineName: input.baselineName,
        reportIds: input.reportIds,
        result: error.code === "import_disabled" ? "blocked" : "failed",
      }),
    })
  }
  return failure("artifact_invalid", {
    retryable: false,
    mastraRunId,
    audit: auditFor({
      action: input.action,
      baselineName: input.baselineName,
      reportIds: input.reportIds,
      result: "failed",
    }),
  })
}

export async function runSearchEvalBaselinePortabilityWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<SearchEvalBaselinePortabilityResult> {
  const parsed = SearchEvalBaselinePortabilityInputSchema.safeParse(rawInput)
  const mastraRunId = options.runId ?? randomUUID()
  if (!parsed.success) {
    return failure("invalid_input", {
      retryable: false,
      mastraRunId,
      audit: auditFor({ action: "preflight", result: "failed" }),
    })
  }

  const input = parsed.data
  try {
    if (input.action === "preflight") {
      const readiness = await (
        options.checkReadiness ?? checkSearchEvalBaselineReadiness
      )()
      return {
        ok: true,
        action: input.action,
        mastraRunId,
        readiness,
        audit: {
          action: "preflight",
          environment: "unknown",
          reportIds: [],
          artifactBytes: 0,
          result: readiness.ok ? "ready" : "not_ready",
        },
      }
    }

    if (input.action === "export-baseline") {
      const exported = await (
        options.exportBaseline ?? exportSearchEvalBaselineArtifact
      )({
        baselineName: input.baselineName,
        reportIds: input.reportIds,
      })
      return {
        ok: true,
        action: input.action,
        mastraRunId,
        artifact: exported.artifact,
        baselineName: exported.artifact.baselineName,
        reportIds: exported.artifact.reports.map((report) => report.reportId),
        audit: exported.audit,
      }
    }

    const imported = await (
      options.importBaseline ?? importSearchEvalBaselineArtifact
    )({
      artifact: input.artifact,
    })
    return {
      ok: true,
      action: input.action,
      mastraRunId,
      baselineName: imported.baselineName,
      reportIds: imported.reportIds,
      audit: imported.audit,
    }
  } catch (error) {
    return portabilityFailure(error, mastraRunId, input)
  }
}

function throwWorkflowFailure(
  result: SearchEvalBaselinePortabilityFailure,
): never {
  throw new SearchEvalBaselinePortabilityWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): SearchEvalBaselinePortabilityFailure | null {
  if (value instanceof SearchEvalBaselinePortabilityWorkflowFailureError) {
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
  try {
    const parsed = SearchEvalBaselinePortabilityResultSchema.safeParse(
      JSON.parse(
        message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
      ),
    )
    return parsed.success && !parsed.data.ok ? parsed.data : null
  } catch {
    return null
  }
}

function workflowFailureFromRunResult(
  value: unknown,
): SearchEvalBaselinePortabilityFailure | null {
  const direct = workflowFailureFromUnknown(value)
  if (direct) return direct
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return (
    workflowFailureFromUnknown(record.error) ??
    workflowFailureFromUnknown(record.result) ??
    workflowFailureFromUnknown(record.snapshot)
  )
}

const portabilityStep = createStep({
  id: "run-search-eval-baseline-portability",
  description:
    "Preflight, export, or import sanitized search eval seed baseline artifacts.",
  inputSchema: SearchEvalBaselinePortabilityInputSchema,
  outputSchema: SearchEvalBaselinePortabilityResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSearchEvalBaselinePortabilityWorkflow(inputData, {
      runId,
    })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const searchEvalBaselinePortabilityWorkflow = createWorkflow({
  id: "search-eval-baseline-portability",
  description:
    "Preflight, export, and import sanitized Mastra search eval seed baseline artifacts.",
  inputSchema: SearchEvalBaselinePortabilityInputSchema,
  outputSchema: SearchEvalBaselinePortabilityResultSchema,
})
  .then(portabilityStep)
  .commit()

export async function launchSearchEvalBaselinePortabilityWorkflow(
  rawInput: SearchEvalBaselinePortabilityInput,
  options: { runId?: string } = {},
): Promise<SearchEvalBaselinePortabilityResult> {
  const parsed = SearchEvalBaselinePortabilityInputSchema.safeParse(rawInput)
  const runId = options.runId ?? randomUUID()
  if (!parsed.success) {
    return failure("invalid_input", {
      retryable: false,
      mastraRunId: runId,
      audit: auditFor({ action: "preflight", result: "failed" }),
    })
  }
  const run = await searchEvalBaselinePortabilityWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("artifact_read_failed", {
        retryable: true,
        mastraRunId: runId,
        audit: auditFor({
          action: parsed.data.action,
          baselineName: parsed.data.baselineName,
          reportIds: parsed.data.reportIds,
          result: "failed",
        }),
      })
    )
  }
  if (result?.status === "success") {
    return result.result as SearchEvalBaselinePortabilityResult
  }
  return (
    workflowFailureFromRunResult(result) ??
    failure("artifact_read_failed", {
      retryable: true,
      mastraRunId: runId,
      audit: auditFor({
        action: parsed.data.action,
        baselineName: parsed.data.baselineName,
        reportIds: parsed.data.reportIds,
        result: "failed",
      }),
    })
  )
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isFinite(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES
    ) {
      throw new PortabilityRouteBodyError("payload_too_large")
    }
  }

  const body = request.body
  if (body == null) throw new PortabilityRouteBodyError("invalid_json")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new PortabilityRouteBodyError("payload_too_large")
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
  } catch {
    throw new PortabilityRouteBodyError("invalid_json")
  }
}

function routeStatusForResult(result: SearchEvalBaselinePortabilityResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "artifact_invalid") return 400
  if (result.reason === "artifact_not_found") return 404
  if (result.reason === "import_disabled") return 403
  if (result.reason === "not_seed_only") return 409
  if (result.reason === "artifact_too_large") return 413
  if (result.reason === "readiness_failed") return 503
  return 503
}

export async function handleSearchEvalBaselinePortabilityRouteRequest({
  authHeader,
  serviceKeys,
  request,
  readJson,
  launch = launchSearchEvalBaselinePortabilityWorkflow,
}: RouteHandlerInput): Promise<SearchEvalBaselinePortabilityRouteOutcome> {
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
        error instanceof PortabilityRouteBodyError &&
        error.code === "payload_too_large"
          ? 413
          : 400,
      body: {
        result: failure("invalid_input", {
          retryable: false,
          mastraRunId: runId,
          audit: auditFor({ action: "preflight", result: "failed" }),
        }),
      },
    }
  }
  const parsed = SearchEvalBaselinePortabilityInputSchema.safeParse(body)
  const result = parsed.success
    ? await launch(parsed.data, { runId }).catch(() =>
        failure("artifact_read_failed", {
          retryable: true,
          mastraRunId: runId,
          audit: auditFor({
            action: parsed.data.action,
            baselineName: parsed.data.baselineName,
            reportIds: parsed.data.reportIds,
            result: "failed",
          }),
        }),
      )
    : failure("invalid_input", {
        retryable: false,
        mastraRunId: runId,
        audit: auditFor({ action: "preflight", result: "failed" }),
      })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internal = {
  SearchEvalBaselinePortabilityInputSchema,
  SearchEvalBaselinePortabilityResultSchema,
  routeStatusForResult,
  workflowFailureFromUnknown,
}
