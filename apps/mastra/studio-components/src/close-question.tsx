import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// The silent closing question of the history short (Figma 428-2762): Inter
// SemiBold caps 36, tracked 1.5, 492 wide, centred at top 675 of a 900 x
// 1600 frame, over a dim; it fades and rises in over 0.6s and stands alone.
// Font subset (caps) and embedded.
const INTER = "__INTER600CAPS__"
const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
let ready = false
function loadFonts() {
  if (ready || typeof document === "undefined" || typeof FontFace === "undefined") return
  ready = true
  const face = new FontFace("JFQ Inter", toBytes(INTER), { weight: "600" })
  face.load().then((f) => (document as any).fonts.add(f)).catch(() => {})
  try {
    ;(document as any).fonts.add(face)
  } catch {}
}
loadFonts()

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)

export default function CloseQuestion({ text, dim, top }: { text: string; dim: number; top: number }) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const f = (n: number) => (n * width) / 900
  const t = frame / fps
  const d = interpolate(t, [0, 0.45], [0, 1], clamp)
  const a = interpolate(t, [0, 0.6], [0, 1], { ...clamp, easing: OUT })
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(0,0,0,${(dim * d).toFixed(3)})` }} />
      <p
        style={{
          position: "absolute",
          top: f(top),
          left: "50%",
          width: f(492),
          margin: 0,
          transform: `translateX(-50%) translateY(${((1 - a) * f(10)).toFixed(2)}px)`,
          fontFamily: "'JFQ Inter', -apple-system, system-ui, sans-serif",
          fontWeight: 600,
          fontSize: f(36),
          lineHeight: 1.22,
          letterSpacing: f(1.5),
          textTransform: "uppercase",
          textAlign: "center",
          color: "#fff",
          opacity: a,
          textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
        }}
      >
        {text}
      </p>
    </AbsoluteFill>
  )
}
