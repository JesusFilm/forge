import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  callAdminCandidateArchive,
  callAdminCandidateDetail,
  callAdminCandidateList,
  callAdminCandidatePromote,
  callAdminCandidateReject,
  callAdminCandidateReviewPatch,
  callAdminCandidateStore,
  type AdminCandidateDecisionPayload,
  type AdminCandidateDetailResponse,
  type AdminCandidateListResponse,
  type AdminCandidatePromotePayload,
  type AdminCandidateReviewPatchPayload,
  type AdminCandidateStoreResponse,
  type AdminSearchEvalCandidatePayload,
  type AdminSearchEvalClientResult,
} from "../../services/admin-search-eval-client"
import {
  SEARCH_EVAL_SEED_PROMPTS,
  SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
} from "../../services/offline-search-eval/seed-prompt-set"

const SourceSchema = z.enum([
  "catalog",
  "locale_quality",
  "trace",
  "seed",
  "user_submitted",
])
const StatusSchema = z.enum(["generated", "rejected", "promoted", "archived"])
const SanitizationStatusSchema = z.enum(["pending", "sanitized", "unsafe"])

export const SearchEvalCandidateReviewWorkflowInputSchema = z
  .object({
    action: z.enum([
      "list",
      "detail",
      "edit",
      "reject",
      "archive",
      "promote",
      "submit-seed",
      "submit-user",
    ]),
    candidateId: z.string().min(1).max(256).optional(),
    filters: z
      .object({
        sources: z.array(SourceSchema).min(1).max(5).optional(),
        statuses: z.array(StatusSchema).min(1).max(4).optional(),
        locales: z.array(z.string().min(1).max(32)).min(1).max(30).optional(),
        mastraRunId: z.string().min(1).max(128).optional(),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict()
      .optional(),
    reviewerIdentity: z.string().min(1).max(256).optional(),
    sanitizedQueryText: z.string().min(1).max(512).optional(),
    sanitizedExpectedResultNotes: z.string().max(2048).optional(),
    sanitizedSourceAnchors: z.array(z.unknown()).optional(),
    sanitizationStatus: SanitizationStatusSchema.optional(),
    reviewNotes: z.string().max(2048).optional(),
    promotionRunContext: z.record(z.string(), z.unknown()).optional(),
    userSubmission: z
      .object({
        locale: z.string().min(1).max(32),
        queryText: z.string().min(1).max(512),
        submittedBy: z.string().min(1).max(256).optional(),
        expectedResultHints: z.array(z.unknown()).optional(),
        sourceAnchors: z.array(z.unknown()).optional(),
        notes: z.string().max(2048).optional(),
      })
      .strict()
      .optional(),
    seedLocales: z.array(z.string().min(1).max(32)).min(1).max(30).optional(),
  })
  .strict()

const CandidateReviewFailureReasonSchema = z.enum([
  "invalid_input",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_read_failed",
  "admin_read_rejected",
  "admin_store_failed",
  "admin_store_rejected",
  "admin_review_failed",
  "admin_review_rejected",
])

const CandidateReviewResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      action: SearchEvalCandidateReviewWorkflowInputSchema.shape.action,
      mastraRunId: z.string(),
      candidates: z.array(z.unknown()).optional(),
      candidate: z.unknown().optional(),
      storeResult: z.unknown().optional(),
      nativeDatasetItemShape: z.unknown(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: CandidateReviewFailureReasonSchema,
      retryable: z.boolean(),
      adminStatus: z.string().optional(),
      adminReason: z.string().optional(),
    })
    .strict(),
])

export type SearchEvalCandidateReviewWorkflowInput = z.infer<
  typeof SearchEvalCandidateReviewWorkflowInputSchema
>
export type SearchEvalCandidateReviewWorkflowResult = z.infer<
  typeof CandidateReviewResultSchema
>
type CandidateReviewFailure = Extract<
  SearchEvalCandidateReviewWorkflowResult,
  { ok: false }
