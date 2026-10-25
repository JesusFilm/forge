import type { WatchHomeVideoSlide } from "./carouselSequence"

/**
 * Builds the watch-seed route args for the overlay "Watch Now" button, keeping
 * slide-shape knowledge (poster fallback chain, series-label input) out of the
 * screen. `rawLabel` is the routing input: `label` is catalog text (KTD15).
 */
export function slideRouteArgs(slide: WatchHomeVideoSlide): {
  slug: string | null
  title: string
  label: string
  rawLabel: string | null
  imageUrl: string | null
  playbackId: string | null
} {
  return {
    slug: slide.slug,
    title: slide.title,
    label: slide.label,
    rawLabel: slide.rawLabel ?? null,
    imageUrl: slide.posterUrl ?? slide.thumbnailUrl,
    playbackId: slide.playbackId,
  }
}
