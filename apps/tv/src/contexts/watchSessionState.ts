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
 * Resolve the default audio-dub index, slug-keyed via resolveDefaultSlug
 * (persisted → device → primary → English → first). TV passes null for persisted
 * (no v1 store). Returns 0 when nothing resolves so a video always opens on a dub.
 */
export function resolveDefaultVariantIndex(
  video: WatchVideoRecord,
  preferredAudioSlug: string | null,
): number {
  if (video.variants.length === 0) return 0
  const options = video.variants.map((v) => ({
    slug: v.slug,
    bcp47: v.languageBcp47,
    languageSlug: v.languageSlug,
  }))
  const best = resolveDefaultSlug(
    options,
    video.primaryLanguageBcp47,
    preferredAudioSlug,
  )
  const idx = best ? video.variants.findIndex((v) => v.slug === best) : -1
  return idx >= 0 ? idx : 0
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
