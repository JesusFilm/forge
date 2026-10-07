import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// A quiet serif line from the devotional shorts ("From Full Devotional",
// Figma 427-2761): PT Serif italic 32/50, white 92% at 85%. Position in
// Figma units of a 900 x 1600 frame. Fades in after inDelaySec and out over
// the last fadeOutSec of the item. Font subset and embedded.
const PTI = "__PTSERIFI__"
const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
let ready = false
function loadFonts() {
  if (ready || typeof document === "undefined" || typeof FontFace === "undefined") return
  ready = true
  const face = new FontFace("JFL PT Serif", toBytes(PTI), { style: "italic" })
  face.load().then((f) => (document as any).fonts.add(f)).catch(() => {})
  try {
    ;(document as any).fonts.add(face)
  } catch {}
}
loadFonts()

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)

export default function SerifLine({
  text,
  top,
  left,
  align,
  inDelaySec,
  fadeOutSec,
}: {
  text: string
  top: number
  left: number
  align: "left" | "center"
  inDelaySec: number
  fadeOutSec: number
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width } = useVideoConfig()
  const f = (n: number) => (n * width) / 900
  const t = frame / fps
  const end = durationInFrames / fps
  const a = interpolate(t, [inDelaySec, inDelaySec + 0.7], [0, 1], { ...clamp, easing: OUT })
  const out = fadeOutSec > 0 ? interpolate(t, [end - fadeOutSec, end - 0.02], [1, 0], clamp) : 1
  const centred = align === "center"
  return (
    <div
      style={{
        position: "absolute",
        top: f(top),
        ...(centred ? { left: 0, right: 0, textAlign: "center" as const } : { left: f(left) }),
        fontFamily: "'JFL PT Serif', Georgia, serif",
        fontStyle: "italic",
        fontSize: f(32),
        lineHeight: `${f(50)}px`,
        color: "rgba(255,255,255,0.92)",
        opacity: 0.85 * a * out,
        whiteSpace: "nowrap",
        textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
      }}
    >
      {text}
    </div>
  )
}
