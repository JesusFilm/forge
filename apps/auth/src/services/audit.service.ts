import { createHash } from "node:crypto"
import type { Prisma } from "@/generated/prisma"

const REDACTED_KEYS = new Set([
  "accessToken",
  "access_token",
  "authorization",
  "clientSecret",
  "client_secret",
  "code",
  "idToken",
  "id_token",
  "password",
  "refreshToken",
  "refresh_token",
  "token",
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

export function redactAuditMetadata(
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (REDACTED_KEYS.has(key)) return [key, "[redacted]"]

      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [key, redactAuditMetadata(value as Record<string, unknown>)]
      }

      return [key, value]
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
