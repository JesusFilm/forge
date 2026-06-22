import type { WatchSubtitle } from "./normalizeVideo"

/**
 * The subtitle track to use for the active dub, resolved by stable language
 * slug. Returns null when no slug is selected, or when the selected language
 * has no track in this dub's media — e.g. a cross-dub slug whose language this
 * dub lacks, or media that hasn't loaded yet. Keyed on `languageSlug` because
 * bcp47 tags are not unique (ko vs ko-kmr).
 */
export function resolveActiveSubtitle(
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
): WatchSubtitle | null {
  if (slug == null) return null
  return subtitles.find((s) => s.languageSlug === slug) ?? null
}

/**
 * The label shown under the Subtitles control. "Off" when subtitles are
 * disabled (regardless of the selected language); otherwise the active
 * subtitle's language name, or null while the dub's media is still loading
 * (the caller falls back to a static "Subtitles" label).
 */
export function deriveSubtitleLabel(
  enabled: boolean,
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
): string | null {
  if (!enabled) return "Off"
  return resolveActiveSubtitle(slug, subtitles)?.languageName ?? null
}

/**
 * The full label for the Subtitles control: "Off" when disabled, the active
 * subtitle's name when resolved, otherwise the persisted preferred name as a
 * cold-load fallback (painted while the dub's media is still loading, instead of
 * a static placeholder). Returns null only when enabled with no resolvable name
 * and no cached fallback — the caller then shows its own "Subtitles" default.
 */
export function resolveSubtitleActionLabel(
  enabled: boolean,
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
  fallbackName: string | null,
): string | null {
  return (
    deriveSubtitleLabel(enabled, slug, subtitles) ??
    (enabled ? fallbackName : null)
  )
}

/**
 * The subtitle display name that should be written to the persisted cache, or
 * null for a no-op. Returns the preferred slug's name (looked up in the loaded
 * media) only when it differs from what's already cached — so the caching
 * effect self-terminates and never overwrites with an absent/unchanged value.
 */
export function subtitleNameToCache(
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
  cached: string | null,
): string | null {
  const name = resolveActiveSubtitle(slug, subtitles)?.languageName
  return name != null && name !== cached ? name : null
}
