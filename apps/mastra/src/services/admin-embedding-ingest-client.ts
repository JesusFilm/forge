export type EmbeddingGenerationMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type AdminEmbeddingIngestStatus =
  | "created"
  | "unchanged"
  | "repaired"
  | "forced"
  | "model_upgraded"
  | "rejected"

export type AdminEmbeddingIngestClientFailure<TResult> = {
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
  result?: TResult
  adminReason?: string
}

export type AdminEmbeddingIngestClientResult<TResult> =
  | { ok: true; result: TResult }
  | AdminEmbeddingIngestClientFailure<TResult>

export type CallAdminEmbeddingIngestInput<TPayload, TResult> = {
  ingestUrl?: string
  bearer?: string
  payload: TPayload
  parseResult: (body: unknown) => TResult | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export const ADMIN_EMBEDDING_INGEST_STATUSES = new Set([
  "created",
  "unchanged",
  "repaired",
  "forced",
  "model_upgraded",
  "rejected",
])

export function isAdminEmbeddingIngestStatus(
  value: unknown,
): value is AdminEmbeddingIngestStatus {
  return typeof value === "string" && ADMIN_EMBEDDING_INGEST_STATUSES.has(value)
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
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

export async function callAdminEmbeddingIngest<TPayload, TResult>({
  ingestUrl,
  bearer,
  payload,
  parseResult,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: CallAdminEmbeddingIngestInput<TPayload, TResult>): Promise<
  AdminEmbeddingIngestClientResult<TResult>
> {
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
  const result = parseResult(body)
  const adminError = parseAdminError(body)

  if (
    response.status === 409 &&
    result &&
    (result as { status?: unknown }).status === "rejected"
  ) {
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
        response.status >= 500 ||
        response.status === 429 ||
        adminError?.retryable === true,
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
