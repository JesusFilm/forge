import type { WatchSubtitle } from "./normalizeVideo"
import { resolveDefaultSlug } from "./resolveDefaultLanguage"

/**
 * The subtitles-off state. A symbol, not the word "Off", so no logic can read
 * display text and no caller can show it untranslated: only the render turns
 * it into catalog text, through {@link subtitleLabelText} (KTD15).
 */
export const SUBTITLES_OFF: unique symbol = Symbol("subtitles-off")

/** A subtitle name, the off state, or null while nothing is known yet. */
export type SubtitleActionLabel = string | typeof SUBTITLES_OFF | null

/** The text to show for a label; the render passes the catalog's "Off". */
export function subtitleLabelText(
  label: SubtitleActionLabel,
  offText: string,
): string | null {
  return label === SUBTITLES_OFF ? offText : label
}

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
 * Subtitles-control label: the off state when disabled, else the active
 * subtitle's language name, or null while the dub's media is still loading
 * (the caller then shows a static "Subtitles" label).
 */
export function deriveSubtitleLabel(
  enabled: boolean,
  slug: string | null | undefined,
  subtitles: WatchSubtitle[],
): SubtitleActionLabel {
  if (!enabled) return SUBTITLES_OFF
  return resolveActiveSubtitle(slug, subtitles)?.languageName ?? null
}

/**
 * Full Subtitles-control label. `subtitles` distinguishes not-loaded from
 * loaded-empty: pass `null` while the dub media is still in flight (paint the
 * cached preferred name, vs a placeholder), and `[]` once it's loaded with no
 * tracks. A loaded-empty dub → the off state (the content has no subtitles),
 * never a stale preferred name carried over from another video/series. Otherwise
 * the active track's name, else the cached fallback, else null (caller's
 * "Subtitles").
 */
export function resolveSubtitleActionLabel(
  enabled: boolean,
  slug: string | null | undefined,
  subtitles: WatchSubtitle[] | null,
  fallbackName: string | null,
): SubtitleActionLabel {
  if (!enabled) return SUBTITLES_OFF
  if (subtitles == null) return fallbackName
  if (subtitles.length === 0) return SUBTITLES_OFF
  return deriveSubtitleLabel(enabled, slug, subtitles) ?? fallbackName
}

/**
 * The subtitle a series should treat as active: the persisted preference resolved
 * against what the series actually offers (the episode subtitle union), via the
 * same {@link resolveDefaultSlug} fallback the video page uses (preferred → device
 * locale → primary → English → first). So a preference the series doesn't carry
 * (e.g. a Cantonese pick on an English/Japanese series) falls back to a supported
 * track instead of being shown verbatim. Null when off or the series has none.
 */
export function reconcileSeriesSubtitleSlug(
  enabled: boolean,
  preferredSlug: string | null | undefined,
  union: WatchSubtitle[],
  primaryBcp47: string | null,
): string | null {
  if (!enabled || union.length === 0) return null
  const options = union.map((s) => ({
    slug: s.languageSlug,
    bcp47: s.languageBcp47,
    languageSlug: s.languageSlug,
  }))
  return resolveDefaultSlug(options, primaryBcp47, preferredSlug)
}

/**
 * The series Subtitles-pill label, applying the video page's fallback logic. While
 * the union is unresolved (`null`), paint the cached preferred name optimistically
 * (matches the video page before its dub media lands). Once the union is known,
 * resolve against it — never falling back to the cached name, which may name a
 * track the series doesn't carry; an unresolved enabled pref → null → the caller's
 * static "Subtitles".
 */
export function resolveSeriesSubtitleLabel(
  enabled: boolean,
  preferredSlug: string | null,
  preferredName: string | null,
  union: WatchSubtitle[] | null,
  primaryBcp47: string | null,
): SubtitleActionLabel {
  if (union == null) {
    // Not resolved yet → optimistic cached-name paint (null = "media not loaded").
    return resolveSubtitleActionLabel(
      enabled,
      preferredSlug,
      null,
      preferredName,
    )
  }
  // Resolved → reconcile against what the series offers; an empty union yields
  // the off state (the series has no subtitles), never a stale unsupported name.
  const slug = reconcileSeriesSubtitleSlug(
    enabled,
    preferredSlug,
    union,
    primaryBcp47,
  )
  return resolveSubtitleActionLabel(enabled, slug, union, preferredName)
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
