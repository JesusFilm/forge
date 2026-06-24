import { z } from "zod"

export type AdminSearchEvalClientFailure = {
  ok: false
  reason:
    | "config_missing"
    | "auth_failed"
    | "network_error"
    | "parse_error"
    | "rate_limited"
    | "rejected"
  retryable: boolean
  status?: number
  adminReason?: string
}

export type AdminSearchEvalClientResult<TResult> =
  | { ok: true; result: TResult }
  | AdminSearchEvalClientFailure

export const AdminTraceSampleSchema = z
  .object({
    id: z.string(),
    queryText: z.string(),
    locale: z.string(),
    routeSource: z.enum(["rest", "graphql"]),
    requestedMode: z.string().nullable(),
    searchMode: z.string(),
    resultCount: z.number().int().nonnegative(),
    latencyBucket: z.string(),
    outcome: z.enum(["success", "degraded", "failed"]),
    traceClass: z.string(),
    queryQualityLabel: z.string(),
    sensitiveQueryLabel: z.string(),
    abuseLabel: z.string(),
    queryLabelSource: z.string(),
    queryLabelVersion: z.string(),
    queryLabeledAt: z.string(),
    llmQueryQualityLabel: z.string().nullable(),
    llmAbuseLabel: z.string().nullable(),
    llmLabelSource: z.string().nullable(),
    llmLabelVersion: z.string().nullable(),
    llmLabelReason: z.string().nullable(),
    llmLabeledAt: z.string().nullable(),
    rawExpiresAt: z.string(),
    createdAt: z.string(),
  })
  .strict()

export type AdminTraceSample = z.infer<typeof AdminTraceSampleSchema>

export const AdminTraceSampleResponseSchema = z
  .object({
    traces: z.array(AdminTraceSampleSchema),
    generatedAt: z.string(),
  })
  .strict()

export type AdminTraceSampleResponse = z.infer<
  typeof AdminTraceSampleResponseSchema
>

export const AdminLocaleProfileSchema = z
  .object({
    locale: z.string(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    source: z.literal("harness"),
  })
  .strict()

const ExpectedHintSchema = z
  .object({
    type: z.enum(["video", "experience"]),
    id: z.string(),
    slug: z.string(),
    title: z.string(),
  })
  .strict()

export const AdminCatalogAnchorSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("video"),
      id: z.string(),
      locale: z.string(),
      title: z.string(),
      slug: z.string(),
      label: z.string().nullable(),
      snippet: z.string().nullable(),
      description: z.string().nullable(),
      keywords: z.array(z.string()),
      expectedResultHints: z.array(ExpectedHintSchema),
    })
    .strict(),
  z
    .object({
      source: z.literal("experience"),
      id: z.string(),
      locale: z.string(),
      title: z.string(),
      slug: z.string(),
      snippet: z.string().nullable(),
      description: z.string().nullable(),
      expectedResultHints: z.array(ExpectedHintSchema),
    })
    .strict(),
])

export type AdminCatalogAnchor = z.infer<typeof AdminCatalogAnchorSchema>

export const AdminCatalogContextResponseSchema = z
  .object({
    localeProfiles: z.array(AdminLocaleProfileSchema),
    anchors: z.array(AdminCatalogAnchorSchema),
    generatedAt: z.string(),
  })
  .strict()

export type AdminCatalogContextResponse = z.infer<
  typeof AdminCatalogContextResponseSchema
>

export type AdminSearchEvalCandidatePayload = {
  source: "catalog" | "locale_quality" | "trace" | "seed" | "user_submitted"
  locale: string
  queryText: string
  expectedResultHints?: unknown[]
  sourceAnchors?: unknown[]
  labelProvenance?: Record<string, unknown>
  generationModel: string
  generationProvider?: string | null
  judgeSummary?: Record<string, unknown> | null
  mastraRunId?: string | null
  retentionExpiresAt?: string | null
  generatedAt?: string | null
}

const SearchResultSchema = z
  .object({
    type: z.enum(["video", "experience"]),
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    imageUrl: z.string().nullable(),
    snippet: z.string(),
    startSeconds: z.number().nullable(),
    playbackId: z.string().nullable(),
    score: z.number(),
    label: z.string().nullable().optional(),
    durationSeconds: z.number().int().nullable().optional(),
    childCount: z.number().int().nullable().optional(),
  })
  .strict()
  .transform((result) => ({
    ...result,
    label: result.label ?? null,
    durationSeconds: result.durationSeconds ?? null,
    childCount: result.childCount ?? null,
  }))

