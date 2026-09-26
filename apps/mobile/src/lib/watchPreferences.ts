/**
 * App-wide watch preferences (dub/subtitle language + subtitles on/off),
 * persisted across videos and restarts. Stored by unique language SLUG, not
 * bcp47 — prefixes collide ("ko" vs "ko-kmr"); {@link resolveDefaultSlug} matches exactly.
 */
export type WatchPreferences = {
  /** Preferred dub language slug, or null to use the resolution fallback. */
  audioLanguageSlug: string | null
  /**
   * ISO 639-3 code of `audioLanguageSlug`, exactly as admin sends it ("spa",
   * or a macrolanguage like "zho"). Null = unknown, and always null when the
   * slug is null. The Bible reader picks its default translation from it.
   */
  audioLanguageIso3: string | null
  /** Preferred subtitle language slug, or null to use the fallback. */
  subtitleLanguageSlug: string | null
  /**
   * Display name of the preferred subtitle language (e.g. "French"), cached so
   * the Subtitles pill paints on a cold load — subtitle names come from per-dub
   * media fetched lazily, so the slug alone can't be mapped without a fetch.
   */
  subtitleLanguageName: string | null
  /** Whether subtitles are turned on app-wide. */
  subtitlesEnabled: boolean
  /**
   * Restrict offline downloads to wifi (download module's network-type
   * constraint). A per-download cellular override is session state, not
   * persisted here. Defaults off.
   */
  wifiOnly: boolean
  /** Whether the Library "touch and hold to select" hint has been shown/used. */
  longPressHintSeen: boolean
}

export const WATCH_PREFERENCES_STORAGE_KEY = "watchPreferences"

export const DEFAULT_WATCH_PREFERENCES: WatchPreferences = {
  audioLanguageSlug: null,
  audioLanguageIso3: null,
  subtitleLanguageSlug: null,
  subtitleLanguageName: null,
  subtitlesEnabled: false,
  wifiOnly: false,
  longPressHintSeen: false,
}

/**
 * A blank or non-string code is unknown. A real code stays exactly as sent:
 * the Bible reader, not this module, maps macrolanguages to its catalog.
 */
export function normalizeLanguageIso3(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function normalizeNonEmptyString(value: unknown): string | null {
  // Shared by the language slugs and the cached subtitle display name: treat
  // anything non-string or empty as "unset" so a corrupt/partial blob degrades
  // to the resolution fallback rather than poisoning matching or the label.
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Parse a persisted preferences blob into a type-safe object. Tolerant: any
 * null/malformed/partial payload yields defaults so a bad write or schema change
 * never throws. An older bcp47-keyed blob reads back as defaults; user re-picks once.
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
  const audioLanguageSlug = normalizeNonEmptyString(obj.audioLanguageSlug)
  return {
    audioLanguageSlug,
    // A record from before the code existed reads as unknown.
    audioLanguageIso3:
      audioLanguageSlug == null
        ? null
        : normalizeLanguageIso3(obj.audioLanguageIso3),
    subtitleLanguageSlug: normalizeNonEmptyString(obj.subtitleLanguageSlug),
    subtitleLanguageName: normalizeNonEmptyString(obj.subtitleLanguageName),
    subtitlesEnabled: obj.subtitlesEnabled === true,
    wifiOnly: obj.wifiOnly === true,
    longPressHintSeen: obj.longPressHintSeen === true,
  }
}

export function serializeWatchPreferences(prefs: WatchPreferences): string {
  return JSON.stringify(prefs)
}

type AudioLanguage = Pick<
  WatchPreferences,
  "audioLanguageSlug" | "audioLanguageIso3"
>

/**
 * The write for an audio language pick. The code must describe the slug, so a
 * pick without a code keeps the stored code only for the same slug.
 */
export function audioLanguagePatch(
  current: AudioLanguage,
  slug: string | null,
  iso3: string | null,
): AudioLanguage {
  if (slug == null) return { audioLanguageSlug: null, audioLanguageIso3: null }
  const kept =
    slug === current.audioLanguageSlug ? current.audioLanguageIso3 : null
  return {
    audioLanguageSlug: slug,
    audioLanguageIso3: normalizeLanguageIso3(iso3) ?? kept,
  }
}

/**
 * Fills a missing code for a slug stored before the code existed. Returns null
 * when the stored slug has changed or a code is already stored.
 */
export function audioIso3BackfillPatch(
  current: AudioLanguage,
  slug: string,
  iso3: string | null,
): Pick<WatchPreferences, "audioLanguageIso3"> | null {
  if (current.audioLanguageSlug !== slug) return null
  if (current.audioLanguageIso3 != null) return null
  const code = normalizeLanguageIso3(iso3)
  return code == null ? null : { audioLanguageIso3: code }
}

/** The code of the first dub in the `slug` language that carries one. */
export function languageIso3ForSlug(
  dubs: readonly {
    languageSlug: string | null
    languageIso3: string | null
  }[],
  slug: string,
): string | null {
  for (const dub of dubs) {
    if (dub.languageSlug !== slug) continue
    const code = normalizeLanguageIso3(dub.languageIso3)
    if (code != null) return code
  }
  return null
}
