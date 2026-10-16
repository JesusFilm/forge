import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The Daily Bible Pause series mark over a short (owner's Figma 411-2366, a
// 900 x 1600 frame): the open-book mark, 24 below it the name in Inter Medium
// 25 tracked 5, centred with its top at `top`. Fades in and out.
const INTER = "d09GMgABAAAAAATEAA8AAAAACLgAAARqAAQAQgAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbIBwqBmA/U1RBVFoAdBEICoYEhQ4BNgIkAzALGgAEIAWEMgcgGx8HAJ6DcZscUmpOo9Jmyuzcx+dCBNFaWT0784ghVsQONTsCUNEEMnFRHoA127//eU//pnMy6ctATpdKo/As5P86QEp8wc3/5bQx+UBbCzilf3NgYwOOMYES7GVhuAZggSUYZoEFRBtUeluGmbjfzLsIOkqgBZCE0MSno8kwapDFfiExIC5DTUCgyQQGSDmTSe/J5DFANVNudc6/4qtCmZHPAXd0q/TASBpLKJU5NiOIJ7FiZWg0HAQNifUHBwA0fEjdAALyOpHLwCiSQmhQoYcQJiLtZ3ELEQdwfHsuD0HETl4mDfEAkjpd1CBIMY80QhAz4isqSYoFAAiQ6M4GQsI23I8sIdkoXnwFChEhWqzEmhjFk0/kNu2gA/babYdtttoIIR4zRE3tCC1gENCGdwCxGQBkQFJJgs6sLfc0oX1ZMtcNmqEsixVJFaCF12/HYVdfx+QnI3Kw0zJN165B+fOrMXDNmIlmSTXdQCquX0clgxACILYzFlr+6BaUv35YWIAWYUVyIJ3aV/a0bxQrkOk9gFb7TtIbwReHXRM85pfi4j6gA5vGSqRYFCS0sUyCcpB8Y1esCcDMx9cRsea6C4yYyVcfyoicksIH8P438WSpfGHr0bqXVTWPXf5B21UzJ0LO5oCZ1aEIRbV0uS5X/fr9YvthhsjT8WMXyPg6I9W7lBPiIycTRGpJSBnnsinb7hGrCUe8xpuKUgL8uBU+ScHrxsEFjr6Ef0pZYY0lNBw4mbPwoIT5dX2N8el2yVT+ybq7jhtzIS9fzYd6bFGzvQwiT7+DyFMzRJ7eP3p8b9eRrjNnj4Lq9ShiBNvuHeVfrG/5WRn7VmMj5/az0hX6oXhGXbBbVXSMW2V9IFMVRNrdGjT3jWg8Klr3TDQiieiwjk3vdIqlBXgGRZXaRSiumG+3OHtgoKLx4HtK78BLSvUukuA+is8yy5Kq7QOy3P3j4oqtWtt1/eR6Xcoywlrx0opj34fvyluwhs6Pw5efHsAThqYS2azJxPgh/MCzy8OdH9EGSFiuFV2Bqrw1C/Vr0yUCdal+7cZBircltGZURALg/GdAkC1ck3nlezIu/xuEGsBXQV07AD/f4df+/19DcVH8BlBJIHi9Uu+RDP1fz2Eg9m0p85EAkWWwLp4wU46byVfMJDNdVqsrWlbFGKW8nd8J1kkLCLRYBf2Hibyj4kqg1V2rIjfiEmBjaHLJmLS5Y6xMNW/MhrhpLGb7bKgzJAycIrTEQvkM9RLjXKqRZJxHPA4Z54NknLqEBYDGRfDGxFKAg0CWi0eDFQuW7GiIkQunIRADD45DQwQOJgpcdsVyT3w8uZg4uDQYdFrGw8LlxJw5MiJrFl8WM9mY6BEEgU5zUSR26Dfc7ZgoODI+mkwcNsxYnI12jo6PFiqaMwwxrakf3jTYOJjORWBi0OiOnTZoyk562rCXzUJWu7tF4+H3d6pQuBwEPrpwLDyEbJloNEQjFMJZsolCgXhIFht1L1fLxCAEDCzDCAEAAAA="
const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
let ready = false
function loadFonts() {
  if (ready || typeof document === "undefined" || typeof FontFace === "undefined") return
  ready = true
  const face = new FontFace("DBP Inter", toBytes(INTER), { weight: "500" })
  face.load().then((f) => (document as any).fonts.add(f)).catch(() => {})
  try {
    ;(document as any).fonts.add(face)
  } catch {}
}
loadFonts()

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const LEAF_L =
  "M22.7353 6.69586C22.7353 5.5387 21.9013 4.54996 20.7607 4.35486L4.27543 1.535C2.82479 1.28687 1.5 2.40429 1.5 3.876V50.4456C1.5 52.0221 3.00785 53.1611 4.52433 52.7301L21.0096 48.0445C22.0308 47.7542 22.7353 46.8216 22.7353 45.76V6.69586Z"
const LEAF_R =
  "M37.2646 6.69586C37.2646 5.5387 38.0986 4.54996 39.2392 4.35486L55.7245 1.535C57.1751 1.28687 58.4999 2.40429 58.4999 3.876V50.4456C58.4999 52.0221 56.9921 53.1611 55.4756 52.7301L38.9903 48.0445C37.9691 47.7542 37.2646 46.8216 37.2646 45.76V6.69586Z"

export default function DbpMark({ top, opacity, fadeInSec, fadeOutSec }: { top: number; opacity: number; fadeInSec: number; fadeOutSec: number }) {
  const frame = useCurrentFrame()
  const { fps, width, durationInFrames } = useVideoConfig()
  const f = (n: number) => (n * width) / 900
  const t = frame / fps
  const end = durationInFrames / fps
  const a =
    (fadeInSec > 0 ? interpolate(t, [0, fadeInSec], [0, 1], clamp) : 1) *
    (fadeOutSec > 0 ? interpolate(t, [end - fadeOutSec, end - 0.02], [1, 0], clamp) : 1)
  const size = f(49.338)
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: a * (opacity ?? 1) }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: f(top), display: "flex", flexDirection: "column", alignItems: "center", gap: f(24) }}>
        <svg width={size} height={(size * 54.3229) / 60} viewBox="0 0 60 54.3229" fill="none" style={{ display: "block", opacity: 0.75 }}>
          <path d={LEAF_L} stroke="#FFF6F1" strokeWidth={3} />
          <path d={LEAF_R} stroke="#FFF6F1" strokeWidth={3} />
        </svg>
        <div style={{ fontFamily: "'DBP Inter', -apple-system, system-ui, sans-serif", fontWeight: 500, fontSize: f(25), letterSpacing: f(5), color: "#fff", whiteSpace: "nowrap", textShadow: "0 1px 10px rgba(0,0,0,0.45)" }}>
          DAILY BIBLE PAUSE
        </div>
      </div>
    </AbsoluteFill>
  )
}
