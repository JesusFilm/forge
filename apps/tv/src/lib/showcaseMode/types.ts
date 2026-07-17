/**
 * Chapter/excerpt models for Showcase Mode (KTD-7 naming: `showcaseMode`, never bare
 * "showcase" — `src/components/home/showcaseState.ts` is Home's focus hero). Pure
 * types; the curated and fallback reel paths both land on ShowcaseQueue (KTD-4).
 */

/** One catalog video selected into the reel, hydrated to display fields. */
export type ShowcaseExcerpt = {
  /** Stable across a rebuild of the same queue: `${chapterId}:${coreId}`. */
  id: string
  coreId: string
  /** Required — the per-video stream query (showcaseVideoQuery.ts) keys on slug. */
  slug: string
  title: string
  /** "poster" intent: the reel is full-bleed, unlike Home's "card" rails. */
  posterUrl: string | null
  /** Wire enum ("SHORT_FILM"), never display text — see WatchHomeCard.rawLabel. */
  rawLabel: string | null
}

/**
 * A felt-need chapter (curated) or the single unlabeled reel (fallback). Language
 * rotation resets per chapter, so chapter boundaries are R7's rotation scope.
 */
export type ShowcaseChapter = {
  id: string
  /** Felt-need name; "" on the fallback path, which renders no chapter card. */
  title: string
  subtitle: string | null
  excerpts: ShowcaseExcerpt[]
  /**
   * Set only on the ONE curated chapter carrying KTD-7's reserved marker (AE7: the
   * first marked chapter wins). `centerpieceExcerptId` is that chapter's first excerpt,
   * the item a later unit dub-switches mid-play. Never on ordinary/fallback chapters.
   */
  languageChapter?: { centerpieceExcerptId: string }
}

export type ShowcaseQueueKind = "curated" | "fallback"

export type ShowcaseQueue = {
  kind: ShowcaseQueueKind
  chapters: ShowcaseChapter[]
  /** Authored global stat lines (KTD-10 `showcase-stats`); empty on the fallback path. */
  statLines: string[]
}

/** The bounded portion of a video an excerpt plays (R6). */
export type ExcerptWindow = {
  startSeconds: number
  endSeconds: number
}

/** A playable, language-resolved stream choice for one excerpt. */
export type ShowcaseStream = {
  hls: string
  /** Language identity — `language.slug`, NEVER bcp47 (bcp47 collides in this catalog). */
  languageSlug: string | null
  languageName: string | null
  muxPlaybackId: string | null
  window: ExcerptWindow
  /**
   * AE4: false when this excerpt's language did not actually rotate (single-language
   * video, or a forced repeat) — the lower-third must make no language claim.
   */
  claimsLanguage: boolean
}

/**
 * What the Experience parser silently discarded. Counts only — the curator's own
 * strings never ride a log context (the action-name privacy rule).
 */
export type ShowcaseParseDrops = {
  /** Items whose coreId was missing, malformed, or never hydrated. */
  items: number
  /** Chapters left with zero playable excerpts, so the whole section was dropped. */
  chapters: number
  /**
   * Marked chapters past the first: the reserved marker is single-use, so extras play
   * as ordinary chapters with their language designation discarded (AE7).
   */
  extraLanguageMarkers: number
}
