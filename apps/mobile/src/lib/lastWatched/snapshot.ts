/**
 * Versioned AsyncStorage persistence for the last-watched record (KTD5),
 * following the watchProgress/snapshot pattern: version gate, shape check,
 * maximum age, degrade-to-null. Pure parse/serialize — the store owns I/O.
 *
 * This record is for EVERY user, signed in or not, so it owns its own key.
 * The watch-progress snapshot is account-tagged and empties on sign-out.
 */

export const LAST_WATCHED_STORAGE_KEY = "last-watched-video"

/** Bump when the persisted shape changes — old records then fail the gate. */
export const LAST_WATCHED_VERSION = 1

/** R19: a record older than 30 days counts as absent. */
export const LAST_WATCHED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The slug reaches this record from a route parameter, which a deep link
 * controls, and it rides on into a notification payload. Bound it here.
 */
export const LAST_WATCHED_MAX_SLUG_LENGTH = 200

export type LastWatchedRecord = {
  videoSlug: string
  recordedAt: number
}

function isStorableSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LAST_WATCHED_MAX_SLUG_LENGTH
  )
}

/**
 * Parse the persisted record. Null for anything unexpected (unwritten, bad
 * JSON, version drift, bad shape, expiry) so the reminders fall back to Home
 * (R13) instead of opening a video the record cannot vouch for.
 */
export function parseStoredLastWatched(
  raw: string | null,
  now: Date,
): LastWatchedRecord | null {
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as {
      version?: unknown
      videoSlug?: unknown
      recordedAt?: unknown
    } | null
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return null
    }
    if (data.version !== LAST_WATCHED_VERSION) return null
    if (!isStorableSlug(data.videoSlug)) return null
    if (
      typeof data.recordedAt !== "number" ||
      !Number.isFinite(data.recordedAt)
    )
      return null
    if (now.getTime() - data.recordedAt > LAST_WATCHED_MAX_AGE_MS) return null
    return { videoSlug: data.videoSlug, recordedAt: data.recordedAt }
  } catch {
    return null
  }
}

/**
 * Serialize for persistence. Null for a record the parser would reject, so a
 * write that could never be read back never reaches storage.
 */
export function serializeLastWatched(record: LastWatchedRecord): string | null {
  if (!isStorableSlug(record.videoSlug)) return null
  if (!Number.isFinite(record.recordedAt)) return null
  return JSON.stringify({
    version: LAST_WATCHED_VERSION,
    videoSlug: record.videoSlug,
    recordedAt: record.recordedAt,
  })
}
