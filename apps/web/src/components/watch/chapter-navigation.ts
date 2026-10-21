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
 * what sessionStorage would do for a new tab anyway. Only the writer below
 * sets it, and a successful stored write clears it, so when it is set it is
 * always the latest handoff. Written only from a click handler, so the
 * server never holds one.
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
    return
  } catch {
    memoryCarouselPreserveState = raw
  }
  // A full store can still be readable. Drop any older stored handoff so it
  // cannot be read in place of this one.
  try {
    window.sessionStorage.removeItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)
  } catch {
    // Blocked storage holds nothing to drop.
  }
}

/**
 * Reads and clears the handoff, once. Runs inside a render-time state
 * initializer, so a SecurityError from a blocked `window.sessionStorage`
 * getter would take down the whole film page through the route error
 * boundary. The in-memory handoff wins because it is newer than anything
 * stored; the stored copy is still cleared so it is never read later.
 */
export function consumeWatchChapterCarouselPreserveState(): string | null {
  const memory = memoryCarouselPreserveState
  memoryCarouselPreserveState = null
  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)
  } catch {
    // Blocked storage: only the in-memory handoff can exist.
  }
  if (stored != null) {
    try {
      window.sessionStorage.removeItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)
    } catch {
      // Best-effort; the carousel still validates the target before use.
    }
  }
  return memory ?? (stored || null)
}
