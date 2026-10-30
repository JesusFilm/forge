/**
 * The announcement payload contract (KTD9), beside the reminder one rather
 * than merged with it: the two carry different fields, admin owns this one,
 * and only this one crosses the network.
 *
 * The app models DESTINATIONS, not campaigns. A payload names a destination
 * kind and a slug plus one opaque campaign identifier, so admin can add a new
 * server-side notification type with no app release. Everything here is
 * untrusted on the way in, whatever wrote it.
 */

import { utf8ByteLength } from "../utf8ByteLength"

/** The discriminator admin stamps on an announcement (KTD9). */
export const PUSH_ANNOUNCEMENT_FAMILY = "announcement"

export const PUSH_ANNOUNCEMENT_PAYLOAD_VERSION = 1

/** The destination kinds this build can open. Admin may name others. */
export const PUSH_ANNOUNCEMENT_KINDS = [
  "video",
  "series",
  "experience",
] as const

export type PushAnnouncementKind = (typeof PUSH_ANNOUNCEMENT_KINDS)[number]

/** The same cap the reminder contract uses, in BYTES of the serialized form. */
export const PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES = 1024

/** The slug bound, in characters. Real slugs are far shorter. */
export const PUSH_ANNOUNCEMENT_MAX_SLUG_LENGTH = 200

/**
 * The campaign identifier bound, in characters. Admin mints 32 random bytes
 * base64url (43 characters, KTD14); the bound is loose on purpose, because
 * the app carries this value and never interprets it.
 */
export const PUSH_ANNOUNCEMENT_MAX_NONCE_LENGTH = 128

/** Every reason a tap can log. KTD9 facets on it, so the set stays fixed. */
export const PUSH_ANNOUNCEMENT_PARSE_REASONS = [
  "not_an_object",
  "too_large",
  "version_mismatch",
  "unknown_kind",
  "invalid_slug",
  "invalid_nonce",
] as const

export type PushAnnouncementParseReason =
  (typeof PUSH_ANNOUNCEMENT_PARSE_REASONS)[number]

export type PushAnnouncementParseResult =
  | {
      ok: true
      kind: PushAnnouncementKind
      slug: string
      nonce: string
    }
  | { ok: false; reason: PushAnnouncementParseReason }

/** Which contract an arriving payload belongs to (KTD9). */
export type NotificationFamily = "announcement" | "reminder"

// RFC 3986's unreserved set, as the reminder contract uses: everything else is
// either a delimiter a route would read as structure or a character no slug
// producer emits.
const SLUG_PATTERN = /^[A-Za-z0-9._~-]+$/

// base64url, which is the only shape admin's generator emits (KTD14).
const NONCE_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Names the contract a payload belongs to. The reminder contract predates the
 * discriminator, so ANYTHING without it is a reminder and keeps routing
 * exactly as it did: a reminder pending from an older build still opens.
 */
export function notificationFamily(data: unknown): NotificationFamily {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "reminder"
  }
  return (data as Record<string, unknown>).family === PUSH_ANNOUNCEMENT_FAMILY
    ? "announcement"
    : "reminder"
}

function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== "string") return false
  if (slug.length === 0 || slug.length > PUSH_ANNOUNCEMENT_MAX_SLUG_LENGTH) {
    return false
  }
  if (slug === "." || slug === "..") return false
  return SLUG_PATTERN.test(slug)
}

function isValidNonce(nonce: unknown): nonce is string {
  if (typeof nonce !== "string") return false
  if (nonce.length === 0 || nonce.length > PUSH_ANNOUNCEMENT_MAX_NONCE_LENGTH) {
    return false
  }
  return NONCE_PATTERN.test(nonce)
}

type Envelope =
  | { ok: true; payload: Record<string, unknown> }
  | {
      ok: false
      reason: Extract<
        PushAnnouncementParseReason,
        "not_an_object" | "too_large" | "version_mismatch"
      >
    }

/** The gates every read shares: an object, inside the cap, of a known version. */
function readEnvelope(data: unknown): Envelope {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "not_an_object" }
  }

  // The size gate runs first, so a megabyte of junk never reaches a pattern.
  let serialized: string
  try {
    serialized = JSON.stringify(data) ?? ""
  } catch {
    return { ok: false, reason: "too_large" }
  }
  if (utf8ByteLength(serialized) > PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "too_large" }
  }

  const payload = data as Record<string, unknown>
  if (payload.version !== PUSH_ANNOUNCEMENT_PAYLOAD_VERSION) {
    return { ok: false, reason: "version_mismatch" }
  }
  return { ok: true, payload }
}

/**
 * The campaign identifier alone, for a payload whose DESTINATION this build
 * cannot read (R23). A tap on an unknown kind is still an open, so the report
 * must not under-count it; nothing is trusted out of a broken envelope.
 */
export function pushAnnouncementNonce(data: unknown): string | null {
  const envelope = readEnvelope(data)
  if (!envelope.ok) return null
  const nonce = envelope.payload.nonce
  return isValidNonce(nonce) ? nonce : null
}

/**
 * Validates one arriving announcement. It never throws and never returns a
 * field the payload carried beyond the validated destination and the nonce.
 */
export function parsePushAnnouncementPayload(
  data: unknown,
): PushAnnouncementParseResult {
  const envelope = readEnvelope(data)
  if (!envelope.ok) return envelope
  const payload = envelope.payload
  const kind = PUSH_ANNOUNCEMENT_KINDS.find(
    (candidate) => candidate === payload.kind,
  )
  if (kind == null) return { ok: false, reason: "unknown_kind" }
  if (!isValidSlug(payload.slug)) {
    return { ok: false, reason: "invalid_slug" }
  }
  if (!isValidNonce(payload.nonce)) {
    return { ok: false, reason: "invalid_nonce" }
  }
  return { ok: true, kind, slug: payload.slug, nonce: payload.nonce }
}
