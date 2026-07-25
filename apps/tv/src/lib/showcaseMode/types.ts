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

/** A felt-need chapter (curated) or the single unlabeled reel (fallback). */
export type ShowcaseChapter = {
  id: string
  /** Felt-need name; "" on the fallback path, which renders no chapter card. */
  title: string
  subtitle: string | null
  excerpts: ShowcaseExcerpt[]
  /**
   * Set on every curated chapter carrying KTD-7's reserved marker — the curator may
   * repeat the language chapter through the reel. `centerpieceExcerptId` is that
   * chapter's first excerpt, the item KTD-5 dub-switches mid-play. Never on fallback.
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
   * True only for a KTD-5 hop's mid-play dub switch — the one case the lower-third
   * announces a language. Every ordinary excerpt is false (no rotation anymore).
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
}
