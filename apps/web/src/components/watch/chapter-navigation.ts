export type WatchChapterNavigationIntent = {
  href: string
  languageSlug: string
  sourceVideoDocumentId: string
  targetVideoDocumentId: string
  title: string | null
  slug: string
  label: string | null
  posterUrl: string | null
  posterBlurDataUrl?: string | null
  sourceCarouselIndex?: number | null
}

export type WatchChapterOptimisticVisual = {
  title: string | null
  label: string | null
  posterUrl: string | null
  posterBlurDataUrl?: string | null
  loading?: boolean
  transitionKey?: string | null
}

export type WatchChapterCarouselPreserveState = {
  languageSlug: string
  sourceVideoDocumentId: string
  targetVideoDocumentId: string
  sourceCarouselIndex?: number | null
}

export const WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY =
  "forge.watch.chapterCarouselPreserve"

/**
 * Same-tab handoff for when tab storage is blocked or full. Chapter
 * navigation is a client-side push in one JS realm, so the target page's
 * carousel can still read it; a reload or new tab starts clean, which is
 * what sessionStorage would do for a new tab anyway.
 */
let memoryCarouselPreserveState: string | null = null

/**
 * Best-effort: the preserved index only keeps the rail from jumping, so a
 * blocked or full sessionStorage must never stop the chapter navigation that
 * follows this write.
 */
export function writeWatchChapterCarouselPreserveState(
  state: WatchChapterCarouselPreserveState,
): void {
  const raw = JSON.stringify(state)
  try {
    window.sessionStorage.setItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY, raw)
    memoryCarouselPreserveState = null
  } catch {
    memoryCarouselPreserveState = raw
  }
}

/**
 * Reads and clears the handoff. Runs inside a render-time state initializer,
 * so a SecurityError from a blocked `window.sessionStorage` getter would take
 * down the whole film page through the route error boundary.
 */
export function consumeWatchChapterCarouselPreserveState(): string | null {
  const memory = memoryCarouselPreserveState
  memoryCarouselPreserveState = null
  try {
    const raw = window.sessionStorage.getItem(
      WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
    )
    if (raw) {
      window.sessionStorage.removeItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)
      return raw
    }
  } catch {
    // Fall through to the in-memory handoff.
  }
  return memory
}