const NonNegativeTimingMsSchema = z
  .number()
  .nonnegative()
  .refine((value) => Number.isFinite(value), "must be finite")

export const AdminSearchRetrieverTimingSchema = z
  .object({
    label: z.string(),
    status: z.enum(["fulfilled", "rejected"]),
    elapsedMs: NonNegativeTimingMsSchema,
    resultCount: z.number().int().nonnegative(),
  })
  .strict()

export const AdminSearchTimingsSchema = z
  .object({
    totalMs: NonNegativeTimingMsSchema,
    retrievalsMs: NonNegativeTimingMsSchema,
    fusionMs: NonNegativeTimingMsSchema,
    dilutionCapMs: NonNegativeTimingMsSchema,
    dedupeMs: NonNegativeTimingMsSchema,
    mappingMs: NonNegativeTimingMsSchema,
    hydrationMs: NonNegativeTimingMsSchema,
    retrievers: z.array(AdminSearchRetrieverTimingSchema),
  })
  .strict()

export type AdminSearchTimings = z.infer<typeof AdminSearchTimingsSchema>

export const AdminSearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema),
    hasMore: z.boolean(),
    query: z.string(),
    searchMode: z.enum(["hybrid", "keyword-only"]),
    timings: AdminSearchTimingsSchema.optional(),
  })
  .strict()

export type AdminSearchResponse = z.infer<typeof AdminSearchResponseSchema>

const CandidateListResponseSchema = z
  .object({
    candidates: z.array(
      z
        .object({
          id: z.string(),
          source: z.enum([
            "catalog",
            "locale_quality",
            "trace",
            "seed",
            "user_submitted",
          ]),
          promotionStatus: z
            .enum(["generated", "rejected", "promoted", "archived"])
            .optional(),
          locale: z.string(),
          queryText: z.string().nullable(),
          expectedResultHints: z.unknown(),
          sourceAnchors: z.unknown(),
          labelProvenance: z.unknown(),
          generationModel: z.string(),
          generationProvider: z.string().nullable(),
          judgeSummary: z.unknown().nullable(),
          sanitizedQueryText: z.string().nullable().optional(),
          sanitizedExpectedResultNotes: z.string().nullable().optional(),
          sanitizedSourceAnchors: z.unknown().optional(),
          sanitizationStatus: z
            .enum(["pending", "sanitized", "unsafe"])
            .optional(),
          reviewerIdentity: z.string().nullable().optional(),
          reviewedAt: z.string().nullable().optional(),
          reviewNotes: z.string().nullable().optional(),
          promotedAt: z.string().nullable().optional(),
          promotionRunContext: z.unknown().optional(),
          mastraRunId: z.string().nullable(),
          retentionExpiresAt: z.string().nullable(),
          generatedAt: z.string(),
          createdAt: z.string(),
        })
        .strict(),
    ),
    generatedAt: z.string(),
  })
  .strict()

export type AdminCandidateListResponse = z.infer<
  typeof CandidateListResponseSchema
>

const CandidateDetailResponseSchema = z
  .object({
    candidate: CandidateListResponseSchema.shape.candidates.element,
  })
  .strict()

export type AdminCandidateDetailResponse = z.infer<
  typeof CandidateDetailResponseSchema
>

export type AdminCandidateReviewPatchPayload = {
  reviewerIdentity?: string | null
  sanitizedQueryText?: string | null
  sanitizedExpectedResultNotes?: string | null
  sanitizedSourceAnchors?: unknown
  sanitizationStatus?: "pending" | "sanitized" | "unsafe"
  reviewNotes?: string | null
  promotionRunContext?: unknown
}

export type AdminCandidateDecisionPayload = {
  reviewerIdentity: string
  reviewNotes?: string | null
  promotionRunContext?: unknown
}

export type AdminCandidatePromotePayload = AdminCandidateDecisionPayload & {
  sanitizedQueryText?: string | null
  sanitizedExpectedResultNotes?: string | null
  sanitizedSourceAnchors?: unknown
  sanitizationStatus?: "sanitized"
}

const CandidateStoreResponseSchema = z
  .object({
    storedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    candidates: z.array(
      z
        .object({
          id: z.string(),
          dedupeKey: z.string(),
          status: z.enum(["created", "updated"]),
        })
        .strict(),
    ),
    skipped: z.array(
      z
        .object({
          dedupeKey: z.string(),
          reason: z.literal("already_promoted_or_rejected"),
        })
        .strict(),
    ),
  })
  .strict()

export type AdminCandidateStoreResponse = z.infer<
  typeof CandidateStoreResponseSchema
