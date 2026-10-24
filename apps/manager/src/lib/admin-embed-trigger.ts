// Thin GraphQL proxy to apps/admin's transcript embed-trigger mutation.
//
// Per plan 006: admin owns the embedding workflow + destination
// Postgres schema; manager exposes operator-facing trigger surfaces
// that forward to admin's `triggerTranscriptEmbeddingBackfill` GraphQL
// mutation using a service-to-service bearer key.
//
// Behaviour parity (single workflow, single source of truth) is
// guaranteed by NOT duplicating the workflow on manager. Manager's
// REST handlers wrap this helper; admin owns execution.
//
// Env (validated at module load via @/config/env):
//   - ADMIN_GRAPHQL_URL          full URL of admin's /api/graphql
//   - ADMIN_EMBED_TRIGGER_API_KEY  matches one of admin's WORKFLOW_API_KEYS
//
// The helper returns a discriminated outcome rather than throwing on
// auth / network failures so route handlers can map to specific
// HTTP status codes (5xx for upstream errors, 4xx for manager-side
// validation).
//
// Failure shape: every non-ok variant carries `messages: string[]` so
// callers can fan-in via a single `result.messages` access without a
// per-variant ternary. `retryable: boolean` advertises whether a
// transient retry is safe (true for network/parse errors; false for
// graphql_error / config_missing — those signal a real upstream
// rejection or operator misconfig).

import { env } from "@/config/env"

const ADMIN_FETCH_TIMEOUT_MS = 15_000

export type AdminTriggerEnvelope =
  | { ok: true; data: unknown }
  | {
      ok: false
      reason: "config_missing"
      messages: string[]
      retryable: false
    }
  | {
      ok: false
      reason: "graphql_error"
      messages: string[]
      httpStatus: number
      retryable: false
    }
  | {
      ok: false
      reason: "network_error"
      messages: string[]
      retryable: true
    }
  | {
      ok: false
      reason: "parse_error"
      messages: string[]
      httpStatus: number
      retryable: true
    }

const TRANSCRIPT_OPERATION = /* GraphQL */ `
  mutation TriggerTranscriptEmbeddingBackfill(
    $mappingS3Key: String
    $coreIds: [String!]
    $languages: [String!]
  ) {
    triggerTranscriptEmbeddingBackfill(
      mappingS3Key: $mappingS3Key
      coreIds: $coreIds
      languages: $languages
    )
  }
`

export type TranscriptTriggerVars = {
  mappingS3Key?: string
  coreIds?: string[]
  languages?: string[]
}

const TRANSCRIPT_RESPONSE_FIELD = "triggerTranscriptEmbeddingBackfill"

async function postToAdmin(
  query: string,
  variables: Record<string, unknown>,
): Promise<AdminTriggerEnvelope> {
  if (!env.ADMIN_GRAPHQL_URL || !env.ADMIN_EMBED_TRIGGER_API_KEY) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "ADMIN_GRAPHQL_URL and ADMIN_EMBED_TRIGGER_API_KEY must be set on apps/manager to proxy embed triggers to admin",
      ],
      retryable: false,
    }
  }

  let response: Response
  try {
    // Bound the upstream call so a hung admin / stuck Cloudflare edge
    // does not pin manager request workers indefinitely. Admin's
    // trigger mutations are dispatchers (enqueue + return), so a
    // 15s ceiling is generous for the happy path.
    response = await fetch(env.ADMIN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.ADMIN_EMBED_TRIGGER_API_KEY}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      ok: false,
      reason: "network_error",
      messages: [
        isTimeout
          ? `admin GraphQL request timed out after ${ADMIN_FETCH_TIMEOUT_MS}ms`
          : messageText,
      ],
      retryable: true,
    }
  }

  let payload: {
    data?: Record<string, unknown>
    errors?: Array<{ message: string }>
  }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["admin GraphQL endpoint returned invalid JSON"],
      httpStatus: response.status,
      retryable: true,
    }
  }

  if (payload.errors && payload.errors.length > 0) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: payload.errors.map((e) => e.message),
      httpStatus: response.status,
      retryable: false,
    }
  }

  const data = payload.data?.[TRANSCRIPT_RESPONSE_FIELD]
  // Treat both `undefined` (missing field) and `null` (mutation
  // returned null with no errors — not currently possible against
  // admin's JSON scalar return type, but defensive against future
  // schema changes that introduce nullability) as missing-data.
  if (data === undefined || data === null) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: [
        `admin GraphQL response missing data.${TRANSCRIPT_RESPONSE_FIELD} (status ${response.status})`,
      ],
      httpStatus: response.status,
      retryable: false,
    }
  }

  return { ok: true, data }
}

export async function triggerTranscriptEmbeddingBackfill(
  vars: TranscriptTriggerVars,
): Promise<AdminTriggerEnvelope> {
  return postToAdmin(TRANSCRIPT_OPERATION, vars)
}
