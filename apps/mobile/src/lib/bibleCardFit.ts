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
 * Order of sacrifice: the link goes first, then the verse is shortened, and if
 * even a one-line verse will not fit the VERSE goes — never its credit. A verse
 * rendered without its translation and copyright is an attribution failure, and
 * it is exactly the defect this whole change was made to remove. A card with no
 * room for a credited verse degrades to the reference-only presentation an
 * unresolved passage already produces.
 *
 * Every text region is budgeted at a fixed line count, and the renderer clamps
 * each one to the SAME count with `numberOfLines`. The two must move together:
 * a region that wraps past its budget overflows the square, and the clip lands
 * on the reference.
 */

import type { TypographyScale } from "../hooks/useTypography"
import { clamp } from "./scrubber"

export const REFERENCE_MAX_LINES = 2
export const VERSE_MAX_LINES = 4
export const VERSE_MIN_LINES = 1
export const TRANSLATION_MAX_LINES = 2
export const COPYRIGHT_MAX_LINES = 2

/** Scripture reads larger than the surrounding body copy. */
export const VERSE_FONT_SIZE_INCREASE = 4

// The ratio `typography.body` itself uses (16/24). Keeping it means the extra
// size buys taller lines too, rather than crowding them together.
const VERSE_LINE_HEIGHT_RATIO = 1.5

/**
 * The verse's own type scale. The fit budgets the verse by THIS line height and
 * the renderer draws the verse with THIS font size, from one definition — a
 * verse drawn larger than the budget reserves overflows the fixed square, and
 * the clip lands on the reference.
 *
 * Rounded: Android renders sub-pixel font sizes blurry.
 */
export function verseTypography(typography: TypographyScale): {
  fontSize: number
  lineHeight: number
} {
  const fontSize = typography.body.fontSize + VERSE_FONT_SIZE_INCREASE
  return {
    fontSize,
    lineHeight: Math.round(fontSize * VERSE_LINE_HEIGHT_RATIO),
  }
}

// Consumed directly by BibleQuotesCarouselRenderer's StyleSheet, so the fit
// arithmetic and the rendered layout cannot drift apart. A margin is a fixed
// layout value and does not scale with the reader's text size.
export const REFERENCE_MARGIN = 4
export const VERSE_MARGIN = 6
export const TRANSLATION_MARGIN = 2
export const LINK_MARGIN_TOP = 8
export const LINK_MIN_TAP_HEIGHT = 44
export const CARD_CONTENT_PADDING = 20

export type PassageCardRegions = {
  /** 0 when the card carries no verse, or no room for a credited one. */
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

/**
 * How tall the bottom-aligned text stack will be, from the arithmetic that
 * chose the regions. The scrim reads it instead of measuring after paint.
 */
export function passageCardStackHeight(
  input: PassageCardFitInput,
  regions: PassageCardRegions,
): number {
  return stackHeight(input, regions)
}

/**
 * Where the scrim must have reached the card colour: the top of the text stack.
 * Every text pixel then sits over solid colour, so the 4.5:1 floor holds for
 * ANY still rather than resting on one sampled frame.
 */
// The gradient's previous fixed stop, kept as a ceiling so the scrim is never
// LIGHTER than the one it replaced; a tall stack only pushes it higher.
export const SCRIM_MAX_SOLID_STOP = 0.6
// Above zero: a gradient's stops must increase.
const SCRIM_MIN_SOLID_STOP = 0.02

/**
 * Where the scrim STARTS turning solid: one band above the text, not the card's
 * top edge. Ramping the whole way up dims the still across the entire region it
 * occupies; holding the veil until here leaves that region legible as artwork.
 */
export const SCRIM_RAMP_HEIGHT = 0.1

export function scrimRampStart(solidStop: number): number {
  return Math.max(0, solidStop - SCRIM_RAMP_HEIGHT)
}

export function scrimSolidStop(
  cardHeight: number,
  stackHeight: number,
): number {
  if (!Number.isFinite(cardHeight) || cardHeight <= 0) {
    return SCRIM_MIN_SOLID_STOP
  }
  const stackTop =
    (cardHeight - CARD_CONTENT_PADDING - stackHeight) / cardHeight
  return clamp(stackTop, SCRIM_MIN_SOLID_STOP, SCRIM_MAX_SOLID_STOP)
}

function stackHeight(
  input: PassageCardFitInput,
  regions: PassageCardRegions,
): number {
  const { typography, fontScale } = input
  const line = (lineHeight: number) => lineHeight * fontScale

  let height =
    line(typography.bodySmall.lineHeight) * REFERENCE_MAX_LINES +
    REFERENCE_MARGIN

  if (regions.verseLines > 0) {
    height += line(verseTypography(typography).lineHeight) * regions.verseLines
    height += VERSE_MARGIN
  }
  if (regions.translation) {
    height +=
      line(typography.caption.lineHeight) * TRANSLATION_MAX_LINES +
      TRANSLATION_MARGIN
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

  // A one-line verse plus its credit still overflows. Drop the VERSE and keep
  // the credit: scripture must never render uncredited, and the reference-only
  // card is a presentation this surface already supports.
  regions.verseLines = 0
  if (fits()) return regions

  // With no verse on the card, R5 no longer binds — it governs a RENDERED
  // verse. Shed the credit rather than let the overflow clip the reference,
  // which is the one region every card must keep.
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
