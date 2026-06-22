import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import { SearchEvalReportSchema } from "../../services/offline-search-eval/artifacts"
import {
  runOfflineSearchEval,
  type OfflineSearchEvalInput,
  type OfflineSearchEvalFailure,
  type OfflineSearchEvalResult,
} from "../../services/offline-search-eval/runner"
import { SEARCH_EVAL_SEED_PROMPT_LOCALES } from "../../services/offline-search-eval/seed-prompt-set"

export const OFFLINE_SEARCH_EVAL_MAX_BODY_BYTES = 4096
const WORKFLOW_FAILURE_ERROR_PREFIX = "OFFLINE_SEARCH_EVAL_WORKFLOW_FAILED:"
const DEFAULT_BASELINE_NAME = "seed-baseline"
const DEFAULT_SEARCH_MODE = "hybrid"
const DEFAULT_CONTENT_TYPE = "all"
const SEARCH_PIPELINE_MODES = [
  "hybrid",
  "keyword-first",
  "semantic-only",
] as const

const OfflineSearchEvalInputSchema = z
  .object({
    mode: z
      .enum(["capture-baseline", "compare"])
      .default("capture-baseline")
      .describe(
        "Run type. Capture saves a baseline; compare loads the baseline name below and reports changes.",
      ),
    baselineName: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
      .default(DEFAULT_BASELINE_NAME)
      .describe(
        "Baseline name. Capture saves to this name; compare loads this existing baseline.",
      ),
    locales: z
      .array(z.string().min(1).max(32))
      .min(1)
      .max(30)
      .default(() => [...SEARCH_EVAL_SEED_PROMPT_LOCALES])
      .describe("Locales to evaluate. Defaults to every seeded locale."),
    searchLimit: z.coerce
      .number()
      .int()
      .positive()
      .max(50)
      .default(20)
      .describe("Admin search results to collect per prompt."),
    searchMode: z
      .enum(SEARCH_PIPELINE_MODES)
      .default(DEFAULT_SEARCH_MODE)
      .describe(
        "Search pipeline. Use hybrid for normal search; keyword-first tests the lexical-first candidate strategy; semantic-only is an internal diagnostic eval mode.",
      ),
    contentType: z
      .enum(["all", "video", "experience"])
      .default(DEFAULT_CONTENT_TYPE)
      .describe("Content type filter. all searches videos and experiences."),
  })
  .strict()

type OfflineSearchEvalWorkflowInput = z.output<
  typeof OfflineSearchEvalInputSchema
>

function workflowInputForRunner(
  input: OfflineSearchEvalWorkflowInput,
): OfflineSearchEvalInput {
  const { contentType, ...rest } = input
  return {
    ...rest,
    ...(contentType === "all" ? {} : { contentType }),
  }
}

const OfflineSearchEvalFailureReasonSchema = z.enum([
  "invalid_input",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_read_failed",
  "admin_read_rejected",
  "artifact_not_found",
  "artifact_invalid",
  "artifact_read_failed",
  "artifact_write_failed",
  "judge_config_missing",
  "judge_failed",
])

const OfflineSearchEvalResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      mode: z.enum(["capture-baseline", "compare"]),
      mastraRunId: z.string(),
      baselineName: z.string(),
      baselinePath: z.string().optional(),
      reportPath: z.string(),
      report: SearchEvalReportSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: OfflineSearchEvalFailureReasonSchema,
      retryable: z.boolean(),
      adminStatus: z.string().optional(),
      adminReason: z.string().optional(),
      reportPath: z.string().optional(),
    })
    .strict(),
])

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request?: Request
  readJson?: () => Promise<unknown>
  launch?: (
    input: OfflineSearchEvalWorkflowInput,
    options: { runId: string },
  ) => Promise<OfflineSearchEvalResult>
}

export type OfflineSearchEvalRouteOutcome = {
  status: number
  body: { result?: OfflineSearchEvalResult; error?: string }
}

function invalidInput(): OfflineSearchEvalResult {
  return { ok: false, reason: "invalid_input", retryable: false }
}

class OfflineSearchEvalWorkflowFailureError extends Error {
  constructor(readonly result: OfflineSearchEvalFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "OfflineSearchEvalWorkflowFailureError"
  }
}

class OfflineSearchEvalRouteBodyError extends Error {
  constructor(
    readonly code: "payload_too_large" | "invalid_json",
    readonly cause?: unknown,
  ) {
    super(code)
    this.name = "OfflineSearchEvalRouteBodyError"
  }
}

