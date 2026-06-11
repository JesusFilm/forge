import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env, getOpenRouterApiKey } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  callAdminCandidateStore,
  callAdminCatalogContext,
  callAdminTraceSample,
  type AdminCatalogContextResponse,
  type AdminCandidateStoreResponse,
  type AdminSearchEvalClientResult,
  type AdminTraceSampleResponse,
} from "../../services/admin-search-eval-client"
import {
  EvalQueryGeneratorError,
  buildEvalQueryCandidates,
  createEvalQueryGenerator,
  type EvalQueryGenerator,
} from "../../services/eval-query-generator"

const SourceSchema = z.enum(["catalog", "locale_quality", "trace"])
const MAX_CANDIDATE_STORE_BATCH_SIZE = 100

export const EvalQueryGenerationWorkflowInputSchema = z
  .object({
    sources: z.array(SourceSchema).min(1).optional(),
    locales: z.array(z.string().min(1).max(32)).min(1).max(30).optional(),
    traceLimit: z.number().int().positive().max(100).default(25),
    catalogLimit: z.number().int().positive().max(100).default(30),
    localeQueryCount: z.number().int().positive().max(10).default(2),
  })
  .strict()

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    storedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    generatedCount: z.number().int().nonnegative(),
    sourceCounts: z
      .object({
        catalog: z.number().int().nonnegative(),
        locale_quality: z.number().int().nonnegative(),
        trace: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "admin_config_missing",
      "admin_auth_failed",
      "admin_read_rejected",
      "admin_read_failed",
      "generation_config_missing",
      "generation_failed",
      "admin_store_rejected",
      "admin_store_failed",
    ]),
    retryable: z.boolean(),
    adminStatus: z.string().optional(),
    adminReason: z.string().optional(),
  })
  .strict()

export const EvalQueryGenerationWorkflowOutputSchema = z.discriminatedUnion(
  "ok",
  [WorkflowSuccessSchema, WorkflowFailureSchema],
)

export type EvalQueryGenerationWorkflowInput = z.infer<
  typeof EvalQueryGenerationWorkflowInputSchema
>
export type EvalQueryGenerationWorkflowResult = z.infer<
  typeof EvalQueryGenerationWorkflowOutputSchema
>
type EvalQueryGenerationWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type EvalQueryGenerationWorkflowFailureReason =
  EvalQueryGenerationWorkflowFailure["reason"]

type ClientOptions = {
  adminBearer?: string
  traceSampleUrl?: string
  catalogContextUrl?: string
  candidateStoreUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  traceSampleClient?: typeof callAdminTraceSample
  catalogContextClient?: typeof callAdminCatalogContext
  candidateStoreClient?: typeof callAdminCandidateStore
  generator?: EvalQueryGenerator
  generatorFactory?: () => EvalQueryGenerator
  runId?: string
  generatedAt?: string
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<EvalQueryGenerationWorkflowResult>
}

export type EvalQueryGenerationRouteOutcome = {
  status: number
  body: { result?: EvalQueryGenerationWorkflowResult; error?: string }
}

function failure(
  reason: EvalQueryGenerationWorkflowFailureReason,
  options: {
    retryable: boolean
    adminStatus?: string
    adminReason?: string
  },
): EvalQueryGenerationWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

function isWorkflowFailure(
  value:
    | AdminCatalogContextResponse
    | AdminCandidateStoreResponse
    | AdminTraceSampleResponse
    | EvalQueryGenerationWorkflowFailure,
): value is EvalQueryGenerationWorkflowFailure {
  return "ok" in value && value.ok === false
}

function sourcesFor(
  input: EvalQueryGenerationWorkflowInput,
): Set<"catalog" | "locale_quality" | "trace"> {
  return new Set(input.sources ?? ["catalog", "locale_quality", "trace"])
}

function adminFailure(
  result: Exclude<
    AdminSearchEvalClientResult<unknown>,
    { ok: true; result: unknown }
  >,
  operation: "read" | "store",
): EvalQueryGenerationWorkflowFailure {
  if (result.reason === "config_missing") {
    return failure("admin_config_missing", { retryable: false })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
    })
  }
  if (result.reason === "rejected") {
    return failure(
      operation === "store" ? "admin_store_rejected" : "admin_read_rejected",
      {
        retryable: false,
        adminStatus: result.status == null ? undefined : String(result.status),
        adminReason: result.adminReason,
      },
    )
  }
  return failure(
    operation === "store" ? "admin_store_failed" : "admin_read_failed",
    {
      retryable: result.retryable,
      adminStatus: result.status == null ? undefined : String(result.status),
      adminReason: result.adminReason,
    },
  )
}

