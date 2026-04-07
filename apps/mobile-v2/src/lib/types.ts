/** Shared shape for a video reference resolved from CMS data. */
export type VideoRef = {
  documentId?: string
  title?: string
  slug?: string
  imageAlt?: string
  images?: {
    url?: string
    mobileCinematicHigh?: string
    videoStill?: string
  }
}
