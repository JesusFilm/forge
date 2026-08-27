/**
 * Which regions of a passage-backed Bible card fit inside its fixed square.
 *
 * Card content is bottom-aligned, so passive overflow clips the TOP — the
 * reference, which is the one thing every card must keep. Leaving the drop
 * order to the layout engine therefore ships it inverted. This decides the
 * order up front, from arithmetic rather than from a measured round trip: a
 * post-layout measure would land after paint and produce exactly the fill-in
 * the reserved height exists to prevent.
 *
 * Order of sacrifice: the link goes first, then the verse is shortened, and
 * only in the pathological case do the credit lines go. The verse and its
 * credit stand or fall together — a verse rendered without its translation and
 * copyright is an attribution failure, so shortening the verse is preferred to
 * dropping either credit line.
 */

import type { TypographyScale } from "../hooks/useTypography"

export const VERSE_MAX_LINES = 4
export const VERSE_MIN_LINES = 1
export const COPYRIGHT_MAX_LINES = 2

// Mirror the margins in BibleQuotesCarouselRenderer's styles. A margin is a
// fixed layout value and does not scale with the reader's text size.
const REFERENCE_MARGIN = 4
const VERSE_MARGIN = 6
const TRANSLATION_MARGIN = 2
const LINK_MARGIN_TOP = 8
const LINK_MIN_TAP_HEIGHT = 44

export type PassageCardRegions = {
  /** 0 when the card carries no verse at all. */
  verseLines: number
  translation: boolean
  copyright: boolean
  link: boolean
}

export type PassageCardFitInput = {
  /** Card height minus its vertical padding. */
  contentHeight: number
  typography: TypographyScale
  /** The reader's text-size setting; margins do not scale with it. */
  fontScale: number
  hasVerse: boolean
  hasTranslation: boolean
  hasCopyright: boolean
  hasLink: boolean
}

function stackHeight(
  input: PassageCardFitInput,
  regions: PassageCardRegions,
): number {
  const { typography, fontScale } = input
  const line = (lineHeight: number) => lineHeight * fontScale

  let height = line(typography.bodySmall.lineHeight) + REFERENCE_MARGIN

  if (regions.verseLines > 0) {
    height += line(typography.body.lineHeight) * regions.verseLines
    height += VERSE_MARGIN
  }
  if (regions.translation) {
    height += line(typography.caption.lineHeight) + TRANSLATION_MARGIN
  }
  if (regions.copyright) {
    height += line(typography.caption.lineHeight) * COPYRIGHT_MAX_LINES
  }
  if (regions.link) {
    height +=
      Math.max(LINK_MIN_TAP_HEIGHT, line(typography.bodySmall.lineHeight)) +
      LINK_MARGIN_TOP
  }

  return height
}

export function fitPassageCardRegions(
  input: PassageCardFitInput,
): PassageCardRegions {
  const regions: PassageCardRegions = {
    verseLines: input.hasVerse ? VERSE_MAX_LINES : 0,
    translation: input.hasTranslation,
    copyright: input.hasCopyright,
    link: input.hasLink,
  }

  const fits = () => stackHeight(input, regions) <= input.contentHeight

  if (fits()) return regions

  if (regions.link) {
    regions.link = false
    if (fits()) return regions
  }

  while (regions.verseLines > VERSE_MIN_LINES) {
    regions.verseLines -= 1
    if (fits()) return regions
  }

  if (regions.copyright) {
    regions.copyright = false
    if (fits()) return regions
  }

  regions.translation = false
  return regions
}

/**
 * The card is one grouped accessibility element on every surface, so this one
 * string is the whole announcement. A card with no verse must not trail the
 * separator its verse would have followed.
 */
export function composeCardLabel(reference: string, verse: string): string {
  const trimmed = verse.trim()
  return trimmed.length > 0 ? `${reference}: ${trimmed}` : reference
}
