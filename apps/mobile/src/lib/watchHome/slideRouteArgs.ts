import type { WatchHomeVideoSlide } from "./carouselSequence"

/**
 * What HomeScreen's overlay "Watch Now" button needs to build the watch-seed
 * route for a video slide. Keeps slide-shape knowledge (poster fallback
 * chain, series-label routing input) in one place instead of leaking it into
 * the screen.
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
