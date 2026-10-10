/** Platforms the discovery workflows can surface content from. */
export type Platform = "instagram" | "youtube" | "pinterest"

/**
 * A platform-agnostic discovered video, ready to submit to the website review
 * queue. The website dedups by `(platform, externalId)`, so `externalId` must be
 * the platform's stable id (YouTube videoId, Instagram shortcode, …).
 */
export type DiscoveredVideo = {
  platform: Platform
  externalId: string
  url: string
  caption: string
  authorHandle: string | null
  authorName: string | null
  /** Link to the author's page on the platform (clickable attribution). */
  authorUrl: string | null
  thumbnailUrl: string | null
  matchedAi: string[]
  matchedChristian: string[]
}