async function readTraceSamples(
  input: EvalQueryGenerationWorkflowInput,
  options: ClientOptions,
): Promise<AdminTraceSampleResponse | EvalQueryGenerationWorkflowFailure> {
  const client = options.traceSampleClient ?? callAdminTraceSample
  const urls = {
    url: options.traceSampleUrl ?? env.ADMIN_SEARCH_TRACE_SAMPLE_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  }
  const locales = input.locales ?? [undefined]
  const traces: AdminTraceSampleResponse["traces"] = []
  let generatedAt = new Date().toISOString()

  for (const locale of locales) {
    const result = await client({
      ...urls,
      payload: {
        limit: input.traceLimit,
        ...(locale ? { locale } : {}),
      },
    })
    if (!result.ok) return adminFailure(result, "read")
    traces.push(...result.result.traces)
    generatedAt = result.result.generatedAt
  }

  return { traces, generatedAt }
}

async function readCatalogContext(
  input: EvalQueryGenerationWorkflowInput,
  options: ClientOptions,
): Promise<AdminCatalogContextResponse | EvalQueryGenerationWorkflowFailure> {
  const result = await (
    options.catalogContextClient ?? callAdminCatalogContext
  )({
    url: options.catalogContextUrl ?? env.ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    payload: {
      limit: input.catalogLimit,
      ...(input.locales ? { locales: input.locales } : {}),
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  return result.ok ? result.result : adminFailure(result, "read")
}

function sourceCounts(
  candidates: readonly {
    source: "catalog" | "locale_quality" | "trace" | "seed" | "user_submitted"
  }[],
) {
  return {
    catalog: candidates.filter((candidate) => candidate.source === "catalog")
      .length,
    locale_quality: candidates.filter(
      (candidate) => candidate.source === "locale_quality",
    ).length,
    trace: candidates.filter((candidate) => candidate.source === "trace")
      .length,
  }
}

function candidateStoreClientFor(options: ClientOptions) {
  return options.candidateStoreClient ?? callAdminCandidateStore
}

async function storeCandidates(
  candidates: Awaited<ReturnType<typeof buildEvalQueryCandidates>>,
  options: ClientOptions,
): Promise<AdminCandidateStoreResponse | EvalQueryGenerationWorkflowFailure> {
  const client = candidateStoreClientFor(options)
  const totals: AdminCandidateStoreResponse = {
    storedCount: 0,
    skippedCount: 0,
    candidates: [],
    skipped: [],
  }

  for (
    let offset = 0;
    offset < candidates.length;
    offset += MAX_CANDIDATE_STORE_BATCH_SIZE
  ) {
    const batch = candidates.slice(
      offset,
      offset + MAX_CANDIDATE_STORE_BATCH_SIZE,
    )
    const storeResult = await client({
      url: options.candidateStoreUrl ?? env.ADMIN_SEARCH_EVAL_CANDIDATES_URL,
      bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
      payload: { candidates: batch },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    })
    if (!storeResult.ok) return adminFailure(storeResult, "store")

    totals.storedCount += storeResult.result.storedCount
    totals.skippedCount += storeResult.result.skippedCount
    totals.candidates.push(...storeResult.result.candidates)
    totals.skipped.push(...storeResult.result.skipped)
  }

  return totals
}

function generatorFor(
  sources: ReadonlySet<"catalog" | "locale_quality" | "trace">,
  options: ClientOptions,
): EvalQueryGenerator | undefined {
  if (!sources.has("locale_quality")) return undefined
  if (options.generator) return options.generator
  if (options.generatorFactory) return options.generatorFactory()
  return createEvalQueryGenerator({
    apiKey: getOpenRouterApiKey(),
    model: env.EVAL_QUERY_GENERATION_MODEL,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
}

export async function runEvalQueryGenerationWorkflow(
  rawInput: unknown,
  options: ClientOptions = {},
): Promise<EvalQueryGenerationWorkflowResult> {
  const parsed = EvalQueryGenerationWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { retryable: false })
  }

  const input = parsed.data
  const sources = sourcesFor(input)
  const mastraRunId = options.runId ?? randomUUID()
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  const traceResponse = sources.has("trace")
    ? await readTraceSamples(input, options)
    : { traces: [], generatedAt }
  if (isWorkflowFailure(traceResponse)) {
    return traceResponse
  }

  const catalogResponse =
    sources.has("catalog") || sources.has("locale_quality")
      ? await readCatalogContext(input, options)
      : { localeProfiles: [], anchors: [], generatedAt }
  if (isWorkflowFailure(catalogResponse)) {
    return catalogResponse
  }

  let generator: EvalQueryGenerator | undefined
  try {
    generator = generatorFor(sources, options)
  } catch (error) {
    if (
      error instanceof EvalQueryGeneratorError &&
      error.code === "missing_credentials"
    ) {
      return failure("generation_config_missing", { retryable: false })
    }
    return failure("generation_failed", { retryable: true })
  }

  let candidates: Awaited<ReturnType<typeof buildEvalQueryCandidates>>
  try {
    candidates = await buildEvalQueryCandidates({
      catalogAnchors: catalogResponse.anchors,
      traceSamples: traceResponse.traces,
      localeProfiles: catalogResponse.localeProfiles,
      mastraRunId,
      generatedAt,
      generator,
      localeQueryCount: input.localeQueryCount,
      includeSources: sources,
    })
  } catch (error) {
    return failure(
      error instanceof EvalQueryGeneratorError &&
        error.code === "missing_credentials"
        ? "generation_config_missing"
        : "generation_failed",
      { retryable: !(error instanceof EvalQueryGeneratorError) },
    )
  }

  if (candidates.length === 0) {
    return {
      ok: true,
      mastraRunId,
      storedCount: 0,
      skippedCount: 0,
      generatedCount: 0,
      sourceCounts: { catalog: 0, locale_quality: 0, trace: 0 },
    }
  }

  const storeResult = await storeCandidates(candidates, options)
  if (isWorkflowFailure(storeResult)) return storeResult

  return {
    ok: true,
    mastraRunId,
    storedCount: storeResult.storedCount,
    skippedCount: storeResult.skippedCount,
    generatedCount: candidates.length,
    sourceCounts: sourceCounts(candidates),
  }
}

const evalQueryGenerationStep = createStep({
  id: "generate-search-eval-queries",
  description:
    "Read Admin eval context, generate candidates, and store them in Admin.",
  inputSchema: z.unknown(),
  outputSchema: EvalQueryGenerationWorkflowOutputSchema,
  execute: async ({ inputData, runId }) =>
    runEvalQueryGenerationWorkflow(inputData, { runId }),
})

export const evalQueryGenerationWorkflow = createWorkflow({
  id: "eval-query-generation",
  description:
    "Generate staged search eval query candidates from Admin catalog, locale, and trace context.",
  inputSchema: z.unknown(),
  outputSchema: EvalQueryGenerationWorkflowOutputSchema,
})
  .then(evalQueryGenerationStep)
  .commit()

export async function launchEvalQueryGenerationWorkflow(
  rawInput: unknown,
  options: ClientOptions = {},
): Promise<EvalQueryGenerationWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const run = await evalQueryGenerationWorkflow.createRun({ runId })
  const result = await run.start({ inputData: rawInput }).catch(() => null)
  if (result?.status === "success") return result.result
  return failure("generation_failed", { retryable: true })
}

function routeStatusForResult(result: EvalQueryGenerationWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (
    result.reason === "admin_config_missing" ||
    result.reason === "generation_config_missing"
  ) {
    return 503
  }
  if (
    result.reason === "admin_read_rejected" ||
    result.reason === "admin_store_rejected"
  ) {
    return 409
  }
  return 502
}

export async function handleEvalQueryGenerationRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchEvalQueryGenerationWorkflow,
}: RouteHandlerInput): Promise<EvalQueryGenerationRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined
      ? failure("invalid_input", { retryable: false })
      : await launch(body, { runId })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}
