/**
 * R9's interstitial copy: the curator's authored global claims merged with one live
 * claim computed from the current video. React-free .ts so it is unit-testable —
 * apps/tv has no render harness by convention.
 */

import { playableDubs, type ShowcaseDubInput } from "./languageRotation"

/** The card is fixed full-screen with no scroll; past this the lines run off 1080p. */
export const MAX_AUTHORED_STAT_LINES = 4

export type InterstitialContent = {
  /** Curator-authored global claims (KTD-10 `showcase-stats`). Never empty. */
  authoredLines: string[]
  /** The live per-video claim; null when this video can't support one. */
  liveLine: string | null
}

/**
 * The breadth claim counts LANGUAGES, not dub rows — several dubs can carry one
 * language slug, and counting those twice would overstate the catalog on screen.
 * Identity is `language.slug`, never bcp47 (bcp47 collides: ko/ko-kmr, en/en-nai).
 */
export function countDistinctLanguages(
  dubs: readonly ShowcaseDubInput[] | null | undefined,
): number {
  const slugs = playableDubs(dubs)
    .map((dub) => dub.languageSlug)
    .filter((slug): slug is string => slug != null)
  return new Set(slugs).size
}

function normalizeAuthoredStatLines(
  lines: readonly string[] | null | undefined,
): string[] {
  return (lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_AUTHORED_STAT_LINES)
}

/** Intl-free thousands grouping: Hermes, and the repo keeps number formatting off Intl. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function formatLiveLanguageLine(
  title: string | null | undefined,
  languageCount: number | null | undefined,
): string | null {
  const name = title?.trim()
  if (!name) return null
  if (languageCount == null || !Number.isFinite(languageCount)) return null
  if (languageCount < 1) return null
  const unit = languageCount === 1 ? "language" : "languages"
  return `${name} is available in ${groupThousands(languageCount)} ${unit}`
}

/**
 * R9: authored globals ARE the breadth claim, so null (skip the interstitial) is the
 * answer whenever they're absent — one video's dub count must never stand in for
 * them. The reducer gates the phase on the same rule; this keeps the card honest too.
 */
export function buildInterstitialContent(args: {
  authoredLines: readonly string[] | null | undefined
  liveTitle?: string | null
  liveLanguageCount?: number | null
}): InterstitialContent | null {
  const authoredLines = normalizeAuthoredStatLines(args.authoredLines)
  if (authoredLines.length === 0) return null
  return {
    authoredLines,
    liveLine: formatLiveLanguageLine(args.liveTitle, args.liveLanguageCount),
  }
}
