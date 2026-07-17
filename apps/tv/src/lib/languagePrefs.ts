import { getStorage } from "./safeStorage"

/** Versioned storage key so a future schema change (per-profile prefs, locale
 *  rotation) is a migration, not a breaking read. */
export const LANGUAGE_PREFS_STORAGE_KEY = "tv.languagePrefs.v1"

/**
 * One chosen language. Identity is the language-entity slug (never bcp47 —
 * ko/ko-kmr collide); `name` is display-only so the Settings rows can show the
 * stored value without a network round trip.
 */
export type LanguagePref = {
  slug: string
  name: string | null
}

export type LanguagePrefs = {
  /** Default audio/dub language; null = automatic (device → primary → English). */
  audio: LanguagePref | null
  /** Default subtitle language; null = subtitles stay off unless enabled per video. */
  subtitle: LanguagePref | null
}

export const DEFAULT_LANGUAGE_PREFS: LanguagePrefs = {
  audio: null,
  subtitle: null,
} as const

/**
 * Explicit local writes awaiting hydration. Absent key = "the user hasn't
 * chosen", which a bare null can't express — see mergeLanguagePrefs.
 */
export type PendingLanguagePrefs = Partial<LanguagePrefs>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** One stored pref → LanguagePref, null on any unusable shape. */
function parsePref(value: unknown): LanguagePref | null {
  if (!isRecord(value)) return null
  if (typeof value.slug !== "string" || value.slug === "") return null
  return {
    slug: value.slug,
    name:
      typeof value.name === "string" && value.name !== "" ? value.name : null,
  }
}

/**
 * Stored JSON → prefs, defaulting each field on anything unreadable (absent,
 * corrupt, wrong shape). Never throws; unknown fields from a newer writer drop.
 */
export function parseStoredLanguagePrefs(raw: string | null): LanguagePrefs {
  if (raw == null) return { ...DEFAULT_LANGUAGE_PREFS }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...DEFAULT_LANGUAGE_PREFS }
    return {
      audio: parsePref(parsed.audio),
      subtitle: parsePref(parsed.subtitle),
    }
  } catch {
    return { ...DEFAULT_LANGUAGE_PREFS }
  }
}

/**
 * Resolve hydration against writes that raced ahead of it: local intent is
 * newer, so it wins — but only where the user actually chose, hence pending
 * keys rather than a value comparison (null is both the default and a choice).
 */
export function mergeLanguagePrefs(
  onDisk: LanguagePrefs,
  pending: PendingLanguagePrefs,
): LanguagePrefs {
  return { ...onDisk, ...pending }
}

/** Read-only by construction; defaults on any read or parse failure. */
export async function loadLanguagePrefs(): Promise<LanguagePrefs> {
  try {
    const raw = await getStorage().getItem(LANGUAGE_PREFS_STORAGE_KEY)
    return parseStoredLanguagePrefs(raw)
  } catch {
    return { ...DEFAULT_LANGUAGE_PREFS }
  }
}

export async function saveLanguagePrefs(prefs: LanguagePrefs): Promise<void> {
  try {
    await getStorage().setItem(
      LANGUAGE_PREFS_STORAGE_KEY,
      JSON.stringify(prefs),
    )
  } catch {
    // Best-effort: in-memory state already reflects the choice, so a failed
    // write only costs the next launch its newest value. Not worth a UI error.
  }
}
