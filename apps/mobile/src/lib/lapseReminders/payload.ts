/**
 * The reminder payload contract (KTD4). A tap reads this and nothing else: the
 * in-memory last-watched record may not have hydrated on a cold start. The
 * payload is therefore untrusted on the way back in, whatever wrote it.
 */

import {
  LAPSE_REMINDER_KINDS,
  LAPSE_REMINDER_PAYLOAD_VERSION,
  type LapseReminderKind,
} from "./constants"

/** The target that means "open the Home tab" (R13). */
export const LAPSE_REMINDER_HOME_TARGET = "home"

/** R13's slug bound, in characters. Real slugs are far shorter. */
export const LAPSE_REMINDER_MAX_SLUG_LENGTH = 200

/**
 * KTD4's size cap, in BYTES of the serialized payload, not characters. A
 * character cap would admit about three times this in a non-Latin script.
 */
export const LAPSE_REMINDER_MAX_PAYLOAD_BYTES = 1024

/** Every reason a tap can log. KTD9 facets on it, so the set stays fixed. */
export const LAPSE_REMINDER_PARSE_REASONS = [
  "not_an_object",
  "too_large",
  "version_mismatch",
  "unknown_kind",
  "malformed_target",
  "invalid_slug",
] as const

export type LapseReminderParseReason =
  (typeof LAPSE_REMINDER_PARSE_REASONS)[number]

export type LapseReminderPayload = {
  version: number
  kind: LapseReminderKind
  target: string
}

/** A validated tap. A null slug means Home; a string means the watch screen. */
export type LapseReminderParseResult =
  | { ok: true; kind: LapseReminderKind; slug: string | null }
  | { ok: false; reason: LapseReminderParseReason }

const WATCH_TARGET_PREFIX = "forgemobile://watch/"

// RFC 3986's unreserved set. Everything else is either a delimiter the route
// would read as structure or a character no slug producer emits.
const SLUG_PATTERN = /^[A-Za-z0-9._~-]+$/

/** UTF-8 length of a string, which is what the cap above counts. */
function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one four-byte character; skip its low half.
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/** True for a slug the watch route can carry and the parser will accept. */
function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > LAPSE_REMINDER_MAX_SLUG_LENGTH) {
    return false
  }
  if (slug === "." || slug === "..") return false
  return SLUG_PATTERN.test(slug)
}

/**
 * Builds the payload for one reminder. A record whose slug the parser would
 * reject falls back to Home, so every payload this writes parses back.
 */
export function buildLapseReminderPayload(
  kind: LapseReminderKind,
  record: { slug: string } | null,
): LapseReminderPayload {
  const slug = record?.slug ?? ""
  return {
    version: LAPSE_REMINDER_PAYLOAD_VERSION,
    kind,
    target: isValidSlug(slug)
      ? `${WATCH_TARGET_PREFIX}${encodeURIComponent(slug)}`
      : LAPSE_REMINDER_HOME_TARGET,
  }
}

/** The one watch segment in a target, or null for any other shape. */
function watchSegment(target: string): string | null {
  if (!target.startsWith(WATCH_TARGET_PREFIX)) return null
  const rest = target.slice(WATCH_TARGET_PREFIX.length)
  if (rest.length === 0) return null
  // KTD4: exactly one segment, with no query, fragment or trailing path.
  if (/[/?#]/.test(rest)) return null
  return rest
}

/**
 * Validates an arriving payload and returns the navigation target, or a reason
 * from the fixed set. It never throws and never returns the raw payload.
 */
export function parseLapseReminderPayload(
  data: unknown,
): LapseReminderParseResult {
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
  if (utf8ByteLength(serialized) > LAPSE_REMINDER_MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "too_large" }
  }

  const payload = data as Record<string, unknown>
  if (payload.version !== LAPSE_REMINDER_PAYLOAD_VERSION) {
    return { ok: false, reason: "version_mismatch" }
  }
  const kind = LAPSE_REMINDER_KINDS.find(
    (candidate) => candidate === payload.kind,
  )
  if (kind == null) return { ok: false, reason: "unknown_kind" }

  const target = payload.target
  if (typeof target !== "string") {
    return { ok: false, reason: "malformed_target" }
  }
  if (target === LAPSE_REMINDER_HOME_TARGET) {
    return { ok: true, kind, slug: null }
  }

  const segment = watchSegment(target)
  if (segment == null) return { ok: false, reason: "malformed_target" }

  let slug: string
  try {
    slug = decodeURIComponent(segment)
  } catch {
    return { ok: false, reason: "invalid_slug" }
  }
  if (!isValidSlug(slug)) return { ok: false, reason: "invalid_slug" }
  return { ok: true, kind, slug }
}
