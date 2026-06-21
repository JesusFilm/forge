/**
 * App-wide watch preferences: the dub language, subtitle language, and
 * subtitles on/off the user last chose. Persisted (via AsyncStorage in
 * {@link WatchPreferencesProvider}) so a choice carries across videos and app
 * restarts instead of resetting to the device-locale default on every entry.
 *
 * Languages are stored by their unique language-entity SLUG (e.g. "korean",
 * "english-north-american-indigenous") — not bcp47 and not the per-video variant
 * slug. bcp47 prefixes collide across distinct languages (Korean "ko" vs Kurmanji
 * "ko-kmr"), so matching a persisted bcp47 by prefix re-selects the wrong sibling;
 * the language slug is unique and stable across videos. Resolution back to a
 * concrete variant/subtitle is done per video by {@link resolveDefaultSlug}
 * matching the slug exactly.
 */
export type WatchPreferences = {
  /** Preferred dub language slug, or null to use the resolution fallback. */
  audioLanguageSlug: string | null
  /** Preferred subtitle language slug, or null to use the fallback. */
  subtitleLanguageSlug: string | null
  /** Whether subtitles are turned on app-wide. */
  subtitlesEnabled: boolean
  /**
   * Restrict offline downloads to wifi. Drives the download module's
   * network-type constraint; a per-download cellular override is session state,
   * not persisted here. Defaults off.
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
 * Parse a persisted preferences blob into a fully-populated, type-safe object.
 * Tolerant by design: a null/missing/malformed/partial payload yields defaults
 * (filling only the fields present), so a bad write or a schema change can never
 * throw on read or wedge the watch screen. An older blob using the previous
 * bcp47 field names simply reads back as defaults — the user re-picks once.
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