function throwWorkflowFailure(result: OfflineSearchEvalFailure): never {
  throw new OfflineSearchEvalWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): OfflineSearchEvalFailure | null {
  if (value instanceof OfflineSearchEvalWorkflowFailureError) {
    return value.result
  }

  const message =
    value instanceof Error
      ? value.message
      : typeof value === "object" && value !== null && "message" in value
        ? String((value as { message?: unknown }).message ?? "")
        : typeof value === "string"
          ? value
          : ""

  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null

  const parsed = OfflineSearchEvalResultSchema.safeParse(
    JSON.parse(
      message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
    ),
  )
  return parsed.success && !parsed.data.ok ? parsed.data : null
}

function workflowFailureFromRunResult(
  value: unknown,
): OfflineSearchEvalFailure | null {
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

function payloadTooLarge(): OfflineSearchEvalRouteOutcome {
  return {
    status: 413,
    body: { result: invalidInput() },
  }
}

function invalidJson(): OfflineSearchEvalRouteOutcome {
  return {
    status: 400,
    body: { result: invalidInput() },
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isFinite(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > OFFLINE_SEARCH_EVAL_MAX_BODY_BYTES
    ) {
      throw new OfflineSearchEvalRouteBodyError("payload_too_large")
    }
  }

  const body = request.body
  if (body == null) throw new OfflineSearchEvalRouteBodyError("invalid_json")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > OFFLINE_SEARCH_EVAL_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new OfflineSearchEvalRouteBodyError("payload_too_large")
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
    throw new OfflineSearchEvalRouteBodyError("invalid_json", cause)
  }
}

export async function runOfflineSearchEvalWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<OfflineSearchEvalResult> {
  const parsed = OfflineSearchEvalInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput()
  return runOfflineSearchEval(workflowInputForRunner(parsed.data), {
    runId: options.runId,
  })
}

const offlineSearchEvalStep = createStep({
  id: "run-offline-search-eval",
  description:
    "Capture or compare Mastra-owned offline search eval baselines and reports.",
  inputSchema: OfflineSearchEvalInputSchema,
  outputSchema: OfflineSearchEvalResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runOfflineSearchEvalWorkflow(inputData, { runId })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const offlineSearchEvalWorkflow = createWorkflow({
  id: "offline-search-eval",
  description:
    "Run Mastra-owned offline search evaluations against Admin search.",
  inputSchema: OfflineSearchEvalInputSchema,
  outputSchema: OfflineSearchEvalResultSchema,
})
  .then(offlineSearchEvalStep)
  .commit()

export async function launchOfflineSearchEvalWorkflow(
  rawInput: OfflineSearchEvalWorkflowInput,
  options: { runId?: string } = {},
): Promise<OfflineSearchEvalResult> {
  const runId = options.runId ?? randomUUID()
  const run = await offlineSearchEvalWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: rawInput })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ?? {
        ok: false,
        reason: "admin_read_failed",
        retryable: true,
      }
    )
  }
  if (result?.status === "success")
    return result.result as OfflineSearchEvalResult
  return (
    workflowFailureFromRunResult(result) ?? {
      ok: false,
      reason: "admin_read_failed",
      retryable: true,
    }
  )
}

function routeStatusForResult(result: OfflineSearchEvalResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (
    result.reason === "admin_config_missing" ||
    result.reason === "judge_config_missing"
  ) {
    return 503
  }
  if (result.reason === "admin_auth_failed") return 502
  if (result.reason === "admin_read_rejected") return 409
  if (result.reason === "artifact_not_found") return 404
  if (
    result.reason === "artifact_read_failed" ||
    result.reason === "artifact_write_failed"
  ) {
    return 503
  }
  return 502
}

export async function handleOfflineSearchEvalRouteRequest({
  authHeader,
  serviceKeys,
  request,
  readJson,
  launch = launchOfflineSearchEvalWorkflow,
}: RouteHandlerInput): Promise<OfflineSearchEvalRouteOutcome> {
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
    return error instanceof OfflineSearchEvalRouteBodyError &&
      error.code === "payload_too_large"
      ? payloadTooLarge()
      : invalidJson()
  }
  const parsed = OfflineSearchEvalInputSchema.safeParse(body)
  let result: OfflineSearchEvalResult
  if (parsed.success) {
    try {
      result = await launch(parsed.data, { runId })
    } catch {
      result = {
        ok: false,
        reason: "admin_read_failed",
        retryable: true,
      }
    }
  } else {
    result = invalidInput()
  }

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internal = {
  OfflineSearchEvalInputSchema,
  workflowInputForRunner,
  workflowFailureFromRunResult,
}
