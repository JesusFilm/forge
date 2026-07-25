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

// Cloudflare Images "flexible variant" fields (mobileCinematic*/thumbnail/
// videoStill) carry a /f=… transform and load; the bare `url` is the variant-
// less delivery base and 400s — so it ranks LAST, never above a real image.
const FIELD_ORDER: Record<CardImageIntent, readonly (keyof CardImageSource)[]> =
  {
    poster: ["mobileCinematicHigh", "mobileCinematicLow", "thumbnail", "url"],
    card: [
      "mobileCinematicHigh",
      "mobileCinematicLow",
      "videoStill",
      "thumbnail",
      "url",
    ],
  }

// Field-major, image-minor: for each field in priority order, scan ALL images and
// return the first hit. images[0] still wins when it carries the field, but a
// videoStill-first entry falls through to a sibling's cinematic art, not its url.
export function pickCardImage(
  images: readonly CardImageSource[] | null | undefined,
  intent: CardImageIntent,
): string | null {
  if (!images || images.length === 0) return null
  for (const field of FIELD_ORDER[intent]) {
    for (const image of images) {
      const candidate = image[field]
      if (candidate) return candidate
    }
  }
  return null
}
