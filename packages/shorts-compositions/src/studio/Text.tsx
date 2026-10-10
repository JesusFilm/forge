import { useEffect, useState } from "react"
import {
  continueRender,
  delayRender,
  useBufferState,
  useCurrentFrame,
} from "remotion"
import { textMotion, type TextItem } from "./text-style"

class StudioFontError extends Error {}

const bundled = new Set(["Inter", "Montserrat", "Apercu"])

export function StudioText({ item }: { item: TextItem }) {
  const p = item.properties
  const family = p.fontFamily ?? "sans-serif"
  const [handle] = useState(() =>
    bundled.has(family) ? delayRender(`Studio font: ${family}`) : null,
  )
  const [ready, setReady] = useState(handle === null)
  const [error, setError] = useState<Error | null>(null)
  const buffer = useBufferState()
  const frame = useCurrentFrame()
  useEffect(() => {
    if (handle === null) return
    let active = true
    const playback = buffer.delayPlayback()
    const font =
      family === "Apercu"
        ? import("../devotional/apercu").then((m) => m.loadApercu())
        : import("../fonts").then((m) => m.loadShortFonts())
    void font
      .then(() => {
        if (active) setReady(true)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause
              : new StudioFontError("Font could not load"),
          )
      })
      .finally(() => {
        continueRender(handle)
        playback.unblock()
      })
    return () => {
      active = false
      continueRender(handle)
      playback.unblock()
    }
  }, [buffer, family, handle])
  if (error) throw error
  if (!ready) return null
  const motion = textMotion(item, frame)
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent:
          p.align === "left"
            ? "flex-start"
            : p.align === "right"
              ? "flex-end"
              : "center",
        color: p.color ?? "white",
        fontSize: p.fontSize ?? 72,
        fontFamily: family,
        fontWeight: p.fontWeight ?? 500,
        textAlign: p.align ?? "center",
      }}
    >
      <span
        style={{
          whiteSpace: "pre-wrap",
          maxWidth: "100%",
          boxSizing: "border-box",
          opacity: motion.opacity,
          transform: `translateY(${motion.translateY}px)`,
          textShadow: p.shadow
            ? `0 ${p.shadowOffset ?? 3}px ${p.shadowBlur ?? 8}px rgba(0,0,0,0.85)`
            : undefined,
          WebkitTextStroke: p.strokeWidth
            ? `${p.strokeWidth}px ${p.strokeColor ?? "#000000"}`
            : undefined,
          paintOrder: "stroke fill",
          backgroundColor: p.scrimOpacity
            ? `rgba(0,0,0,${p.scrimOpacity})`
            : undefined,
          padding: p.scrimOpacity ? (p.scrimPadding ?? 16) : undefined,
        }}
      >
        {item.text}
      </span>
    </div>
  )
}
