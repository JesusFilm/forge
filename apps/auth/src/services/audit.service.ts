import { createHash } from "node:crypto"
import type { Prisma } from "@/generated/prisma"

// Matched by exact, case-sensitive key lookup. Every credential therefore needs
// BOTH its snake_case wire spelling and its camelCase in-code spelling listed.
//
// `userCodeHash` is redacted even though `tokenHash` is not: a user code has a
// ~10^10 preimage space, so its unsalted sha256 is brute-forceable in seconds
// and the hash is credential-equivalent. Use a non-secret `deviceGrantId` (the
// DeviceCode row id) when an audit event needs to correlate back to a grant.
//
// Keys that CARRY a credential inside their value count too, not just keys that
// name one. `verification_uri_complete` is the RFC 8628 §3.3.1 URL with the raw
// user code in its query string (`/device?user_code=0194507302`), so recording
// the device-code response envelope would leak the code under a key no reader
// would think to check.
const REDACTED_KEYS = new Set([
  "accessToken",
  "access_token",
  "authorization",
  "authorizationCode",
  "authorization_code",
  "clientSecret",
  "client_secret",
  "code",
  "codeChallenge",
  "codeVerifier",
  "code_challenge",
  "code_verifier",
  "deviceCode",
  "deviceCodeHash",
  "device_code",
  "device_code_hash",
  "idToken",
  "id_token",
  "password",
  "refreshToken",
  "refresh_token",
  "token",
  "userCode",
  "userCodeHash",
  "user_code",
  "user_code_hash",
  "verificationUriComplete",
  "verification_uri_complete",
])

export type AuditEventInput = {
  eventType: string
  severity?: "info" | "warning" | "critical"
  actorUserId?: string | null
  appId?: string | null
  subject?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

export function hashAuditSubject(value: string | null | undefined) {
  if (!value) return null

  return createHash("sha256").update(value).digest("hex")
}

// Arrays are walked element-wise rather than passed through: an array is a
// container, never itself a credential, so a redacted key inside
// `{ attempts: [{ userCode: "…" }] }` must still be caught. Walking can only
// ever redact more, never less — a value survives unless its own key is in
// REDACTED_KEYS.
function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue)

  if (value && typeof value === "object") {
    return redactAuditMetadata(value as Record<string, unknown>)
  }

  return value
}

export function redactAuditMetadata(
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (REDACTED_KEYS.has(key)) return [key, "[redacted]"]

      return [key, redactAuditValue(value)]
    }),
  )
}

export function buildAuditEvent(input: AuditEventInput) {
  return {
    eventType: input.eventType,
    severity: (input.severity ?? "info").toUpperCase() as
      | "INFO"
      | "WARNING"
      | "CRITICAL",
    actorUserId: input.actorUserId ?? null,
    appId: input.appId ?? null,
    subjectHash: hashAuditSubject(input.subject),
    ipAddressHash: hashAuditSubject(input.ipAddress),
    userAgent: input.userAgent ?? null,
    metadata: redactAuditMetadata(input.metadata) as Prisma.InputJsonObject,
  }
}
