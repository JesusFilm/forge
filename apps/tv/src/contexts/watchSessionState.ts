// Pure, React-free state logic for WatchSessionProvider, extracted so transitions
// are unit-testable directly: TV has no @testing-library/react-native and jest
// can't load the provider's JSX graph, so the provider is a thin shell over this.

import { type VariantMedia, type WatchVideoRecord } from "../lib/normalizeVideo"
import { resolveDefaultSlug } from "../lib/resolveDefaultLanguage"

/**
 * Clamp an active variant index into the variant list; returns -1 when empty.
 * A stale index from the previous video can briefly exceed the new list before
 * the default-resolution effect re-runs, which would yield a one-frame undefined.
 */
export function clampVariantIndex(index: number, variantCount: number): number {
  if (variantCount <= 0) return -1
  if (index < 0) return 0
  return Math.min(index, variantCount - 1)
}

/**
 * The active variant for a video + (unclamped) index, or null when absent/empty.
 * Mirrors the clamp above so the exposed `activeVariant` never points past the list.
 */
export function selectActiveVariant(
  video: WatchVideoRecord | null,
  activeVariantIndex: number,
): WatchVideoRecord["variants"][number] | null {
  if (!video || video.variants.length === 0) return null
  const idx = clampVariantIndex(activeVariantIndex, video.variants.length)
  return video.variants[idx] ?? null
}

/**
 * The first of an ordered preference chain that EXACTLY matches a variant's
 * languageSlug, or null when none does. Exact-equality only (bcp47 prefixes
 * collide: ko vs ko-kmr); an unavailable preference is skipped so the next rung
 * gets a chance — this is what makes the chain's fall-through soft.
 */
function firstMatchingSlug(
  options: readonly { languageSlug: string | null }[],
  preferredSlugs: readonly (string | null)[],
): string | null {
  for (const slug of preferredSlugs) {
    if (slug && options.some((o) => o.languageSlug === slug)) return slug
  }
  return null
}

/**
 * Resolve the default audio-dub index. `preferredSlugs` is the ordered preference
 * chain (carried series slug → persisted app-wide slug); the first that exactly
 * matches a variant wins and is handed to resolveDefaultSlug, which then falls
 * through device → primary → English → first. A preferred slug absent from this
 * video is skipped (soft), so an unavailable preference never wedges the default.
 * Returns 0 when nothing resolves so a video always opens on a dub.
 */
export function resolveDefaultVariantIndex(
  video: WatchVideoRecord,
  preferredSlugs: readonly (string | null)[],
): number {
  if (video.variants.length === 0) return 0
  const options = video.variants.map((v) => ({
    slug: v.slug,
    bcp47: v.languageBcp47,
    languageSlug: v.languageSlug,
  }))
  const preferredAudioSlug = firstMatchingSlug(options, preferredSlugs)
  const best = resolveDefaultSlug(
    options,
    video.primaryLanguageBcp47,
    preferredAudioSlug,
  )
  const idx = best ? video.variants.findIndex((v) => v.slug === best) : -1
  return idx >= 0 ? idx : 0
}

/**
 * The language slug an explicit dub pick should persist app-wide, or null when
 * the pick carries no slug (out-of-range index, or a variant with none) — null
 * means "no write", leaving the store as-is. Keyed on the unique languageSlug.
 */
export function slugToPersistForPick(
  video: WatchVideoRecord | null,
  index: number,
): string | null {
  return video?.variants[index]?.languageSlug ?? null
}

/**
 * Resolve the default subtitle slug for the active dub's subtitles, or null when
 * none. Slug-keyed (subtitle slug IS the unique language slug); TV passes null
 * for the persisted preference.
 */
export function resolveDefaultSubtitleSlug(
  subtitles: VariantMedia["subtitles"] | null | undefined,
  videoPrimaryBcp47: string | null,
  preferredSubtitleSlug: string | null,
): string | null {
  if (!subtitles || subtitles.length === 0) return null
  const options = subtitles.map((s) => ({
    slug: s.languageSlug,
    bcp47: s.languageBcp47,
    languageSlug: s.languageSlug,
  }))
  return resolveDefaultSlug(options, videoPrimaryBcp47, preferredSubtitleSlug)
}

export type DubMediaState = {
  /** Loaded media, or null = not yet loaded (distinct from loaded-empty). */
  media: VariantMedia | null
  loading: boolean
  error: boolean
}

/**
 * Derive the active dub's media state from the per-id maps and active dub id.
 * Loaded-empty (`{ downloads: [], subtitles: [] }` in mediaById) is distinct from
 * null (not-loaded), which is the absence of an entry.
 */
export function selectDubMediaState(
  activeVariantId: string | null,
  mediaById: Record<string, VariantMedia>,
  loadingIds: Record<string, true>,
  errorIds: Record<string, true>,
): DubMediaState {
  if (!activeVariantId) return { media: null, loading: false, error: false }
  return {
    media: mediaById[activeVariantId] ?? null,
    loading: loadingIds[activeVariantId] ?? false,
    error: errorIds[activeVariantId] ?? false,
  }
}
