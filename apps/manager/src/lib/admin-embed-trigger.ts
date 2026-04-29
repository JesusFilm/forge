// Thin GraphQL proxy to apps/admin's embed-trigger mutations.
//
// Per plan 006: admin owns the embedding workflow + destination
// Postgres schema; manager exposes operator-facing trigger surfaces
// that forward to admin's `triggerSceneEmbeddingBackfill` /
// `triggerTranscriptEmbeddingBackfill` GraphQL mutations using a
// service-to-service bearer key.
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

import { env } from "@/config/env"

export type AdminTriggerEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; reason: "config_missing"; message: string }
  | {
      ok: false
      reason: "graphql_error"
      messages: string[]
      httpStatus: number
    }
  | { ok: false; reason: "network_error"; message: string }
  | { ok: false; reason: "parse_error"; message: string; httpStatus: number }

type TriggerKind = "scene" | "transcript"

const SCENE_OPERATION = /* GraphQL */ `
  mutation TriggerSceneEmbeddingBackfill(
    $mappingS3Key: String
    $coreIds: [String!]
    $locales: [String!]
  ) {
    triggerSceneEmbeddingBackfill(
      mappingS3Key: $mappingS3Key
      coreIds: $coreIds
      locales: $locales
    )
  }
`

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

export type SceneTriggerVars = {
  mappingS3Key?: string
  coreIds?: string[]
  locales?: string[]
}

export type TranscriptTriggerVars = {
  mappingS3Key?: string
  coreIds?: string[]
  languages?: string[]
}

const RESPONSE_FIELD: Record<TriggerKind, string> = {
  scene: "triggerSceneEmbeddingBackfill",
  transcript: "triggerTranscriptEmbeddingBackfill",
}

async function postToAdmin(
  kind: TriggerKind,
  query: string,
  variables: Record<string, unknown>,
): Promise<AdminTriggerEnvelope> {
  if (!env.ADMIN_GRAPHQL_URL || !env.ADMIN_EMBED_TRIGGER_API_KEY) {
    return {
      ok: false,
      reason: "config_missing",
      message:
        "ADMIN_GRAPHQL_URL and ADMIN_EMBED_TRIGGER_API_KEY must be set on apps/manager to proxy embed triggers to admin",
    }
  }

  let response: Response
  try {
    response = await fetch(env.ADMIN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.ADMIN_EMBED_TRIGGER_API_KEY}`,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : String(error),
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
      message: "admin GraphQL endpoint returned invalid JSON",
      httpStatus: response.status,
    }
  }

  if (payload.errors && payload.errors.length > 0) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: payload.errors.map((e) => e.message),
      httpStatus: response.status,
    }
  }

  const fieldName = RESPONSE_FIELD[kind]
  const data = payload.data?.[fieldName]
  if (data === undefined) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: [
        `admin GraphQL response missing data.${fieldName} (status ${response.status})`,
      ],
      httpStatus: response.status,
    }
  }

  return { ok: true, data }
}

export async function triggerSceneEmbeddingBackfill(
  vars: SceneTriggerVars,
): Promise<AdminTriggerEnvelope> {
  return postToAdmin("scene", SCENE_OPERATION, vars)
}

export async function triggerTranscriptEmbeddingBackfill(
  vars: TranscriptTriggerVars,
): Promise<AdminTriggerEnvelope> {
  return postToAdmin("transcript", TRANSCRIPT_OPERATION, vars)
}
