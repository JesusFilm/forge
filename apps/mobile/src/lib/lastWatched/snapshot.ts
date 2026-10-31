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

/**
 * Bounded here rather than trusted at the display site: the title renders in
 * a notification body on the lock screen, and it is NOT always CMS-authored
 * (a deep-link seed can supply it). Counted in CODE POINTS, not code units.
 */
export const LAST_WATCHED_MAX_TITLE_LENGTH = 100

export type LastWatchedRecord = {
  videoSlug: string
  /** Null for a record written before titles, or one whose title failed the
   *  sanitizer — the reminder copy then falls back to its untitled form. */
  videoTitle: string | null
  /** The UI catalog tag the title was written under (KTD16). Only a titled
   *  record has one; a record written before the field reads as English. */
  titleLocale?: string
  recordedAt: number
}

// A catalog tag such as `es`, `zh-Hans`, or `es-419`. Optional on read, so
// LAST_WATCHED_VERSION did not move when this field was added.
const TITLE_LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/

function isTitleLocale(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 35 &&
    TITLE_LOCALE_PATTERN.test(value)
  )
}

/** The title and its language, or no title when the language is unusable. */
function titleFields(
  title: string | null,
  locale: unknown,
): Pick<LastWatchedRecord, "videoTitle" | "titleLocale"> {
  if (title == null || locale === undefined) return { videoTitle: title }
  if (!isTitleLocale(locale)) return { videoTitle: null }
  return { videoTitle: title, titleLocale: locale }
}

function isStorableSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LAST_WATCHED_MAX_SLUG_LENGTH
  )
}

/**
 * C0, DEL, C1, the Unicode line and paragraph separators, and the bidi and
 * zero-width format characters. A bidi override on a lock screen reverses
 * the app's own sentence around the title, so stripping is not cosmetic.
 */
const TITLE_INVISIBLE_OR_REORDERING =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1F\x7F-\x9F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]+/g

/**
 * Null for anything that must not reach a notification body. Characters
 * that can hide or reorder text are stripped rather than rejected, so an
 * otherwise good title is not lost to one stray character.
 */
export function sanitizeLastWatchedTitle(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value
    .replace(TITLE_INVISIBLE_OR_REORDERING, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length === 0) return null
  // Sliced by CODE POINT: a UTF-16 slice can cut a surrogate pair, and the
  // lone surrogate left behind is not representable in UTF-8 on the bridge.
  return Array.from(cleaned).slice(0, LAST_WATCHED_MAX_TITLE_LENGTH).join("")
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
      videoTitle?: unknown
      titleLocale?: unknown
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
    // A missing or unusable title never voids the record: the slug is what the
    // tap needs, and the copy has an untitled form.
    return {
      videoSlug: data.videoSlug,
      ...titleFields(
        sanitizeLastWatchedTitle(data.videoTitle),
        data.titleLocale,
      ),
      recordedAt: data.recordedAt,
    }
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
    ...titleFields(
      sanitizeLastWatchedTitle(record.videoTitle),
      record.titleLocale,
    ),
    recordedAt: record.recordedAt,
  })
}