>

type JsonPostInput<TResult> = {
  url?: string
  bearer?: string
  payload: unknown
  schema: z.ZodType<TResult>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function retryAfterMs(value: string | null): number | null {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000)
  }
  return null
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 30_000)
}

async function readAdminReason(
  response: Response,
): Promise<string | undefined> {
  const body = await response.json().catch(() => undefined)
  return body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : undefined
}

function failureForStatus(
  status: number,
  adminReason?: string,
): AdminSearchEvalClientFailure {
  if (status === 401) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status,
      adminReason,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status,
      adminReason,
    }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    retryable: status >= 500,
    status,
    adminReason,
  }
}

async function postJson<TResult>({
  url,
  bearer,
  payload,
  schema,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: JsonPostInput<TResult>): Promise<AdminSearchEvalClientResult<TResult>> {
  if (!url || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await fetchImpl(new URL(url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    const adminReason =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined
    return failureForStatus(response.status, adminReason)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: response.status,
    }
  }

  return { ok: true, result: parsed.data }
}

type JsonRequestInput<TResult> = {
  url?: string
  bearer?: string
  method: "GET" | "PATCH" | "POST"
  payload?: unknown
  schema: z.ZodType<TResult>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

async function requestJson<TResult>({
  url,
  bearer,
  method,
  payload,
  schema,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: JsonRequestInput<TResult>): Promise<AdminSearchEvalClientResult<TResult>> {
  if (!url || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await fetchImpl(new URL(url), {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(method === "GET"
          ? { accept: "application/json" }
          : {
              accept: "application/json",
              "content-type": "application/json",
            }),
      },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    const adminReason =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : undefined
    return failureForStatus(response.status, adminReason)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: response.status,
    }
  }

  return { ok: true, result: parsed.data }
}

export async function callAdminEvalSearch(input: {
  url?: string
  bearer?: string
  payload: {
    query: string
    locale: string
    languageSlug?: string
    limit?: number
    offset?: number
    mode?: string | null
    contentType?: "video" | "experience" | null
  }
  timeoutMs?: number
  fetchImpl?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<AdminSearchEvalClientResult<AdminSearchResponse>> {
  const {
    url,
    bearer,
    payload,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    maxAttempts = 3,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = input
  if (!url || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let lastFailure: AdminSearchEvalClientFailure | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(new URL(url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      lastFailure = { ok: false, reason: "network_error", retryable: true }
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      return lastFailure
    }

    if (response.status === 429) {
      const wait = retryAfterMs(response.headers.get("retry-after"))
      if (attempt < maxAttempts) {
        await sleep(wait ?? backoffMs(attempt))
        continue
      }
      return {
        ok: false,
        reason: "rate_limited",
        retryable: true,
        status: response.status,
        adminReason: await readAdminReason(response),
      }
    }

    if (response.status === 401) {
      return failureForStatus(response.status)
    }

    if (!response.ok) {
      const retryable = response.status >= 500
      const adminReason = await readAdminReason(response)
      if (retryable && attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      return failureForStatus(response.status, adminReason)
    }

    const body = await response.json().catch(() => undefined)
    const parsed = AdminSearchResponseSchema.safeParse(body)
    if (!parsed.success) {
      return {
        ok: false,
        reason: "parse_error",
        retryable: true,
        status: response.status,
      }
    }

    return {
      ok: true,
      result: {
        ...parsed.data,
        results: parsed.data.results.map(truncateSnippet),
      },
    }
  }

  return lastFailure ?? { ok: false, reason: "network_error", retryable: true }
}

function truncateSnippet<T extends { snippet: string }>(result: T): T {
  const codepoints = Array.from(result.snippet)
  if (codepoints.length <= 200) return result
  return {
    ...result,
    snippet: `${codepoints.slice(0, 199).join("")}…`,
  }
}

export async function callAdminCandidateList(input: {
  url?: string
  bearer?: string
  filters?: {
    sources?: Array<
      "catalog" | "locale_quality" | "trace" | "seed" | "user_submitted"
    >
    statuses?: Array<"generated" | "rejected" | "promoted" | "archived">
    locales?: string[]
    mastraRunId?: string
    limit?: number
  }
  timeoutMs?: number
  fetchImpl?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<AdminSearchEvalClientResult<AdminCandidateListResponse>> {
  const {
    url,
    bearer,
    filters,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    maxAttempts = 3,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = input
  if (!url || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const requestUrl = new URL(url)
  if (filters?.sources && filters.sources.length > 0) {
    requestUrl.searchParams.set("source", filters.sources.join(","))
  }
  if (filters?.statuses && filters.statuses.length > 0) {
    requestUrl.searchParams.set("status", filters.statuses.join(","))
  }
  if (filters?.locales && filters.locales.length > 0) {
    requestUrl.searchParams.set("locale", filters.locales.join(","))
  }
  if (filters?.mastraRunId) {
    requestUrl.searchParams.set("mastraRunId", filters.mastraRunId)
  }
  if (filters?.limit != null) {
    requestUrl.searchParams.set("limit", String(filters.limit))
  }

  let lastFailure: AdminSearchEvalClientFailure | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      lastFailure = { ok: false, reason: "network_error", retryable: true }
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      return lastFailure
    }

    if (!response.ok) {
      const adminReason = await readAdminReason(response)
      const failure = failureForStatus(response.status, adminReason)
      if (failure.retryable && attempt < maxAttempts) {
        await sleep(
          response.status === 429
            ? (retryAfterMs(response.headers.get("retry-after")) ??
                backoffMs(attempt))
            : backoffMs(attempt),
        )
        continue
      }
      return failure
    }

    const body = await response.json().catch(() => undefined)
    const parsed = CandidateListResponseSchema.safeParse(body)
    if (!parsed.success) {
      return {
        ok: false,
        reason: "parse_error",
        retryable: true,
        status: response.status,
      }
    }
    return { ok: true, result: parsed.data }
  }

  return lastFailure ?? { ok: false, reason: "network_error", retryable: true }
}

export function callAdminTraceSample(input: {
  url?: string
  bearer?: string
  payload: unknown
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminTraceSampleResponse>> {
  return postJson({
    ...input,
    schema: AdminTraceSampleResponseSchema,
  })
}

export function callAdminCatalogContext(input: {
  url?: string
  bearer?: string
  payload: unknown
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCatalogContextResponse>> {
  return postJson({
    ...input,
    schema: AdminCatalogContextResponseSchema,
  })
}

export function callAdminCandidateStore(input: {
  url?: string
  bearer?: string
  payload: { candidates: AdminSearchEvalCandidatePayload[] }
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateStoreResponse>> {
  return postJson({
    ...input,
    schema: CandidateStoreResponseSchema,
  })
}

function candidateActionUrl(
  baseUrl: string | undefined,
  candidateId: string,
  action?: "promote" | "reject" | "archive",
): string | undefined {
  if (!baseUrl) return undefined
  const root = new URL(baseUrl)
  const pathname = `${root.pathname.replace(/\/$/, "")}/${encodeURIComponent(candidateId)}${action ? `/${action}` : ""}`
  root.pathname = pathname
  root.search = ""
  return root.toString()
}

export function callAdminCandidateDetail(input: {
  url?: string
  bearer?: string
  candidateId: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateDetailResponse>> {
  return requestJson({
    ...input,
    method: "GET",
    url: candidateActionUrl(input.url, input.candidateId),
    schema: CandidateDetailResponseSchema,
  })
}

export function callAdminCandidateReviewPatch(input: {
  url?: string
  bearer?: string
  candidateId: string
  payload: AdminCandidateReviewPatchPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateDetailResponse>> {
  return requestJson({
    ...input,
    method: "PATCH",
    url: candidateActionUrl(input.url, input.candidateId),
    schema: CandidateDetailResponseSchema,
  })
}

export function callAdminCandidateReject(input: {
  url?: string
  bearer?: string
  candidateId: string
  payload: AdminCandidateDecisionPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateDetailResponse>> {
  return requestJson({
    ...input,
    method: "POST",
    url: candidateActionUrl(input.url, input.candidateId, "reject"),
    schema: CandidateDetailResponseSchema,
  })
}

export function callAdminCandidateArchive(input: {
  url?: string
  bearer?: string
  candidateId: string
  payload: AdminCandidateDecisionPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateDetailResponse>> {
  return requestJson({
    ...input,
    method: "POST",
    url: candidateActionUrl(input.url, input.candidateId, "archive"),
    schema: CandidateDetailResponseSchema,
  })
}

export function callAdminCandidatePromote(input: {
  url?: string
  bearer?: string
  candidateId: string
  payload: AdminCandidatePromotePayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<AdminSearchEvalClientResult<AdminCandidateDetailResponse>> {
  return requestJson({
    ...input,
    method: "POST",
    url: candidateActionUrl(input.url, input.candidateId, "promote"),
    schema: CandidateDetailResponseSchema,
  })
}
