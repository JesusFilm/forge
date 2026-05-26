export type ExperienceEmbeddingGenerationMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type AdminExperienceEmbeddingIngestPayload = {
  target: {
    experienceId: string
    experienceLocaleId: string
    locale: string
    slug?: string
  }
  source: {
    contentHash: string
    summary: string
  }
  model: {
    name: string
    dimensions: number
    provider?: string
  }
  generation: {
    mode: ExperienceEmbeddingGenerationMode
    generatedAt: string
    mastraRunId: string
  }
  embedding: number[]
}

export type AdminExperienceEmbeddingIngestResult = {
  status:
    | "created"
    | "unchanged"
    | "repaired"
    | "forced"
    | "model_upgraded"
    | "rejected"
  reason?: string
  target: {
    experienceId: string
    experienceLocaleId: string
    locale: string
  }
  model: string
  dimensions: number
  mastraRunId: string
}

export type AdminExperienceIngestClientResult =
  | { ok: true; result: AdminExperienceEmbeddingIngestResult }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "rejected"
        | "ingest_failed"
      retryable: boolean
      status?: number
      result?: AdminExperienceEmbeddingIngestResult
      adminReason?: string
    }

export type CallAdminExperienceIngestInput = {
  ingestUrl?: string
  bearer?: string
  payload: AdminExperienceEmbeddingIngestPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const ADMIN_INGEST_STATUSES = new Set([
  "created",
  "unchanged",
  "repaired",
  "forced",
  "model_upgraded",
  "rejected",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseAdminResult(
  body: unknown,
): AdminExperienceEmbeddingIngestResult | null {
  const record = asRecord(body)
  const result = asRecord(record?.result)
  if (!result) return null

  if (
    typeof result.status !== "string" ||
    !ADMIN_INGEST_STATUSES.has(result.status) ||
    typeof result.model !== "string" ||
    typeof result.dimensions !== "number" ||
    typeof result.mastraRunId !== "string"
  ) {
    return null
  }

  const target = asRecord(result.target)
  if (
    !target ||
    typeof target.experienceId !== "string" ||
    typeof target.experienceLocaleId !== "string" ||
    typeof target.locale !== "string"
  ) {
    return null
  }

  return {
    status: result.status as AdminExperienceEmbeddingIngestResult["status"],
    reason: typeof result.reason === "string" ? result.reason : undefined,
    target: {
      experienceId: target.experienceId,
      experienceLocaleId: target.experienceLocaleId,
      locale: target.locale,
    },
    model: result.model,
    dimensions: result.dimensions,
    mastraRunId: result.mastraRunId,
  }
}

function parseAdminError(body: unknown): {
  reason?: string
  retryable?: boolean
} | null {
  const record = asRecord(body)
  if (!record) return null
  return {
    reason: typeof record.reason === "string" ? record.reason : undefined,
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
  }
}

export async function callAdminExperienceIngest({
  ingestUrl,
  bearer,
  payload,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: CallAdminExperienceIngestInput): Promise<AdminExperienceIngestClientResult> {
  if (!ingestUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await fetchImpl(new URL(ingestUrl), {
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
  const result = parseAdminResult(body)
  const adminError = parseAdminError(body)

  if (response.status === 409 && result?.status === "rejected") {
    return {
      ok: false,
      reason: "rejected",
      retryable: false,
      status: response.status,
      result,
    }
  }

  if (!response.ok) {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    ) {
      return {
        ok: false,
        reason: "rejected",
        retryable: false,
        status: response.status,
        adminReason: adminError?.reason,
      }
    }

    return {
      ok: false,
      reason: response.status >= 500 ? "network_error" : "ingest_failed",
      retryable:
        adminError?.retryable ??
        (response.status >= 500 || response.status === 429),
      status: response.status,
      adminReason: adminError?.reason,
    }
  }

  if (!result) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: response.status,
    }
  }

  return { ok: true, result }
}
