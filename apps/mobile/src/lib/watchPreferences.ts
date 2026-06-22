/**
 * App-wide watch preferences (dub/subtitle language + subtitles on/off),
 * persisted so choices carry across videos and restarts. Stored by unique
 * language SLUG, not bcp47 — bcp47 prefixes collide (Korean "ko" vs Kurmanji
 * "ko-kmr") and re-select the wrong sibling; {@link resolveDefaultSlug} matches
 * the slug exactly per video.
 */
export type WatchPreferences = {
  /** Preferred dub language slug, or null to use the resolution fallback. */
  audioLanguageSlug: string | null
  /** Preferred subtitle language slug, or null to use the fallback. */
  subtitleLanguageSlug: string | null
  /** Whether subtitles are turned on app-wide. */
  subtitlesEnabled: boolean
  /**
   * Restrict offline downloads to wifi (download module's network-type
   * constraint). A per-download cellular override is session state, not
   * persisted here. Defaults off.
   */
  wifiOnly: boolean
}

export const WATCH_PREFERENCES_STORAGE_KEY = "watchPreferences"

export const DEFAULT_WATCH_PREFERENCES: WatchPreferences = {
  audioLanguageSlug: null,
  subtitleLanguageSlug: null,
  subtitlesEnabled: false,
  wifiOnly: false,
}

function normalizeSlug(value: unknown): string | null {
  // Treat anything non-string or empty as "unset" so a corrupt/partial blob
  // degrades to the resolution fallback rather than poisoning matching.
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Parse a persisted preferences blob into a type-safe object. Tolerant: any
 * null/malformed/partial payload yields defaults so a bad write or schema change
 * never throws or wedges the watch screen. An older bcp47-keyed blob reads back
 * as defaults — the user re-picks once.
 */
export function parseStoredPreferences(raw: string | null): WatchPreferences {
  if (!raw) return { ...DEFAULT_WATCH_PREFERENCES }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_WATCH_PREFERENCES }
  }
  if (parsed == null || typeof parsed !== "object") {
    return { ...DEFAULT_WATCH_PREFERENCES }
  }
  const obj = parsed as Record<string, unknown>
  return {
    audioLanguageSlug: normalizeSlug(obj.audioLanguageSlug),
    subtitleLanguageSlug: normalizeSlug(obj.subtitleLanguageSlug),
    subtitlesEnabled: obj.subtitlesEnabled === true,
    wifiOnly: obj.wifiOnly === true,
  }
}

export function serializeWatchPreferences(prefs: WatchPreferences): string {
  return JSON.stringify(prefs)
}
