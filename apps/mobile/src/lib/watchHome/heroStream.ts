/**
 * Pure hero-stream selection (KTD-2 lazy half): pick the HLS URL the home hero
 * should play from a video's dub/variant list. Extracted from useHeroStream so
 * jest covers selection order without React — pure TS, no RN imports.
 */

import { validateStreamingUrl } from "../validateUrl"
import { ENGLISH_LANGUAGE_SLUG } from "./config"

/** Structural slice of GET_VIDEO_BY_SLUG's `variants: dubs` entries — just the fields selection needs. */
export type HeroStreamVariantInput = {
  published?: boolean | null
  hls?: string | null
  language?: { slug?: string | null } | null
}

/**
 * Selection order (plan U3): English variant wins, else first published variant
 * with playable hls, else null (slide-skip). Every candidate is gated through
 * validateStreamingUrl FIRST so a non-Mux English URL falls through, not dead-ends.
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