>

type ClientOptions = {
  adminBearer?: string
  candidateUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  runId?: string
  listClient?: typeof callAdminCandidateList
  detailClient?: typeof callAdminCandidateDetail
  patchClient?: typeof callAdminCandidateReviewPatch
  rejectClient?: typeof callAdminCandidateReject
  archiveClient?: typeof callAdminCandidateArchive
  promoteClient?: typeof callAdminCandidatePromote
  storeClient?: typeof callAdminCandidateStore
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SearchEvalCandidateReviewWorkflowResult>
}

export type SearchEvalCandidateReviewRouteOutcome = {
  status: number
  body: { result?: SearchEvalCandidateReviewWorkflowResult; error?: string }
}

const nativeDatasetItemShape = {
  targetType: "workflow",
  targetId: "offline-search-eval",
  input: {
    query: "string",
    locale: "BCP-47 string",
    source: "seed | generated_* | user_submitted | promoted",
    searchOptions: {
      contentType: "video | experience | all",
      mode: "hybrid | keyword-first | semantic-only",
    },
  },
  groundTruth: {
    expectedResultNotes: "sanitized operator text",
    sourceAnchors: "sanitized Admin/Core content anchors",
  },
  metadata: {
    candidateId: "Admin search_eval_candidate id",
    sanitizationStatus: "sanitized",
    reviewerIdentity: "operator identity string",
    reviewedAt: "ISO timestamp",
    promotedAt: "ISO timestamp",
    provenance: "safe source/provenance labels only",
  },
  nativeWrites: {
    datasetId: null,
    scorerIds: [],
    experimentIds: [],
    deferredTo: "feat-142",
  },
} as const

function failure(
  reason: CandidateReviewFailure["reason"],
  options: {
    retryable: boolean
    adminStatus?: string
    adminReason?: string
  },
): CandidateReviewFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

