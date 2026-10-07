// Loads the vendored fonts (base64-embedded woff2, see fonts-data.ts) into
// document.fonts using Remotion's delayRender/continueRender pattern so
// renders wait for fonts instead of painting fallback glyphs. Single-flight:
// safe to call from every component render.
import { cancelRender, continueRender, delayRender } from "remotion"

import {
  INTER_CYRILLIC_EXT_WOFF2_BASE64,
  INTER_CYRILLIC_WOFF2_BASE64,
  INTER_LATIN_WOFF2_BASE64,
  MONTSERRAT_CYRILLIC_EXT_WOFF2_BASE64,
  MONTSERRAT_CYRILLIC_WOFF2_BASE64,
  MONTSERRAT_LATIN_WOFF2_BASE64,
} from "./fonts-data"
import { CAVEAT_BOLD_LATIN_WOFF2_BASE64 } from "./fonts-caveat-data"
import {
  EB_GARAMOND_LATIN_WOFF2_BASE64,
  EB_GARAMOND_LATIN_ITALIC_WOFF2_BASE64,
} from "./fonts-ebgaramond-data"
import {
  PT_SERIF_CYRILLIC_EXT_WOFF2_BASE64,
  PT_SERIF_CYRILLIC_WOFF2_BASE64,
  PT_SERIF_ITALIC_CYRILLIC_EXT_WOFF2_BASE64,
  PT_SERIF_ITALIC_CYRILLIC_WOFF2_BASE64,
  PT_SERIF_ITALIC_LATIN_WOFF2_BASE64,
  PT_SERIF_LATIN_WOFF2_BASE64,
} from "./fonts-ptserif-data"
import {
  SOURCE_SERIF_4_LATIN_ITALIC_WOFF2_BASE64,
  SOURCE_SERIF_4_LATIN_WOFF2_BASE64,
} from "./fonts-sourceserif-data"

export const SHORT_FONT_FAMILIES = {
  montserrat: "Montserrat",
  inter: "Inter",
  // Still registered: EB Garamond was the owner's first pick from the five
  // serifs mocked up in Figma, before seeing both cuts render on a phone.
  ebGaramond: "EB Garamond",
  // Owner's pick for the devotional's serif text (title, scripture, questions,
  // prayer, conclusion). Variable wght 200-900, so `fontWeight: 300` on the
  // prayer and `400` elsewhere are real weights, not synthesized ones.
  sourceSerif: "Source Serif 4",
  // The source-credit line only (owner's Figma, 2026-09-25). Latin only, and
  // no Greek: the Greek-vocabulary credit sets in Literata instead.
  ptSerif: "PT Serif",
  // Handwriting: the word written over a struck one in the vox language short
  // (owner's pick from nine hands mocked up in Figma, 2026-10-07).
  caveat: "Caveat",
} as const

// Google Fonts unicode-ranges: Cyrillic copy (the devotional is Russian) needs
// the Cyrillic subsets — the latin-only subset has NO Cyrillic glyphs, so
// Cyrillic text would silently fall back to a system font.
const CYRILLIC_RANGE = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"
const CYRILLIC_EXT_RANGE =
  "U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F"

// Variable-font subsets covering the full wght axis (Montserrat 700/900, Inter
// 400/600). Multiple faces per family (latin + cyrillic) with unicode-range so
// the browser picks the right subset per glyph.
/** Exported for the test only: it asserts one registered face per source, so
 *  adding a font can't silently skip registration (and can't leave a hard-coded
 *  count behind — a stale one is how the last two faces went unnoticed). */
