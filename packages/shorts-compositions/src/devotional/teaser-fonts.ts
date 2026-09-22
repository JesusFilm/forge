import { cancelRender, continueRender, delayRender } from "remotion"

import { loadShortFonts } from "../fonts"
import {
  LITERATA_ITALIC_VAR_TTF_BASE64,
  LITERATA_VAR_TTF_BASE64,
  POPPINS_ITALIC_TTF_BASE64,
  POPPINS_LIGHT_ITALIC_TTF_BASE64,
  POPPINS_LIGHT_TTF_BASE64,
  POPPINS_MEDIUM_TTF_BASE64,
  POPPINS_REGULAR_TTF_BASE64,
  POPPINS_SEMIBOLD_TTF_BASE64,
} from "./teaser-fonts-data"

/** Poppins + Literata carry the teaser's word burst (owner reference: the
 *  same word set in mixed faces, weights and cases); the prose lines reuse
 *  the devotional title face (Source Serif 4, registered by loadShortFonts). */
export const TEASER_FONT_FAMILIES = {
  poppins: "Poppins",
  literata: "Literata",
} as const

const registerTtf = async (
  family: string,
  base64: string,
  weight: string,
  style: "normal" | "italic" = "normal",
): Promise<void> => {
  const face = new FontFace(
    family,
    `url(data:font/ttf;base64,${base64}) format("truetype")`,
    { weight, style },
  )
  await face.load()
  document.fonts.add(face)
}

let promise: Promise<void> | null = null

/** Registers every teaser face and the shared devotional faces, gating the
 *  render on all of them so no frame is ever rasterized in a fallback font. */
export const loadTeaserFonts = (): Promise<void> => {
  if (promise) return promise
  const handle = delayRender("Loading teaser fonts")
  const P = TEASER_FONT_FAMILIES.poppins
  const L = TEASER_FONT_FAMILIES.literata
  promise = Promise.all([
    loadShortFonts(),
    registerTtf(P, POPPINS_LIGHT_TTF_BASE64, "300"),
    registerTtf(P, POPPINS_LIGHT_ITALIC_TTF_BASE64, "300", "italic"),
    registerTtf(P, POPPINS_REGULAR_TTF_BASE64, "400"),
    registerTtf(P, POPPINS_ITALIC_TTF_BASE64, "400", "italic"),
    registerTtf(P, POPPINS_MEDIUM_TTF_BASE64, "500"),
    registerTtf(P, POPPINS_SEMIBOLD_TTF_BASE64, "600"),
    // Literata ships as variable fonts: one file covers 200–900.
    registerTtf(L, LITERATA_VAR_TTF_BASE64, "200 900"),
    registerTtf(L, LITERATA_ITALIC_VAR_TTF_BASE64, "200 900", "italic"),
  ])
    .then(() => continueRender(handle))
    .catch((error: unknown) => {
      promise = null
      cancelRender(error)
    })
  return promise
}

/**
 * Literata alone, for the devotional's phrase captions over the film. The
 * teaser loader also pulls six Poppins faces the devotional never paints, so
 * this registers the one variable file (200-900 covers every weight) and gates
 * the render on it the same way.
 */
let literataPromise: Promise<void> | null = null

export const loadLiterata = (): Promise<void> => {
  if (literataPromise) return literataPromise
  const handle = delayRender("Loading Literata")
  // BOTH faces: since Literata became the devotional's serif it also carries
  // italic text (the source credit), and without the italic file the browser
  // slants the upright one — a fake oblique, visibly worse than the real cut.
  literataPromise = Promise.all([
    registerTtf(
      TEASER_FONT_FAMILIES.literata,
      LITERATA_VAR_TTF_BASE64,
      "200 900",
    ),
    registerTtf(
      TEASER_FONT_FAMILIES.literata,
      LITERATA_ITALIC_VAR_TTF_BASE64,
      "200 900",
      "italic",
    ),
  ])
    .then(() => continueRender(handle))
    .catch((err) => {
      cancelRender(err)
      throw err
    })
  return literataPromise
}