function adminFailure(
  result: Exclude<
    AdminSearchEvalClientResult<unknown>,
    { ok: true; result: unknown }
  >,
  operation: "read" | "store" | "review",
): CandidateReviewFailure {
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
    const reason =
      operation === "store"
        ? "admin_store_rejected"
        : operation === "review"
          ? "admin_review_rejected"
          : "admin_read_rejected"
    return failure(reason, {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
      adminReason: result.adminReason,
    })
  }
  const reason =
    operation === "store"
      ? "admin_store_failed"
      : operation === "review"
        ? "admin_review_failed"
        : "admin_read_failed"
  return failure(reason, {
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

function success(
  input: SearchEvalCandidateReviewWorkflowInput,
  mastraRunId: string,
  result:
    | AdminCandidateListResponse
    | AdminCandidateDetailResponse
    | AdminCandidateStoreResponse,
): SearchEvalCandidateReviewWorkflowResult {
  if ("candidates" in result && "generatedAt" in result) {
    return {
      ok: true,
      action: input.action,
      mastraRunId,
      candidates: result.candidates,
      nativeDatasetItemShape,
    }
  }
  if ("candidate" in result) {
    return {
      ok: true,
      action: input.action,
      mastraRunId,
      candidate: result.candidate,
      nativeDatasetItemShape,
    }
  }
  return {
    ok: true,
    action: input.action,
    mastraRunId,
    storeResult: result,
    nativeDatasetItemShape,
  }
}

function clientBase(options: ClientOptions) {
  return {
    url: options.candidateUrl ?? env.ADMIN_SEARCH_EVAL_CANDIDATES_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  }
}

function decisionPayload(
  input: SearchEvalCandidateReviewWorkflowInput,
): AdminCandidateDecisionPayload | null {
  if (!input.reviewerIdentity) return null
  return {
    reviewerIdentity: input.reviewerIdentity,
    reviewNotes: input.reviewNotes,
    promotionRunContext: {
      ...(input.promotionRunContext ?? {}),
      mastraReviewAction: input.action,
    },
  }
}

function patchPayload(
  input: SearchEvalCandidateReviewWorkflowInput,
): AdminCandidateReviewPatchPayload {
  return {
    reviewerIdentity: input.reviewerIdentity,
    sanitizedQueryText: input.sanitizedQueryText,
    sanitizedExpectedResultNotes: input.sanitizedExpectedResultNotes,
    sanitizedSourceAnchors: input.sanitizedSourceAnchors,
    sanitizationStatus: input.sanitizationStatus,
    reviewNotes: input.reviewNotes,
    promotionRunContext: {
      ...(input.promotionRunContext ?? {}),
      mastraReviewAction: input.action,
    },
  }
}

function promotePayload(
  input: SearchEvalCandidateReviewWorkflowInput,
): AdminCandidatePromotePayload | null {
  const decision = decisionPayload(input)
  if (!decision) return null
  return {
    ...decision,
    sanitizedQueryText: input.sanitizedQueryText,
    sanitizedExpectedResultNotes: input.sanitizedExpectedResultNotes,
    sanitizedSourceAnchors: input.sanitizedSourceAnchors,
    sanitizationStatus: "sanitized",
  }
}

function seedCandidatePayloads(
  input: SearchEvalCandidateReviewWorkflowInput,
  mastraRunId: string,
): AdminSearchEvalCandidatePayload[] {
  const locales = input.seedLocales ? new Set(input.seedLocales) : null
  return SEARCH_EVAL_SEED_PROMPTS.filter(
    (prompt) => locales == null || locales.has(prompt.locale),
  ).map((prompt) => ({
    source: "seed",
    locale: prompt.locale,
    queryText: prompt.queryText,
    expectedResultHints: [],
    sourceAnchors: [
      {
        source: "seed_prompt_set",
        version: SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
        id: prompt.id,
        tags: prompt.tags,
      },
    ],
    labelProvenance: {
      source: "mastra_seed_prompt_set",
      version: SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
    },
    generationModel: SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
    generationProvider: "mastra",
    judgeSummary: prompt.operatorNotes
      ? { operatorNotes: prompt.operatorNotes }
      : null,
    mastraRunId,
    generatedAt: new Date().toISOString(),
  }))
}

function userSubmissionPayload(
  input: SearchEvalCandidateReviewWorkflowInput,
  mastraRunId: string,
): AdminSearchEvalCandidatePayload[] | null {
  if (!input.userSubmission) return null
  return [
    {
      source: "user_submitted",
      locale: input.userSubmission.locale,
      queryText: input.userSubmission.queryText,
      expectedResultHints: [],
      sourceAnchors: [],
      labelProvenance: {
        source: "mastra_operator_submission",
        submittedByProvided: input.userSubmission.submittedBy != null,
        notesProvided: input.userSubmission.notes != null,
        rawSubmissionPayloadStored: false,
      },
      generationModel: "user-submitted:v1",
      generationProvider: "mastra",
      judgeSummary: null,
      mastraRunId,
      generatedAt: new Date().toISOString(),
    },
  ]
}

export async function runSearchEvalCandidateReviewWorkflow(
  rawInput: unknown,
  options: ClientOptions = {},
): Promise<SearchEvalCandidateReviewWorkflowResult> {
  const parsed =
    SearchEvalCandidateReviewWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { retryable: false })
  }

  const input = parsed.data
  const mastraRunId = options.runId ?? randomUUID()
  const base = clientBase(options)

  if (input.action === "list") {
    const result = await (options.listClient ?? callAdminCandidateList)({
      ...base,
      filters: input.filters,
    })
    return result.ok
      ? success(input, mastraRunId, result.result)
      : adminFailure(result, "read")
  }

  if (input.action === "submit-seed" || input.action === "submit-user") {
    const candidates =
      input.action === "submit-seed"
        ? seedCandidatePayloads(input, mastraRunId)
        : userSubmissionPayload(input, mastraRunId)
    if (candidates == null || candidates.length === 0) {
      return failure("invalid_input", { retryable: false })
    }
    const result = await (options.storeClient ?? callAdminCandidateStore)({
      ...base,
      payload: { candidates },
    })
    return result.ok
      ? success(input, mastraRunId, result.result)
      : adminFailure(result, "store")
  }

  if (!input.candidateId) {
    return failure("invalid_input", { retryable: false })
  }

  if (input.action === "detail") {
    const result = await (options.detailClient ?? callAdminCandidateDetail)({
      ...base,
      candidateId: input.candidateId,
    })
    return result.ok
      ? success(input, mastraRunId, result.result)
      : adminFailure(result, "read")
  }

  if (input.action === "edit") {
    const result = await (options.patchClient ?? callAdminCandidateReviewPatch)(
      {
        ...base,
        candidateId: input.candidateId,
        payload: patchPayload(input),
      },
    )
    return result.ok
      ? success(input, mastraRunId, result.result)
      : adminFailure(result, "review")
  }

  const decision =
    input.action === "promote" ? promotePayload(input) : decisionPayload(input)
  if (!decision) return failure("invalid_input", { retryable: false })

  const client =
    input.action === "promote"
      ? (options.promoteClient ?? callAdminCandidatePromote)
      : input.action === "reject"
        ? (options.rejectClient ?? callAdminCandidateReject)
        : (options.archiveClient ?? callAdminCandidateArchive)
  const result = await client({
    ...base,
    candidateId: input.candidateId,
    payload: decision,
  })
  return result.ok
    ? success(input, mastraRunId, result.result)
    : adminFailure(result, "review")
}

