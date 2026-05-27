import { z } from "zod"

export type AdminSearchEvalClientFailure = {
  ok: false
  reason:
    | "config_missing"
    | "auth_failed"
    | "network_error"
    | "parse_error"
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
  source: "catalog" | "locale_quality" | "trace"
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

  if (response.status === 401) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: response.status,
    }
  }

  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
          ? "rejected"
          : "network_error",
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
      adminReason:
        body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : undefined,
    }
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
