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

export const SHORT_FONT_FAMILIES = {
  montserrat: "Montserrat",
  inter: "Inter",
} as const

// Google Fonts unicode-ranges: Cyrillic copy (the devotional is Russian) needs
// the Cyrillic subsets — the latin-only subset has NO Cyrillic glyphs, so
// Cyrillic text would silently fall back to a system font.
const CYRILLIC_RANGE =
  "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"
const CYRILLIC_EXT_RANGE =
  "U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F"

// Variable-font subsets covering the full wght axis (Montserrat 700/900, Inter
// 400/600). Multiple faces per family (latin + cyrillic) with unicode-range so
// the browser picks the right subset per glyph.
const FONT_SOURCES: ReadonlyArray<{
  family: string
  base64: string
  unicodeRange?: string
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
]

const registerFont = async (
  family: string,
  base64: string,
  unicodeRange?: string,
): Promise<void> => {
  const face = new FontFace(
    family,
    `url(data:font/woff2;base64,${base64}) format("woff2")`,
    {
      weight: "100 900",
      style: "normal",
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
    FONT_SOURCES.map(({ family, base64, unicodeRange }) =>
      registerFont(family, base64, unicodeRange),
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
