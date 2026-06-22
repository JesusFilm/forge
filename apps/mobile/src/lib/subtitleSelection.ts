import type { WatchSubtitle } from "./normalizeVideo"

/**
 * The active dub's subtitle track for `slug`, keyed on stable `languageSlug`
 * (bcp47 is not unique). Returns null when no slug is set or the dub lacks that
 * track (cross-dub slug, or media not loaded yet).
 */
export function resolveActiveSubtitle(
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
): WatchSubtitle | null {
  if (slug == null) return null
  return subtitles.find((s) => s.languageSlug === slug) ?? null
}

/**
 * Subtitles-control label: "Off" when disabled, else the active subtitle's
 * language name, or null while the dub's media is still loading (the caller
 * then shows a static "Subtitles" label).
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
 * Full Subtitles-control label: the resolved name, else the persisted preferred
 * name as a cold-load fallback (painted while media loads, vs a placeholder),
 * else null (enabled but nothing to show → caller's "Subtitles" default).
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
 * The display name to write to the persisted cache, or null for a no-op: the
 * preferred slug's name from the loaded media, only when it differs from what's
 * cached — so the caching effect self-terminates.
 */
export function subtitleNameToCache(
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
  cached: string | null,
): string | null {
  const name = resolveActiveSubtitle(slug, subtitles)?.languageName
  return name != null && name !== cached ? name : null
}
