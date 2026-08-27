import { createHash } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { Pool } from "pg"

import { env, getMastraDatabaseUrl } from "../../config/env"
import {
  runCloudSubtitleEvalCell,
  type SubtitleEvalCloudRunnerDeps,
} from "../../evals/subtitle-translation/cloud-runner"
import {
  SubtitleEvalCloudCellRequestSchema,
  SubtitleEvalCloudResultSchema,
  type SubtitleEvalCloudResult,
} from "../../evals/subtitle-translation/types"
import { isValidServiceBearer } from "../../server/service-bearer"

export const SUBTITLE_TRANSLATION_EVAL_MAX_REQUEST_BYTES = 3 * 1024 * 1024

type ExecuteCloudCell = (
  input: unknown,
  deps?: SubtitleEvalCloudRunnerDeps,
) => Promise<SubtitleEvalCloudResult>

type WorkflowOptions = {
  execute?: ExecuteCloudCell
  executeDeps?: SubtitleEvalCloudRunnerDeps
}

type StoredWorkflowRun = Awaited<
  ReturnType<typeof subtitleTranslationEvalWorkflow.getWorkflowRunById>
>

type WithExecutionLock = <T>(
  executionKey: string,
  execute: () => Promise<T>,
) => Promise<T>

type WorkflowLaunchOptions = {
  createRun?: typeof subtitleTranslationEvalWorkflow.createRun
  getRun?: (runId: string) => Promise<StoredWorkflowRun>
  withExecutionLock?: WithExecutionLock
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (input: unknown) => Promise<SubtitleEvalCloudResult>
}

export type SubtitleTranslationEvalRouteOutcome = {
  status: number
  body: { result?: SubtitleEvalCloudResult; error?: string }
}

export async function runSubtitleTranslationEvalWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<SubtitleEvalCloudResult> {
  return (options.execute ?? runCloudSubtitleEvalCell)(
    rawInput,
    options.executeDeps,
  )
}

const subtitleTranslationEvalStep = createStep({
  id: "run-subtitle-translation-eval-cell",
  description:
    "Verify and execute one frozen subtitle translation evaluation cell.",
  inputSchema: SubtitleEvalCloudCellRequestSchema,
  outputSchema: SubtitleEvalCloudResultSchema,
  execute: ({ inputData }) => runSubtitleTranslationEvalWorkflow(inputData),
})

export const subtitleTranslationEvalWorkflow = createWorkflow({
  id: "subtitle-translation-eval",
  description:
    "Execute one bounded, frozen human-reference subtitle evaluation cell.",
  inputSchema: SubtitleEvalCloudCellRequestSchema,
  outputSchema: SubtitleEvalCloudResultSchema,
})
  .then(subtitleTranslationEvalStep)
  .commit()

const activeSubtitleEvalLaunches = new Map<
  string,
  Promise<SubtitleEvalCloudResult>
>()
let subtitleEvalExecutionLockPool: Pool | undefined

export async function launchSubtitleTranslationEvalWorkflow(
  rawInput: unknown,
  options: WorkflowLaunchOptions = {},
): Promise<SubtitleEvalCloudResult> {
  const parsed = SubtitleEvalCloudCellRequestSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInputFailure()

  const runId = subtitleEvalExecutionRunId(parsed.data)
  const active = activeSubtitleEvalLaunches.get(runId)
  if (active) return active

  const launch = (options.withExecutionLock ?? withSubtitleEvalExecutionLock)(
    runId,
    async () => {
      const getRun =
        options.getRun ??
        subtitleTranslationEvalWorkflow.getWorkflowRunById.bind(
          subtitleTranslationEvalWorkflow,
        )
      const stored = await getRun(runId)
      if (stored) return replayStoredWorkflowResult(stored, parsed.data.cellId)

      try {
        const createRun =
          options.createRun ??
          subtitleTranslationEvalWorkflow.createRun.bind(
            subtitleTranslationEvalWorkflow,
          )
        const run = await createRun({ runId })
        const result = await run.start({ inputData: parsed.data })
        if (result.status === "success") {
          return SubtitleEvalCloudResultSchema.parse(result.result)
        }
      } catch {
        // The route exposes only the fixed failure vocabulary below. Mastra
        // keeps the underlying workflow exception in protected diagnostics.
      }
      return workflowExecutionFailure(parsed.data.cellId)
    },
  ).finally(() => {
    activeSubtitleEvalLaunches.delete(runId)
  })
  activeSubtitleEvalLaunches.set(runId, launch)
  return launch
}

export function subtitleEvalExecutionRunId(
  input: Parameters<typeof SubtitleEvalCloudCellRequestSchema.parse>[0],
): string {
  const parsed = SubtitleEvalCloudCellRequestSchema.parse(input)
  const digest = createHash("sha256")
    .update(canonicalJson(parsed))
    .digest("hex")
  return `subtitle-eval-${digest}`
}

