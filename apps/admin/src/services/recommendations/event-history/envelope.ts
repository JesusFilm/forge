import { createHash } from "node:crypto"

export class RecommendationEventEnvelopeError extends Error {
  readonly code = "invalid_input" as const

  constructor(message: string) {
    super(message)
    this.name = "RecommendationEventEnvelopeError"
  }
}

export const RECOMMENDATION_EVENT_FAMILIES = [
  "request",
  "served-item",
  "evidence",
  "selection",
  "playback-episode",
  "playback-fact",
  "outcome",
  "content-action",
  "watch-exposure",
  "experiment-assignment",
  "experiment-visit",
  "correction",
  "erasure",
] as const

export type RecommendationEventFamily =
  (typeof RECOMMENDATION_EVENT_FAMILIES)[number]
export type SafeJson =
  | null
  | boolean
  | number
  | string
  | SafeJson[]
  | { [key: string]: SafeJson }

export type RecommendationEventEnvelope = {
  version: 1
  family: RecommendationEventFamily
  logicalId: string
  revision: number
  occurredAt: string
  acceptedAt: string
  expiresAt: string
  payloadDigest: string
  payload: Record<string, SafeJson>
}

// Sized for bounded request traces, not just individual playback facts.
export const MAX_EVENT_ENVELOPE_BYTES = 131_072
const MAX_PAYLOAD_BYTES = 126_976
const SENSITIVE_KEY =
  /(?:secret|token|cookie|authorization|password|email|phone|ipaddress|session|browser|userid|jwt|bearer|credential|apikey|private)/i

function canonical(value: unknown, depth = 0): SafeJson {
  if (depth > 8)
    throw new RecommendationEventEnvelopeError(
      "Event payload exceeds nesting limit",
    )
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (value.length > 2048)
      throw new RecommendationEventEnvelopeError(
        "Event payload array exceeds limit",
      )
    return value.map((part) => canonical(part, depth + 1))
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new RecommendationEventEnvelopeError(
      "Event payload must be plain JSON",
    )
  const result: Record<string, SafeJson> = {}
  const entries = Object.entries(value)
  if (entries.length > 256)
    throw new RecommendationEventEnvelopeError(
      "Event payload object exceeds limit",
    )
  for (const [key, part] of entries.sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) ||
      key.toLowerCase() === "ip" ||
      SENSITIVE_KEY.test(key)
    )
      throw new RecommendationEventEnvelopeError(
        "Event payload field is unsafe",
      )
    result[key] = canonical(part, depth + 1)
  }
  return result
}

function iso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new RecommendationEventEnvelopeError("Invalid event date")
  return value.toISOString()
}

function validateIdentity(
  family: unknown,
  logicalId: unknown,
  revision: unknown,
): asserts family is RecommendationEventFamily {
  if (
    !RECOMMENDATION_EVENT_FAMILIES.includes(family as RecommendationEventFamily)
  )
    throw new RecommendationEventEnvelopeError("Unknown event family")
  if (
    typeof logicalId !== "string" ||
    logicalId.length > 191 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/.test(logicalId)
  )
    throw new RecommendationEventEnvelopeError("Invalid logical event ID")
  if (
    !Number.isSafeInteger(revision) ||
    (revision as number) < 1 ||
    (revision as number) > 2_147_483_647
  )
    throw new RecommendationEventEnvelopeError("Invalid event revision")
}

// Producers must supply family-specific, redacted fields and their explicit
// allowlist. This generic codec cannot establish semantic privacy on its own.
export function createRecommendationEventEnvelope(input: {
  family: RecommendationEventFamily
  logicalId: string
  revision: number
  occurredAt: Date
  acceptedAt: Date
  expiresAt: Date
  payload: Record<string, unknown>
  allowedFields: readonly string[]
}): RecommendationEventEnvelope {
  validateIdentity(input.family, input.logicalId, input.revision)
  if (!Array.isArray(input.allowedFields) || !input.allowedFields.length)
    throw new RecommendationEventEnvelopeError(
      "Event payload field allowlist required",
    )
  if (
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  )
    throw new RecommendationEventEnvelopeError("Invalid event payload")
  for (const key of Object.keys(input.payload)) {
    if (!input.allowedFields.includes(key))
      throw new RecommendationEventEnvelopeError(
        "Event payload field is not approved",
      )
  }
  const payload = canonical(input.payload) as Record<string, SafeJson>
  const payloadJson = JSON.stringify(payload)
  if (Buffer.byteLength(payloadJson) > MAX_PAYLOAD_BYTES)
    throw new RecommendationEventEnvelopeError(
      "Event payload exceeds byte limit",
    )
  const occurredAt = iso(input.occurredAt)
  const acceptedAt = iso(input.acceptedAt)
  const expiresAt = iso(input.expiresAt)
  if (expiresAt <= acceptedAt)
    throw new RecommendationEventEnvelopeError("Invalid event chronology")
  const envelope: RecommendationEventEnvelope = {
    version: 1,
    family: input.family,
    logicalId: input.logicalId,
    revision: input.revision,
    occurredAt,
    acceptedAt,
    expiresAt,
    payloadDigest: createHash("sha256").update(payloadJson).digest("hex"),
    payload,
  }
  if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_EVENT_ENVELOPE_BYTES)
    throw new RecommendationEventEnvelopeError(
      "Event envelope exceeds byte limit",
    )
  return envelope
}

export function parseRecommendationEventEnvelope(
  json: string,
): RecommendationEventEnvelope {
  if (Buffer.byteLength(json) > MAX_EVENT_ENVELOPE_BYTES)
    throw new RecommendationEventEnvelopeError(
      "Event envelope exceeds byte limit",
    )
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new RecommendationEventEnvelopeError("Invalid event JSON")
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new RecommendationEventEnvelopeError("Invalid event envelope")
  const value = raw as Record<string, unknown>
  if (
    value.version !== 1 ||
    Object.keys(value).sort().join(",") !==
      "acceptedAt,expiresAt,family,logicalId,occurredAt,payload,payloadDigest,revision,version"
  )
    throw new RecommendationEventEnvelopeError("Unsupported event envelope")
  validateIdentity(value.family, value.logicalId, value.revision)
  if (
    typeof value.payload !== "object" ||
    value.payload === null ||
    Array.isArray(value.payload)
  )
    throw new RecommendationEventEnvelopeError("Invalid event payload")
  const payload = canonical(value.payload) as Record<string, SafeJson>
  const payloadJson = JSON.stringify(payload)
  if (Buffer.byteLength(payloadJson) > MAX_PAYLOAD_BYTES)
    throw new RecommendationEventEnvelopeError(
      "Event payload exceeds byte limit",
    )
  const digest = createHash("sha256").update(payloadJson).digest("hex")
  if (digest !== value.payloadDigest)
    throw new RecommendationEventEnvelopeError("Event payload digest mismatch")
  const occurredAt = iso(new Date(value.occurredAt as string))
  const acceptedAt = iso(new Date(value.acceptedAt as string))
  const expiresAt = iso(new Date(value.expiresAt as string))
  if (
    occurredAt !== value.occurredAt ||
    acceptedAt !== value.acceptedAt ||
    expiresAt !== value.expiresAt ||
    expiresAt <= acceptedAt
  )
    throw new RecommendationEventEnvelopeError("Invalid event chronology")
  const envelope = {
    ...value,
    payload,
  } as unknown as RecommendationEventEnvelope
  if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_EVENT_ENVELOPE_BYTES)
    throw new RecommendationEventEnvelopeError(
      "Event envelope exceeds byte limit",
    )
  return envelope
}
