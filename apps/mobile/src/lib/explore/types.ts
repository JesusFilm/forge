/**
 * Clip, window, and candidate types for the Explore feed. Pure types, lean and
 * serializable: the pool and the next ready clip are stored on the device
 * (KTD6), and the feed keeps its history in memory (KTD25).
 */

/** A clip's slice of the full asset, in seconds (KTD4). */
export type ClipWindow = {
  startSeconds: number
  endSeconds: number
}

/** How the clip engine cut the window: at sentence boundaries, or by R23. */
export type ClipCut = "sentence" | "fallback"

/** R21's tiers, in their order. */
export type ClipTier = "sentenceDubbed" | "fallbackDubbed" | "subtitleOnly"

/** The inventory's availability enum, in its wire spelling. */
export type CandidateAvailability = "AUDIO" | "SUBTITLE_ONLY"

/** One row of the lean inventory projection (KTD6). */
export type ClipCandidate = {
  /** Admin video id. */
  videoId: string
  coreId: string
  slug: string
  /** VideoLabel in the inventory's camelCase wire spelling ("featureFilm"). */
  label: string | null
  availability: CandidateAvailability
  durationSeconds: number | null
  muxPlaybackId: string | null
  /** The audio language to play. A subtitle-only row names its fallback. */
  watchLanguageSlug: string
  title: string
  description: string | null
  /** The authored image for the veil poster. */
  imageUrl: string | null
}

/**
 * A queued clip that can play now. `muxPlaybackId` names the stream that
 * plays, which can differ from the inventory row's best dub.
 */
export type ReadyClip = ClipCandidate & {
  /** The language of `title`: the UI's, `en` for a fallback, or null when the
   *  inventory's own text stayed (R10). Absent on a clip stored before U7. */
  titleLang?: string | null
  descriptionLang?: string | null
  /** The `$textSlug` the text was read with. A stored clip read under another
   *  one is in another language (R4). */
  textSlug?: string | null
  feedLanguageSlug: string
  streamUrl: string
  audioLanguageSlug: string
  /** Null when the clip has no subtitle track in the feed language. */
  subtitleLanguageSlug: string | null
  subtitleVttSrc: string | null
  subtitleOnly: boolean
  window: ClipWindow
  cut: ClipCut
}

/**
 * What the feed keeps for each clip, current and history alike: only what a
 * replay needs, so a swipe back makes no request (KTD25).
 */
export type FeedClip = Pick<
  ReadyClip,
  | "videoId"
  | "coreId"
  | "slug"
  | "title"
  | "titleLang"
  | "description"
  | "descriptionLang"
  | "imageUrl"
  | "muxPlaybackId"
  | "streamUrl"
  | "feedLanguageSlug"
  | "audioLanguageSlug"
  | "subtitleLanguageSlug"
  | "subtitleVttSrc"
  | "subtitleOnly"
  | "window"
  | "cut"
>
