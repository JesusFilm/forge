/**
 * Pure hero-stream selection (KTD-2 lazy half): given a per-video query's
 * dub/variant list, pick the HLS URL the home hero should play. Extracted
 * from useHeroStream so jest covers the selection order without React.
 *
 * Pure TypeScript only — no React/React Native imports.
 */

import { validateStreamingUrl } from "../validateUrl"

/** KTD-7: language identity keys on languageSlug, never bcp47. */
const ENGLISH_LANGUAGE_SLUG = "english"

/**
 * Structural slice of GET_VIDEO_BY_SLUG's `variants: dubs` entries —
 * the fields selection order needs, nothing more.
 */
export type HeroStreamVariantInput = {
  published?: boolean | null
  hls?: string | null
  language?: { slug?: string | null } | null
}

/**
 * Selection order (plan U3): the English variant wins, otherwise the first
 * published variant with a playable hls, otherwise null (the slide-skip
 * path). Every candidate is gated through validateStreamingUrl BEFORE
 * selection, so an English variant carrying a non-Mux URL falls through to
 * the next playable variant instead of dead-ending the slide.
 */
export function selectHeroStreamUrl(
  variants: readonly HeroStreamVariantInput[] | null | undefined,
): string | null {
  if (!variants || variants.length === 0) return null

  const playable = variants.filter(
    (variant): variant is HeroStreamVariantInput & { hls: string } =>
      variant.published === true &&
      typeof variant.hls === "string" &&
      validateStreamingUrl(variant.hls),
  )

  const english = playable.find(
    (variant) => variant.language?.slug === ENGLISH_LANGUAGE_SLUG,
  )
  return english?.hls ?? playable[0]?.hls ?? null
}