function replayStoredWorkflowResult(
  stored: NonNullable<StoredWorkflowRun>,
  cellId: string,
): SubtitleEvalCloudResult {
  if (stored.status === "success") {
    const parsed = SubtitleEvalCloudResultSchema.safeParse(stored.result)
    if (parsed.success) return parsed.data
  }
  if (
    stored.status === "pending" ||
    stored.status === "running" ||
    stored.status === "waiting" ||
    stored.status === "suspended"
  ) {
    return workflowInProgressFailure(cellId)
  }
  // A durable execution key is never restarted. A running snapshot may be a
  // live request whose caller lost its response or the remnant of a crashed
  // worker after provider spend; both are safer to reconcile than to rebill.
  return workflowExecutionFailure(cellId)
}

async function withSubtitleEvalExecutionLock<T>(
  executionKey: string,
  execute: () => Promise<T>,
): Promise<T> {
  if (env.NODE_ENV === "test" || env.MASTRA_STORAGE_BACKEND === "memory") {
    return execute()
  }
  subtitleEvalExecutionLockPool ??= new Pool({
    connectionString: getMastraDatabaseUrl(),
    max: 4,
    application_name: "forge-mastra-subtitle-eval-lock",
  })
  const client = await subtitleEvalExecutionLockPool.connect()
  try {
    await client.query(
      "select pg_advisory_lock(hashtextextended($1::text, 0))",
      [executionKey],
    )
    return await execute()
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [
        executionKey,
      ])
      .catch(() => undefined)
    client.release()
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value == null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}

export async function handleSubtitleTranslationEvalRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSubtitleTranslationEvalWorkflow,
}: RouteHandlerInput): Promise<SubtitleTranslationEvalRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  let body: unknown
  try {
    body = await readJson()
  } catch (error) {
    return {
      status: 400,
      body: {
        result:
          error instanceof SubtitleEvalRequestTooLargeError
            ? requestTooLargeFailure()
            : invalidInputFailure(),
      },
    }
  }
  let result: SubtitleEvalCloudResult
  try {
    result = await launch(body)
  } catch {
    result = workflowExecutionFailure(extractCellId(body))
  }
  return { status: statusForResult(result), body: { result } }
}

export async function readBoundedSubtitleTranslationEvalJson(
  request: Request,
  maximumBytes = SUBTITLE_TRANSLATION_EVAL_MAX_REQUEST_BYTES,
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new SubtitleEvalRequestTooLargeError()
  }
  if (!request.body) throw new SyntaxError("request body is empty")

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new SubtitleEvalRequestTooLargeError()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

class SubtitleEvalRequestTooLargeError extends Error {
  constructor() {
    super("subtitle eval request exceeded its byte ceiling")
    this.name = "SubtitleEvalRequestTooLargeError"
  }
}

function invalidInputFailure(): SubtitleEvalCloudResult {
  return SubtitleEvalCloudResultSchema.parse({
    ok: false,
    reason: "invalid_input",
    failureClass: "deterministic",
    retryable: false,
    message: "Subtitle evaluation request body must be valid JSON.",
    providerCalls: [],
  })
}

function requestTooLargeFailure(): SubtitleEvalCloudResult {
  return SubtitleEvalCloudResultSchema.parse({
    ok: false,
    reason: "payload_too_large",
    failureClass: "deterministic",
    retryable: false,
    message: "Subtitle evaluation request exceeded its byte ceiling.",
    providerCalls: [],
  })
}

function workflowExecutionFailure(cellId?: string): SubtitleEvalCloudResult {
  return SubtitleEvalCloudResultSchema.parse({
    ok: false,
    ...(cellId ? { cellId } : {}),
    reason: "execution_failed",
    failureClass: "retryable",
    retryable: true,
    message: "Subtitle evaluation workflow execution failed.",
    providerCalls: [],
  })
}

function workflowInProgressFailure(cellId: string): SubtitleEvalCloudResult {
  return SubtitleEvalCloudResultSchema.parse({
    ok: false,
    cellId,
    reason: "execution_in_progress",
    failureClass: "retryable",
    retryable: true,
    message: "Subtitle evaluation execution is awaiting reconciliation.",
    providerCalls: [],
  })
}

function extractCellId(value: unknown): string | undefined {
  if (typeof value !== "object" || value == null || !("cellId" in value)) {
    return undefined
  }
  const cellId = value.cellId
  return typeof cellId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(cellId)
    ? cellId
    : undefined
}

function statusForResult(result: SubtitleEvalCloudResult): number {
  if (result.ok) return 200
  if (result.failureClass === "deterministic") return 400
  if (result.reason === "provider_config_missing") return 503
  if (result.failureClass === "permanent") return 502
  return 502
}
