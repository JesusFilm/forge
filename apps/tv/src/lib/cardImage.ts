// The one owner of "which image field wins" for card/poster art. Each surface
// picks a named intent; the precedence and scan semantics live here, not in
// per-file pickers (the review found three divergent copies).

export type CardImageSource = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
  videoStill?: string | null
}

export type CardImageIntent = "poster" | "card"

/**
 * Pick the best image URL for an intent.
 *
 * - "poster" (watch/series art): FIRST image only — high → url → thumbnail.
 *   Additional images are alternates, not fallbacks, on these records.
 * - "card" (home rail art): scan ALL images, full cinematic precedence per
 *   image — high → low → videoStill → url → thumbnail.
 */
export function pickCardImage(
  images: readonly CardImageSource[] | null | undefined,
  intent: CardImageIntent,
): string | null {
  if (!images || images.length === 0) return null

  if (intent === "poster") {
    const img = images[0]
    return img.mobileCinematicHigh ?? img.url ?? img.thumbnail ?? null
  }

  for (const image of images) {
    const candidate =
      image.mobileCinematicHigh ??
      image.mobileCinematicLow ??
      image.videoStill ??
      image.url ??
      image.thumbnail
    if (candidate) return candidate
  }
  return null
}
