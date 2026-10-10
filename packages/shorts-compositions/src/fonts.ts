// Loads the vendored fonts (base64-embedded woff2, see fonts-data.ts) into
// document.fonts using Remotion's delayRender/continueRender pattern so
// renders wait for fonts instead of painting fallback glyphs. Single-flight:
// safe to call from every component render.
import { cancelRender, continueRender, delayRender } from "remotion"

import {
  INTER_LATIN_WOFF2_BASE64,
  MONTSERRAT_LATIN_WOFF2_BASE64,
} from "./fonts-data"

export const SHORT_FONT_FAMILIES = {
  montserrat: "Montserrat",
  inter: "Inter",
} as const

// The vendored files are Google Fonts variable-font latin subsets covering
// the full wght axis, so one FontFace per family serves every weight the
// templates use (Montserrat 700/900, Inter 400/600).
const FONT_SOURCES: ReadonlyArray<{ family: string; base64: string }> = [
  {
    family: SHORT_FONT_FAMILIES.montserrat,
    base64: MONTSERRAT_LATIN_WOFF2_BASE64,
  },
  { family: SHORT_FONT_FAMILIES.inter, base64: INTER_LATIN_WOFF2_BASE64 },
]

const registerFont = async (family: string, base64: string): Promise<void> => {
  const face = new FontFace(
    family,
    `url(data:font/woff2;base64,${base64}) format("woff2")`,
    { weight: "100 900", style: "normal" },
  )
  await face.load()
  document.fonts.add(face)
}

let fontsPromise: Promise<void> | null = null

export const loadShortFonts = (): Promise<void> => {
  if (fontsPromise) return fontsPromise
  const handle = delayRender("Loading @forge/shorts-compositions fonts")
  fontsPromise = Promise.all(
    FONT_SOURCES.map(({ family, base64 }) => registerFont(family, base64)),
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
