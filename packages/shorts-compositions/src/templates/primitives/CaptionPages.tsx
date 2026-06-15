import { useCurrentFrame, useVideoConfig } from "remotion"

import { activeTokenIndex } from "../../captions"
import { SHORT_FONT_FAMILIES } from "../../fonts"
import {
  SHORT_SAFE_AREA,
  type CaptionPage,
  type ShortCaptionFont,
  type ShortCaptionPosition,
} from "../../schema"

type CaptionPagesProps = {
  pages: CaptionPage[]
  accentColor: string
  captionPosition: ShortCaptionPosition
  captionFont: ShortCaptionFont
}

const FONT_WEIGHT: Record<ShortCaptionFont, number> = {
  montserrat: 900,
  inter: 600,
}

// accentColor is schema-pinned to ^#[0-9a-fA-F]{6}$ — safe to interpolate
// into styles. Free-text operator strings (token text) are rendered ONLY as
// React text children below (plan security constraint P3-2).
export const CaptionPages = ({
  pages,
  accentColor,
  captionPosition,
  captionFont,
}: CaptionPagesProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeMs = (frame / fps) * 1000

  const page = pages.find(
    (candidate) =>
      candidate.startMs <= timeMs &&
      timeMs < candidate.startMs + candidate.durationMs,
  )
  if (!page) return null

  const activeIndex = activeTokenIndex(page, timeMs)

  return (
    <div
      style={{
        position: "absolute",
        left: SHORT_SAFE_AREA.side,
        right: SHORT_SAFE_AREA.side,
        ...(captionPosition === "center"
          ? { top: 0, bottom: 0, justifyContent: "center" }
          : { bottom: SHORT_SAFE_AREA.bottom + 24 }),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          fontFamily: SHORT_FONT_FAMILIES[captionFont],
          fontWeight: FONT_WEIGHT[captionFont],
          fontSize: 64,
          lineHeight: 1.25,
        }}
      >
        {page.tokens.map((token, index) => {
          const active = index === activeIndex
          return (
            <span
              key={`${page.startMs}-${index}`}
              style={{
                whiteSpace: "pre",
                display: "inline-block",
                color: active ? accentColor : "#ffffff",
                transform: active ? "scale(1.08)" : undefined,
                textShadow: "0 2px 12px rgba(0,0,0,0.8)",
                WebkitTextStroke: "1px rgba(0,0,0,0.5)",
              }}
            >
              {token.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