const searchEvalCandidateReviewStep = createStep({
  id: "review-search-eval-candidate",
  description:
    "Review, sanitize, reject, archive, promote, or submit search eval candidates through Admin HTTP.",
  inputSchema: SearchEvalCandidateReviewWorkflowInputSchema,
  outputSchema: CandidateReviewResultSchema,
  execute: async ({ inputData, runId }) =>
    runSearchEvalCandidateReviewWorkflow(inputData, { runId }),
})

export const searchEvalCandidateReviewWorkflow = createWorkflow({
  id: "search-eval-candidate-review",
  description:
    "Human review and promotion workflow for search eval regression candidates.",
  inputSchema: SearchEvalCandidateReviewWorkflowInputSchema,
  outputSchema: CandidateReviewResultSchema,
})
  .then(searchEvalCandidateReviewStep)
  .commit()

export async function launchSearchEvalCandidateReviewWorkflow(
  rawInput: unknown,
  options: ClientOptions = {},
): Promise<SearchEvalCandidateReviewWorkflowResult> {
  const parsed =
    SearchEvalCandidateReviewWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { retryable: false })
  }
  const runId = options.runId ?? randomUUID()
  const run = await searchEvalCandidateReviewWorkflow.createRun({ runId })
  const result = await run.start({ inputData: parsed.data }).catch(() => null)
  if (result?.status === "success") {
    return result.result as SearchEvalCandidateReviewWorkflowResult
  }
  return failure("admin_review_failed", { retryable: true })
}

function routeStatusForResult(result: SearchEvalCandidateReviewWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "admin_config_missing") return 503
  if (result.reason === "admin_auth_failed") return 502
  if (
    result.reason === "admin_read_rejected" ||
    result.reason === "admin_store_rejected" ||
    result.reason === "admin_review_rejected"
  ) {
    return 409
  }
  return 502
}

export async function handleSearchEvalCandidateReviewRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSearchEvalCandidateReviewWorkflow,
}: RouteHandlerInput): Promise<SearchEvalCandidateReviewRouteOutcome> {
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

export const _internal = {
  nativeDatasetItemShape,
  seedCandidatePayloads,
  userSubmissionPayload,
}
