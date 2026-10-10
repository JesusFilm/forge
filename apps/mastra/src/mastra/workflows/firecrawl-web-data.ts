import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  executeFirecrawlScrapeTool,
  executeFirecrawlSearchTool,
  type FirecrawlScrapeToolInput,
  type FirecrawlScrapeToolOutput,
  type FirecrawlSearchToolInput,
  type FirecrawlSearchToolOutput,
} from "../tools/firecrawl"

const WORKFLOW_FAILURE_ERROR_PREFIX = "FIRECRAWL_WEB_DATA_WORKFLOW_FAILED:"

export const FirecrawlWebDataInputSchema = z
  .object({
    action: z
      .enum(["search", "scrape"])
      .default("search")
      .describe("Firecrawl action to run."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Search query. Required when action is search."),
    url: z
      .string()
      .url()
      .optional()
      .describe("Public page URL. Required when action is scrape."),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(20)
      .default(5)
      .describe("Maximum search results to return."),
    includeMarkdown: z
      .boolean()
      .default(false)
      .describe("Hydrate search results with bounded markdown."),
    onlyMainContent: z
      .boolean()
      .default(true)
      .describe("Scrape only the main content region when possible."),
    timeoutMs: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .optional()
      .describe("Optional Firecrawl request timeout in milliseconds."),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.action === "search" && !input.query) {
      ctx.addIssue({
        code: "custom",
        message: "query is required when action is search",
        path: ["query"],
      })
    }
    if (input.action === "scrape" && !input.url) {
      ctx.addIssue({
        code: "custom",
        message: "url is required when action is scrape",
        path: ["url"],
      })
    }
  })

export type FirecrawlWebDataWorkflowInput = z.output<
  typeof FirecrawlWebDataInputSchema
>

const FirecrawlWebDataFailureReasonSchema = z.enum([
  "invalid_input",
  "config_missing",
  "auth_failed",
  "network_error",
  "rate_limited",
  "rejected",
  "parse_error",
  "invalid_response",
])

const FirecrawlSearchResultSchema = z
  .object({
    title: z.string().nullable(),
    url: z.string().url(),
    description: z.string().nullable(),
    markdown: z.string().nullable(),
    markdownTruncated: z.boolean(),
  })
  .strict()

const FirecrawlSearchSuccessSchema = z
  .object({
    query: z.string(),
    results: z.array(FirecrawlSearchResultSchema),
    creditsUsed: z.number().nullable(),
  })
  .strict()

const FirecrawlScrapeSuccessSchema = z
  .object({
    url: z.string().url(),
    markdown: z.string(),
    markdownTruncated: z.boolean(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    statusCode: z.number().int().nullable(),
    contentType: z.string().nullable(),
  })
  .strict()

export const FirecrawlWebDataResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      action: z.literal("search"),
      mastraRunId: z.string(),
      search: FirecrawlSearchSuccessSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      action: z.literal("scrape"),
      mastraRunId: z.string(),
      scrape: FirecrawlScrapeSuccessSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      action: z.enum(["search", "scrape"]).optional(),
      reason: FirecrawlWebDataFailureReasonSchema,
      retryable: z.boolean(),
      status: z.number().int().optional(),
      upstreamReason: z.string().optional(),
    })
    .strict(),
])

export type FirecrawlWebDataResult = z.output<
  typeof FirecrawlWebDataResultSchema
>
type FirecrawlWebDataFailure = Extract<FirecrawlWebDataResult, { ok: false }>

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: FirecrawlWebDataWorkflowInput,
    options: { runId: string },
  ) => Promise<FirecrawlWebDataResult>
}

export type FirecrawlWebDataRouteOutcome = {
  status: number
  body: { result?: FirecrawlWebDataResult; error?: string }
}

function invalidInput(): FirecrawlWebDataFailure {
  return { ok: false, reason: "invalid_input", retryable: false }
}

function failureFromTool(
  action: "search" | "scrape",
  output: Extract<
    FirecrawlSearchToolOutput | FirecrawlScrapeToolOutput,
    { ok: false }
  >,
): FirecrawlWebDataFailure {
  return {
    ok: false,
    action,
    reason: output.reason,
    retryable: output.retryable,
    ...(output.status == null ? {} : { status: output.status }),
    ...(output.upstreamReason == null
      ? {}
      : { upstreamReason: output.upstreamReason }),
  }
}

class FirecrawlWebDataWorkflowFailureError extends Error {
  constructor(readonly result: FirecrawlWebDataFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "FirecrawlWebDataWorkflowFailureError"
  }
}

function throwWorkflowFailure(result: FirecrawlWebDataResult): never {
  if (result.ok) {
    throw new Error("Cannot throw a successful Firecrawl web data result")
  }
  throw new FirecrawlWebDataWorkflowFailureError(result)
}

function parseWorkflowFailurePayload(value: unknown) {
  const parsed = FirecrawlWebDataResultSchema.safeParse(value)
  return parsed.success && !parsed.data.ok ? parsed.data : null
}

