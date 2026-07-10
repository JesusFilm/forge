import type { WatchHomeVideoSlide } from "./carouselSequence"

/**
 * Builds the watch-seed route args for the overlay "Watch Now" button, keeping
 * slide-shape knowledge (poster fallback chain, series-label input) out of the
 * screen.
 */
export function slideRouteArgs(slide: WatchHomeVideoSlide): {
  slug: string | null
  title: string
  label: string
  imageUrl: string | null
  playbackId: string | null
} {
  return {
    slug: slide.slug,
    title: slide.title,
    label: slide.label,
    imageUrl: slide.posterUrl ?? slide.thumbnailUrl,
    playbackId: slide.playbackId,
  }
}
