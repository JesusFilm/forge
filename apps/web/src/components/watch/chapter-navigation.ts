export type WatchChapterNavigationIntent = {
  href: string
  languageSlug: string
  sourceVideoDocumentId: string
  targetVideoDocumentId: string
  title: string | null
  slug: string
  label: string | null
  posterUrl: string | null
}

export type WatchChapterOptimisticVisual = {
  title: string | null
  label: string | null
  posterUrl: string | null
  loading?: boolean
  transitionKey?: string | null
}