function workflowFailureFromUnknown(
  value: unknown,
): FirecrawlWebDataFailure | null {
  if (value instanceof FirecrawlWebDataWorkflowFailureError) {
    return value.result
  }

  const direct = parseWorkflowFailurePayload(value)
  if (direct) return direct

  const message = value instanceof Error ? value.message : String(value ?? "")
  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex === -1) return null

  try {
    const parsed = FirecrawlWebDataResultSchema.safeParse(
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
): FirecrawlWebDataFailure | null {
  const direct = workflowFailureFromUnknown(value)
  if (direct) return direct
  if (typeof value !== "object" || value === null) return null
  const record = value as {
    error?: unknown
    result?: unknown
    snapshot?: unknown
  }
  return (
    workflowFailureFromUnknown(record.error) ??
    workflowFailureFromUnknown(record.result) ??
    workflowFailureFromUnknown(record.snapshot)
  )
}

export async function runFirecrawlWebDataWorkflow(
  rawInput: unknown,
  options: {
    runId?: string
    search?: (
      input: FirecrawlSearchToolInput,
    ) => Promise<FirecrawlSearchToolOutput>
    scrape?: (
      input: FirecrawlScrapeToolInput,
    ) => Promise<FirecrawlScrapeToolOutput>
  } = {},
): Promise<FirecrawlWebDataResult> {
  const parsed = FirecrawlWebDataInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput()

  const mastraRunId = options.runId ?? randomUUID()
  const input = parsed.data
  if (input.action === "search") {
    const output = await (options.search ?? executeFirecrawlSearchTool)({
      query: input.query ?? "",
      limit: input.limit,
      includeMarkdown: input.includeMarkdown,
      ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs }),
    })
    if (!output.ok) return failureFromTool("search", output)
    return {
      ok: true,
      action: "search",
      mastraRunId,
      search: {
        query: output.query,
        results: output.results,
        creditsUsed: output.creditsUsed,
      },
    }
  }

  const output = await (options.scrape ?? executeFirecrawlScrapeTool)({
    url: input.url ?? "",
    onlyMainContent: input.onlyMainContent,
    ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs }),
  })
  if (!output.ok) return failureFromTool("scrape", output)
  return {
    ok: true,
    action: "scrape",
    mastraRunId,
    scrape: {
      url: output.url,
      markdown: output.markdown,
      markdownTruncated: output.markdownTruncated,
      title: output.title,
      description: output.description,
      statusCode: output.statusCode,
      contentType: output.contentType,
    },
  }
}

const firecrawlWebDataStep = createStep({
  id: "run-firecrawl-web-data",
  description: "Search or scrape current public web data through Firecrawl.",
  inputSchema: FirecrawlWebDataInputSchema,
  outputSchema: FirecrawlWebDataResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runFirecrawlWebDataWorkflow(inputData, { runId })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const firecrawlWebDataWorkflow = createWorkflow({
  id: "firecrawl-web-data",
  description:
    "Run bounded Firecrawl search and scrape requests for Mastra agents and operator workflows.",
  inputSchema: FirecrawlWebDataInputSchema,
  outputSchema: FirecrawlWebDataResultSchema,
})
  .then(firecrawlWebDataStep)
  .commit()

export async function launchFirecrawlWebDataWorkflow(
  rawInput: FirecrawlWebDataWorkflowInput,
  options: { runId?: string } = {},
): Promise<FirecrawlWebDataResult> {
  const runId = options.runId ?? randomUUID()
  const run = await firecrawlWebDataWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: rawInput })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ?? {
        ok: false,
        reason: "network_error",
        retryable: true,
      }
    )
  }
  if (result?.status === "success")
    return result.result as FirecrawlWebDataResult
  return (
    workflowFailureFromRunResult(result) ?? {
      ok: false,
      reason: "network_error",
      retryable: true,
    }
  )
}

function routeStatusForResult(result: FirecrawlWebDataResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "config_missing") return 503
  if (result.reason === "rate_limited") return 429
  if (result.reason === "auth_failed") return 502
  return result.retryable ? 503 : 502
}

export async function handleFirecrawlWebDataRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchFirecrawlWebDataWorkflow,
}: RouteHandlerInput): Promise<FirecrawlWebDataRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  let body: unknown
  try {
    body = await readJson()
  } catch {
    return {
      status: 400,
      body: { result: invalidInput(), error: "Invalid JSON" },
    }
  }

  const parsed = FirecrawlWebDataInputSchema.safeParse(body)
  let result: FirecrawlWebDataResult
  if (parsed.success) {
    try {
      result = await launch(parsed.data, { runId })
    } catch {
      result = { ok: false, reason: "network_error", retryable: true }
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
  FirecrawlWebDataInputSchema,
  workflowFailureFromUnknown,
  workflowFailureFromRunResult,
}
