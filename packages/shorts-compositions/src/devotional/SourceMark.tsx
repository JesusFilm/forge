import type { CSSProperties } from "react"
import { Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { TEASER_FONT_FAMILIES } from "./teaser-fonts"
import {
  SOURCE_PORTRAIT_IS_EMBLEM,
  SOURCE_PORTRAIT_URIS,
  type SourcePortraitId,
} from "./source-portraits"

/**
 * The source credit on a reflection card (owner's Figma "Attribution",
 * 2026-09-28, 16:9). Centred over the reflection text:
 *
 *                 (avatar)                      ← portrait in a ring, or an emblem
 *        ◀━━━━━━━━━━━━  ▪  ━━━━━━━━━━━━▶        ← two tapering rules, a gold dot
 *          REFLECTION ADAPTED FROM              ← Inter 500 caps, 46% white
 *          J. C. Ryle (1816–1900)               ← Literata, 78% white
 *
 * Left-aligned credits looked crooked: every sentence under them has its own
 * width, so no left edge lined up for long (owner). Centred, it sits on the
 * axis the centred text shares.
 *
 * It opens from the middle, the way it is built: the gold dot first, the rules
 * drawing outward from it, then the avatar, the label and the source fading
 * in. Nothing rises.
 *
 * Sizes are the owner's Figma numbers on a 1920x1080 frame, divided by px()'s
 * scale (1080 / 390 = 2.77) so they hold at any resolution.
 */
const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const GOLD = "#f2c46b"
const RULE = "#d9d9d9"

export type SourceMarkProps = {
  label: string
  source: string
  portrait?: SourcePortraitId
  /** Seconds since the credit began. */
  t: number
  px: (n: number) => number
  /** When the credit starts to leave, in the same seconds as `t`. */
  holdUntilSec: number
}

/** Emblem boxes from the Figma frames (px on 1920x1080). */
const EMBLEM_BOX: Partial<Record<SourcePortraitId, [number, number]>> = {
  scroll: [61, 48],
  book: [64, 42],
}

export function SourceMark({
  label,
  source,
  portrait,
  t,
  px,
  holdUntilSec,
}: SourceMarkProps) {
  const u = (figmaPx: number) => px(figmaPx / 2.7692)
  const IN = 0.15
  const HOLD_UNTIL = Math.max(IN + 2.2, holdUntilSec)
  const OUT = 0.6

  const fade = (from: number, dur: number) =>
    interpolate(t, [from, from + dur], [0, 1], { ...clamp, easing: EASE })
  const dot = fade(IN, 0.3)
  const drawn = fade(IN + 0.15, 0.9)
  const avatarIn = fade(IN + 0.1, 0.6)
  const labelIn = fade(IN + 0.45, 0.6)
  const sourceIn = fade(IN + 0.6, 0.7)
  const out = interpolate(t, [HOLD_UNTIL, HOLD_UNTIL + OUT], [1, 0], clamp)

  const emblem = portrait ? SOURCE_PORTRAIT_IS_EMBLEM[portrait] : false
  const box = portrait ? EMBLEM_BOX[portrait] : undefined

  const wedge = (side: "left" | "right"): CSSProperties => ({
    width: u(152),
    height: u(4),
    background: RULE,
    // Thin at the outer end, full height where it meets the dot.
    clipPath:
      side === "left"
        ? "polygon(0 50%, 100% 0, 100% 100%)"
        : "polygon(0 0, 100% 50%, 0 100%)",
    transform: `scaleX(${drawn})`,
    transformOrigin: side === "left" ? "right center" : "left center",
  })

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: u(24),
        marginBottom: px(17.3),
        opacity: out,
        whiteSpace: "nowrap",
      }}
    >
      {portrait ? (
        emblem && box ? (
          <img
            src={SOURCE_PORTRAIT_URIS[portrait]}
            alt=""
            style={{
              width: u(box[0]),
              height: u(box[1]),
              objectFit: "contain",
              opacity: 0.85 * avatarIn,
            }}
          />
        ) : (
          <div
            style={{
              position: "relative",
              width: u(70),
              height: u(70),
              borderRadius: "50%",
              overflow: "hidden",
              opacity: 0.85 * avatarIn,
            }}
          >
            <img
              src={SOURCE_PORTRAIT_URIS[portrait]}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                boxShadow: `inset 0 0 0 ${u(1)}px #fff`,
              }}
            />
          </div>
        )
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: u(8),
          opacity: 0.85,
        }}
      >
        <div style={wedge("left")} />
        <div
          style={{
            width: u(4),
            height: u(4),
            background: GOLD,
            opacity: dot,
          }}
        />
        <div style={wedge("right")} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: u(4),
        }}
      >
        <div
          style={{
            fontFamily: `'${SHORT_FONT_FAMILIES.inter}', system-ui, sans-serif`,
            fontWeight: 500,
            fontSize: u(18),
            lineHeight: 1.22,
            letterSpacing: u(3),
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.46)",
            opacity: labelIn,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`,
            fontWeight: 400,
            fontSize: u(36),
            lineHeight: `${u(50)}px`,
            color: "rgba(255,255,255,0.78)",
            opacity: sourceIn,
          }}
        >
          {source}
        </div>
      </div>
    </div>
  )
}
