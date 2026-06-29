export type WatchChapterNavigationIntent = {
  href: string
  languageSlug: string
  sourceVideoDocumentId: string
  targetVideoDocumentId: string
  title: string | null
  slug: string
  label: string | null
  posterUrl: string | null
  sourceCarouselIndex?: number | null
}

export type WatchChapterOptimisticVisual = {
  title: string | null
  label: string | null
  posterUrl: string | null
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
