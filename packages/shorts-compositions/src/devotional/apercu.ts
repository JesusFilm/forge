// Registers Apercu Pro (Regular/Medium/Bold + italics) into document.fonts for
// the devotional composition, using Remotion's delayRender so renders wait for
// the real glyphs instead of painting a fallback. Single-flight + memoized.
import { cancelRender, continueRender, delayRender } from "remotion"

import { APERCU_FACES } from "./apercu-data"

export const APERCU_FAMILY = "Apercu"

let promise: Promise<void> | null = null

export function loadApercu(): Promise<void> {
  if (promise) return promise
  const handle = delayRender("Loading Apercu font")
  promise = Promise.all(
    APERCU_FACES.map(async ({ weight, style, base64 }) => {
      const face = new FontFace(
        APERCU_FAMILY,
        `url(data:font/woff2;base64,${base64}) format("woff2")`,
        { weight: String(weight), style },
      )
      await face.load()
      document.fonts.add(face)
    }),
  )
    .then(() => continueRender(handle))
    .catch((error: unknown) => {
      promise = null
      cancelRender(error)
    })
  return promise
}
