import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  getDiscoverySiteIngestConfig,
  getDiscoverySourcesConfig,
} from "../../config/env"
import {
  DISCOVERY_SOURCE_BUDGET_MS,
  DISCOVERY_SOURCE_CONCURRENCY,
  mapWithConcurrency,
} from "../../services/discovery/bounded-parallel"
import { classifyContent } from "../../services/discovery/classifier"
import type { DiscoveredVideo } from "../../services/discovery/candidate"
import type { SourcesConfig } from "../../services/discovery/sources-client"
import {
  ReviewQueueOutcomeSchema,
  type ReviewQueueOutcome,
} from "../../services/discovery/review-queue-outcome"
import {
  loadSavedSourceValuesResult,
  mergeUnique,
} from "../../services/discovery/saved-sources"
import {
  SiteIngestError,
  submitCandidatesToSite,
  type SiteIngestConfig,
  type SiteIngestResult,
} from "../../services/discovery/site-ingest-client"
import {
  fetchBoardFeed,
  PinterestSearchError,
} from "../../services/pinterest-search-client"
import { parsePinterestPin } from "../../services/pinterest-discovery/post-parser"
import {
  BoardFailureSchema,
  PinterestDiscoveryTotalsSchema,
  PinterestPinSchema,
  createPinterestDiscoveryArtifactStore,
  type PinterestDiscoveryArtifactStore,
} from "../../services/pinterest-discovery/artifacts"
import type {
  BoardFailure,
  PinterestDiscoveryReport,
  PinterestDiscoveryTotals,
  PinterestPin,
  PinterestRawItem,
} from "../../services/pinterest-discovery/types"
import { isValidServiceBearer } from "../../server/service-bearer"

const WORKFLOW_FAILURE_ERROR_PREFIX = "PINTEREST_DISCOVERY_WORKFLOW_FAILED:"
const MAX_BOARDS = 50

export const PinterestDiscoveryWorkflowInputSchema = z
  .object({
    boards: z.array(z.string().min(1)).max(MAX_BOARDS).default([]),
    limitPerBoard: z.number().int().positive().max(50).default(15),
    maxResults: z.number().int().positive().max(300).default(10),
    persistArtifact: z.boolean().default(true),
  })
  .strict()

export type PinterestDiscoveryWorkflowInput = z.infer<
  typeof PinterestDiscoveryWorkflowInputSchema
>

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    totals: PinterestDiscoveryTotalsSchema,
    pins: z.array(PinterestPinSchema),
    boardFailures: z.array(BoardFailureSchema),
    reviewQueue: ReviewQueueOutcomeSchema,
    artifactPath: z.string().optional(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "sources_unavailable",
      "all_boards_failed",
    ]),
    retryable: z.boolean(),
    mastraRunId: z.string(),
    details: z.string().optional(),
  })
  .strict()

export const PinterestDiscoveryWorkflowOutputSchema = z.discriminatedUnion(
  "ok",
  [WorkflowSuccessSchema, WorkflowFailureSchema],
)

export type PinterestDiscoveryWorkflowResult = z.infer<
  typeof PinterestDiscoveryWorkflowOutputSchema
>
type PinterestDiscoveryWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type PinterestDiscoveryWorkflowSuccess = z.infer<typeof WorkflowSuccessSchema>

const RawItemSchema = z.record(z.string(), z.unknown())

export type FetchBoardFn = typeof fetchBoardFeed

export type PinterestDiscoveryOptions = {
  runId?: string
  now?: () => Date
  fetchBoard?: FetchBoardFn
  artifactStore?: PinterestDiscoveryArtifactStore
  siteIngest?: SiteIngestConfig | null
  submitPins?: (pins: DiscoveredVideo[]) => Promise<SiteIngestResult>
  /** Saved-sources config; when set, the saved boards are merged into `boards`. */
  sourcesConfig?: SourcesConfig | null
  /** Injectable fetch for the saved-sources call (tests). */
  fetchSources?: typeof fetch
}

/**
 * Merge the website's saved Pinterest boards into the run input (deduped).
 * The caller surfaces a failed source request when no fallback input exists.
 */
async function withSavedPinterestSources(
  input: PinterestDiscoveryWorkflowInput,
  options: { config?: SourcesConfig | null; fetchImpl?: typeof fetch },
): Promise<{
  input: PinterestDiscoveryWorkflowInput
  sourceLoadStatus: "not_configured" | "loaded" | "failed"
}> {
  const loaded = await loadSavedSourceValuesResult("pinterest", options)
  return {
    input: {
      ...input,
      boards: mergeUnique(input.boards, loaded.values, MAX_BOARDS),
    },
    sourceLoadStatus: loaded.status,
  }
}