export const FONT_SOURCES: ReadonlyArray<{
  family: string
  base64: string
  unicodeRange?: string
  /** Registered face style. The serifs ship a separate italic file; the
   *  variable Inter/Montserrat subsets cover their own slant. */
  style?: "normal" | "italic"
}> = [
  {
    family: SHORT_FONT_FAMILIES.montserrat,
    base64: MONTSERRAT_LATIN_WOFF2_BASE64,
  },
  {
    family: SHORT_FONT_FAMILIES.montserrat,
    base64: MONTSERRAT_CYRILLIC_WOFF2_BASE64,
    unicodeRange: CYRILLIC_RANGE,
  },
  {
    family: SHORT_FONT_FAMILIES.montserrat,
    base64: MONTSERRAT_CYRILLIC_EXT_WOFF2_BASE64,
    unicodeRange: CYRILLIC_EXT_RANGE,
  },
  { family: SHORT_FONT_FAMILIES.inter, base64: INTER_LATIN_WOFF2_BASE64 },
  {
    family: SHORT_FONT_FAMILIES.inter,
    base64: INTER_CYRILLIC_WOFF2_BASE64,
    unicodeRange: CYRILLIC_RANGE,
  },
  {
    family: SHORT_FONT_FAMILIES.inter,
    base64: INTER_CYRILLIC_EXT_WOFF2_BASE64,
    unicodeRange: CYRILLIC_EXT_RANGE,
  },
  // Latin only: EB Garamond carries the English devotional's main text. A
  // Russian cut keeps the sans, which does have Cyrillic subsets.
  {
    family: SHORT_FONT_FAMILIES.ebGaramond,
    base64: EB_GARAMOND_LATIN_WOFF2_BASE64,
  },
  {
    family: SHORT_FONT_FAMILIES.ebGaramond,
    base64: EB_GARAMOND_LATIN_ITALIC_WOFF2_BASE64,
    style: "italic",
  },
  // Latin only, same reasoning as EB Garamond above.
  {
    family: SHORT_FONT_FAMILIES.sourceSerif,
    base64: SOURCE_SERIF_4_LATIN_WOFF2_BASE64,
  },
  {
    family: SHORT_FONT_FAMILIES.sourceSerif,
    base64: SOURCE_SERIF_4_LATIN_ITALIC_WOFF2_BASE64,
    style: "italic",
  },
  { family: SHORT_FONT_FAMILIES.ptSerif, base64: PT_SERIF_LATIN_WOFF2_BASE64 },
  // The real italic: without it the browser slants the upright face.
  {
    family: SHORT_FONT_FAMILIES.ptSerif,
    base64: PT_SERIF_ITALIC_LATIN_WOFF2_BASE64,
    style: "italic",
  },
  // Cyrillic faces (Russian shorts, 2026-10-07).
  {
    family: SHORT_FONT_FAMILIES.ptSerif,
    base64: PT_SERIF_CYRILLIC_WOFF2_BASE64,
    unicodeRange: CYRILLIC_RANGE,
  },
  {
    family: SHORT_FONT_FAMILIES.ptSerif,
    base64: PT_SERIF_CYRILLIC_EXT_WOFF2_BASE64,
    unicodeRange: CYRILLIC_EXT_RANGE,
  },
  {
    family: SHORT_FONT_FAMILIES.ptSerif,
    base64: PT_SERIF_ITALIC_CYRILLIC_WOFF2_BASE64,
    style: "italic",
    unicodeRange: CYRILLIC_RANGE,
  },
  {
    family: SHORT_FONT_FAMILIES.ptSerif,
    base64: PT_SERIF_ITALIC_CYRILLIC_EXT_WOFF2_BASE64,
    style: "italic",
    unicodeRange: CYRILLIC_EXT_RANGE,
  },
  // Latin only: English handwriting overlay.
  {
    family: SHORT_FONT_FAMILIES.caveat,
    base64: CAVEAT_BOLD_LATIN_WOFF2_BASE64,
  },
]

const registerFont = async (
  family: string,
  base64: string,
  unicodeRange?: string,
  style: "normal" | "italic" = "normal",
): Promise<void> => {
  const face = new FontFace(
    family,
    `url(data:font/woff2;base64,${base64}) format("woff2")`,
    {
      weight: "100 900",
      style,
      ...(unicodeRange ? { unicodeRange } : {}),
    },
  )
  await face.load()
  document.fonts.add(face)
}

let fontsPromise: Promise<void> | null = null

export const loadShortFonts = (): Promise<void> => {
  if (fontsPromise) return fontsPromise
  const handle = delayRender("Loading @forge/shorts-compositions fonts")
  fontsPromise = Promise.all(
    FONT_SOURCES.map(({ family, base64, unicodeRange, style }) =>
      registerFont(family, base64, unicodeRange, style),
    ),
  )
    .then(() => {
      continueRender(handle)
    })
    .catch((error: unknown) => {
      // Clear the memoized promise BEFORE cancelRender (which throws) so the
      // failure is not cached forever — the next mount retries the load
      // instead of reusing a stale rejected promise and dead render handle.
      fontsPromise = null
      // No silent fallback-font renders: abort the render with the error.
      cancelRender(error)
    })
  return fontsPromise
}
