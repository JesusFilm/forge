import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"

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

export async function launchSubtitleTranslationEvalWorkflow(
  rawInput: unknown,
  options: {
    createRun?: typeof subtitleTranslationEvalWorkflow.createRun
  } = {},
): Promise<SubtitleEvalCloudResult> {
  const parsed = SubtitleEvalCloudCellRequestSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInputFailure()

  try {
    const createRun =
      options.createRun ??
      subtitleTranslationEvalWorkflow.createRun.bind(
        subtitleTranslationEvalWorkflow,
      )
    const run = await createRun({ runId: randomUUID() })
    const result = await run.start({ inputData: parsed.data })
    if (result.status === "success") {
      return SubtitleEvalCloudResultSchema.parse(result.result)
    }
  } catch {
    // The route exposes only the fixed failure vocabulary below. Mastra keeps
    // the underlying workflow exception in its own protected diagnostics.
  }
  return workflowExecutionFailure(parsed.data.cellId)
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