function toCandidate(pin: PinterestPin): DiscoveredVideo {
  return {
    platform: "pinterest",
    externalId: pin.pinId,
    url: pin.url,
    caption: pin.caption,
    authorHandle: pin.boardName,
    authorName: pin.boardName,
    authorUrl: pin.boardUrl,
    thumbnailUrl: pin.thumbnailUrl,
    matchedAi: pin.matchedAi,
    matchedChristian: pin.matchedChristian,
  }
}

async function submitToReviewQueue(
  pins: readonly PinterestPin[],
  options: Pick<PinterestDiscoveryOptions, "siteIngest" | "submitPins">,
): Promise<ReviewQueueOutcome> {
  if (pins.length === 0) return { status: "empty" }
  const candidates = pins.map(toCandidate)
  const config = options.siteIngest ?? getDiscoverySiteIngestConfig()
  if (!options.submitPins && !config) return { status: "not_configured" }
  try {
    const result = options.submitPins
      ? await options.submitPins(candidates)
      : config
        ? await submitCandidatesToSite(candidates, config)
        : null
    if (result) {
      console.log(
        `[pinterest-discovery] event=site_ingest inserted=${result.inserted} skipped=${result.skipped}`,
      )
      return {
        status: "submitted",
        inserted: result.inserted,
        skipped: result.skipped,
      }
    }
    return { status: "not_configured" }
  } catch (error) {
    console.error(
      `[pinterest-discovery] event=site_ingest_failed message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      status: "failed",
      reason: error instanceof SiteIngestError ? error.code : "upstream_failed",
    }
  }
}

class PinterestDiscoveryFailureError extends Error {
  constructor(readonly result: PinterestDiscoveryWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "PinterestDiscoveryFailureError"
  }
}

function failure(
  reason: PinterestDiscoveryWorkflowFailure["reason"],
  options: { mastraRunId: string; retryable: boolean; details?: string },
): PinterestDiscoveryWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    details: options.details,
  }
}

function throwDiscoveryFailure(
  result: PinterestDiscoveryWorkflowFailure,
): never {
  throw new PinterestDiscoveryFailureError(result)
}

function discoveryFailureFromUnknown(
  value: unknown,
): PinterestDiscoveryWorkflowFailure | null {
  if (value instanceof PinterestDiscoveryFailureError) return value.result
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : typeof value === "object" && value !== null && "message" in value
          ? String((value as { message?: unknown }).message ?? "")
          : ""
  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null
  try {
    const parsed = WorkflowFailureSchema.safeParse(
      JSON.parse(
        message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
      ),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function discoveryFailureFromRunResult(
  value: unknown,
): PinterestDiscoveryWorkflowFailure | null {
  const direct = discoveryFailureFromUnknown(value)
  if (direct) return direct
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return (
    discoveryFailureFromUnknown(record.error) ??
    discoveryFailureFromUnknown(record.result) ??
    discoveryFailureFromUnknown(record.snapshot)
  )
}

/**
 * Collect raw pins from each trusted board's RSS feed. Tolerant to per-board
 * failures: only fails the whole run when every board errors.
 */
export async function collectPinterestCandidates(
  input: PinterestDiscoveryWorkflowInput,
  options: { runId: string; fetchBoard: FetchBoardFn },
): Promise<{ items: PinterestRawItem[]; boardFailures: BoardFailure[] }> {
  const sourceSignal = AbortSignal.timeout(DISCOVERY_SOURCE_BUDGET_MS)
  const outcomes = await mapWithConcurrency(
    input.boards,
    DISCOVERY_SOURCE_CONCURRENCY,
    async (board) => {
      try {
        if (sourceSignal.aborted) {
          throw new PinterestSearchError(
            "upstream_failed",
            "Pinterest discovery source deadline exceeded",
            true,
          )
        }
        return {
          items: (
            await options.fetchBoard(board, { signal: sourceSignal })
          ).slice(0, input.limitPerBoard),
          failure: null,
          retryable: false,
        }
      } catch (error) {
        const code =
          error instanceof PinterestSearchError ? error.code : "board_failed"
        return {
          items: [],
          failure: {
            board,
            code,
            message: error instanceof Error ? error.message : String(error),
          } satisfies BoardFailure,
          retryable:
            error instanceof PinterestSearchError ? error.retryable : false,
        }
      }
    },
  )

  const items: PinterestRawItem[] = []
  const boardFailures: BoardFailure[] = []
  let anyRetryable = false
  for (const outcome of outcomes) {
    items.push(...outcome.items)
    if (outcome.failure) {
      boardFailures.push(outcome.failure)
      if (outcome.retryable) anyRetryable = true
    }
  }

  if (input.boards.length > 0 && boardFailures.length === input.boards.length) {
    throwDiscoveryFailure(
      failure("all_boards_failed", {
        mastraRunId: options.runId,
        retryable: anyRetryable,
        details: boardFailures.map((entry) => entry.code).join(","),
      }),
    )
  }

  return { items, boardFailures }
}

/**
 * Parse raw pins, dedupe by pinId, and keep them. Boards are curated/trusted, so
 * the rule is trust-the-source: keep every pin EXCEPT obvious commentary/news
 * junk (no AI/Christian keyword requirement). Capped at `maxResults`.
 */
export function selectQualifyingPins(
  items: readonly PinterestRawItem[],
  input: PinterestDiscoveryWorkflowInput,
): { pins: PinterestPin[]; totals: PinterestDiscoveryTotals } {
  const parsed: PinterestPin[] = []
  for (const item of items) {
    const pin = parsePinterestPin(item)
    if (pin) parsed.push(pin)
  }

  const byId = new Map<string, PinterestPin>()
  for (const pin of parsed) {
    if (!byId.has(pin.pinId)) byId.set(pin.pinId, pin)
  }
  const deduped = [...byId.values()]

  const qualified: PinterestPin[] = []
  let excludedCommentary = 0
  for (const pin of deduped) {
    const signals = classifyContent({
      caption: pin.caption,
      hashtags: pin.hashtags,
    })
    if (signals.isCommentary) {
      excludedCommentary += 1
      continue
    }
    if (qualified.length < input.maxResults) {
      qualified.push({
        ...pin,
        matchedAi: signals.matchedAi,
        matchedChristian: signals.matchedChristian,
      })
    }
  }

  return {
    pins: qualified,
    totals: {
      candidates: items.length,
      pins: parsed.length,
      deduped: deduped.length,
      excludedCommentary,
      qualified: qualified.length,
    },
  }
}

function buildReport(args: {
  runId: string
  startedAt: string
  finishedAt: string
  boards: string[]
  totals: PinterestDiscoveryTotals
  boardFailures: BoardFailure[]
  pins: PinterestPin[]
}): PinterestDiscoveryReport {
  return {
    schemaVersion: "1",
    kind: "pinterest-ai-christian-discovery",
    reportId: args.runId,
    mastraRunId: args.runId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    boards: args.boards,
    totals: args.totals,
    boardFailures: args.boardFailures,
    pins: args.pins,
  }
}

export async function runPinterestDiscovery(
  rawInput: unknown,
  options: PinterestDiscoveryOptions = {},
): Promise<PinterestDiscoveryWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const now = options.now ?? (() => new Date())
  const fetchBoard = options.fetchBoard ?? fetchBoardFeed
  const artifactStore =
    options.artifactStore ?? createPinterestDiscoveryArtifactStore()

  const parsedInput = PinterestDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }
  const savedSources = await withSavedPinterestSources(parsedInput.data, {
    config: options.sourcesConfig,
    fetchImpl: options.fetchSources,
  })
  const input = savedSources.input
  if (savedSources.sourceLoadStatus === "failed" && input.boards.length === 0) {
    return failure("sources_unavailable", {
      mastraRunId,
      retryable: true,
      details: "saved Pinterest sources could not be loaded",
    })
  }

  const startedAt = now().toISOString()
  try {
    const { items, boardFailures } = await collectPinterestCandidates(input, {
      runId: mastraRunId,
      fetchBoard,
    })
    const { pins, totals } = selectQualifyingPins(items, input)
    const finishedAt = now().toISOString()

    let artifactPath: string | undefined
    if (input.persistArtifact) {
      const written = await artifactStore.writeReport(
        buildReport({
          runId: mastraRunId,
          startedAt,
          finishedAt,
          boards: input.boards,
          totals,
          boardFailures,
          pins,
        }),
      )
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(pins, options)

    return {
      ok: true,
      mastraRunId,
      totals,
      pins,
      boardFailures,
      reviewQueue,
      ...(artifactPath ? { artifactPath } : {}),
    } satisfies PinterestDiscoveryWorkflowSuccess
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_boards_failed", {
        mastraRunId,
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      })
    )
  }
}

// --- Mastra workflow (Studio-facing) ---------------------------------------

const CollectStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      startedAt: z.string(),
      items: z.array(RawItemSchema),
      boardFailures: z.array(BoardFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const FilterStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      startedAt: z.string(),
      pins: z.array(PinterestPinSchema),
      totals: PinterestDiscoveryTotalsSchema,
      boardFailures: z.array(BoardFailureSchema),
    })
    .strict(),
  WorkflowFailureSchema,
])

const collectStep = createStep({
  id: "collect-pinterest-candidates",
  description: "Fetch pins from each trusted board's RSS feed.",
  inputSchema: PinterestDiscoveryWorkflowInputSchema,
  outputSchema: CollectStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    const startedAt = new Date().toISOString()
    try {
      const { items, boardFailures } = await collectPinterestCandidates(
        inputData,
        { runId, fetchBoard: fetchBoardFeed },
      )
      return {
        ok: true as const,
        startedAt,
        items: items as Record<string, unknown>[],
        boardFailures,
      }
    } catch (error) {
      const parsed = discoveryFailureFromUnknown(error)
      if (parsed) throwDiscoveryFailure(parsed)
      throw error
    }
  },
})

const filterStep = createStep({
  id: "parse-and-filter-pins",
  description: "Parse pins, dedupe by pinId, and keep non-commentary pins.",
  inputSchema: CollectStepOutputSchema,
  outputSchema: FilterStepOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input =
      PinterestDiscoveryWorkflowInputSchema.parse(getInitData<unknown>())
    const { pins, totals } = selectQualifyingPins(
      inputData.items as PinterestRawItem[],
      input,
    )
    return {
      ok: true as const,
      startedAt: inputData.startedAt,
      pins,
      totals,
      boardFailures: inputData.boardFailures,
    }
  },
})

const reportStep = createStep({
  id: "report-and-persist",
  description: "Build the discovery report and persist it when requested.",
  inputSchema: FilterStepOutputSchema,
  outputSchema: PinterestDiscoveryWorkflowOutputSchema,
  execute: async ({ inputData, getInitData, runId }) => {
    if (!inputData.ok) throwDiscoveryFailure(inputData)
    const input =
      PinterestDiscoveryWorkflowInputSchema.parse(getInitData<unknown>())
    const finishedAt = new Date().toISOString()

    let artifactPath: string | undefined
    if (input.persistArtifact) {
      const written = await createPinterestDiscoveryArtifactStore().writeReport(
        buildReport({
          runId,
          startedAt: inputData.startedAt,
          finishedAt,
          boards: input.boards,
          totals: inputData.totals,
          boardFailures: inputData.boardFailures,
          pins: inputData.pins,
        }),
      )
      artifactPath = written.path
    }

    const reviewQueue = await submitToReviewQueue(inputData.pins, {})

    return {
      ok: true as const,
      mastraRunId: runId,
      totals: inputData.totals,
      pins: inputData.pins,
      boardFailures: inputData.boardFailures,
      reviewQueue,
      ...(artifactPath ? { artifactPath } : {}),
    }
  },
})

export const pinterestAiChristianDiscoveryWorkflow = createWorkflow({
  id: "pinterest-ai-christian-discovery",
  description:
    "Discover AI-generated Christian pins from trusted Pinterest boards via RSS.",
  inputSchema: PinterestDiscoveryWorkflowInputSchema,
  outputSchema: PinterestDiscoveryWorkflowOutputSchema,
})
  .then(collectStep)
  .then(filterStep)
  .then(reportStep)
  .commit()

export async function launchPinterestDiscoveryWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<PinterestDiscoveryWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = PinterestDiscoveryWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  const savedSources = await withSavedPinterestSources(parsed.data, {
    config: getDiscoverySourcesConfig(),
  })
  if (
    savedSources.sourceLoadStatus === "failed" &&
    savedSources.input.boards.length === 0
  ) {
    return failure("sources_unavailable", {
      mastraRunId: runId,
      retryable: true,
      details: "saved Pinterest sources could not be loaded",
    })
  }

  const run = await pinterestAiChristianDiscoveryWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: savedSources.input })
  } catch (error) {
    return (
      discoveryFailureFromUnknown(error) ??
      failure("all_boards_failed", { mastraRunId: runId, retryable: true })
    )
  }
  if (result.status === "success") return result.result
  return (
    discoveryFailureFromRunResult(result) ??
    failure("all_boards_failed", { mastraRunId: runId, retryable: true })
  )
}

// --- Route handler ----------------------------------------------------------

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<PinterestDiscoveryWorkflowResult>
}

export type PinterestDiscoveryRouteOutcome = {
  status: number
  body: { result?: PinterestDiscoveryWorkflowResult; error?: string }
}

function routeStatusForResult(
  result: PinterestDiscoveryWorkflowResult,
): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "sources_unavailable") return 503
  return 502
}

export async function handlePinterestDiscoveryRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchPinterestDiscoveryWorkflow,
}: RouteHandlerInput): Promise<PinterestDiscoveryRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined
      ? failure("invalid_input", { mastraRunId: runId, retryable: false })
      : await launch(body, { runId })

  return { status: routeStatusForResult(result), body: { result } }
}

export const _internals = {
  buildReport,
  discoveryFailureFromRunResult,
  toCandidate,
}
