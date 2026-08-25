import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill, Easing, interpolate } from "remotion"

import type { DevotionalStyle } from "./styles"
import {
  AttributionCredit,
  BRAND_LOCKUP_URI,
  BrandMark,
  BrandSymbol,
  COVER_ANIM_SEC,
  SANS,
  measureLineWidth,
  reveal,
} from "./visual-primitives"

function CoverIntro({
  px,
  frame,
  fps,
  durationInFrames,
  title,
  date,
  occasion,
  staticCover,
  isLandscape,
  attribution,
  hideDate,
  hideLogo,
  titleFirst,
  textStatic,
  secondaryLine,
}: {
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  title: ReactNode
  date: string
  occasion?: string
  staticCover: boolean
  isLandscape: boolean
  attribution?: string
  hideDate?: boolean
  hideLogo?: boolean
  titleFirst?: boolean
  textStatic?: boolean
  secondaryLine?: string
}) {
  // Progress runs over a FIXED span (COVER_ANIM_SEC), not the whole card — so a
  // long narration extends the settled HOLD instead of slowing the animation.
  // Capped to the card length for covers shorter than the animation. staticCover
  // (teasers) pins the settled last frame so the opening is readable instantly.
  const animSpan = Math.max(
    1,
    Math.min(durationInFrames - 1, Math.round(COVER_ANIM_SEC * fps)),
  )
  const titleLeads = Boolean(titleFirst || hideLogo)
  const logoFrame = titleLeads
    ? Math.max(0, frame - Math.round(2 * fps))
    : frame
  const p = staticCover ? 1 : Math.max(0, Math.min(1, logoFrame / animSpan))
  const pText =
    staticCover || textStatic ? 1 : Math.max(0, Math.min(1, frame / animSpan))
  const outCubic = { easing: Easing.out(Easing.cubic) as (t: number) => number }
  const inOutCubic = {
    easing: Easing.inOut(Easing.cubic) as (t: number) => number,
  }
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

  // The design sizes are tuned for the 16:9 frame. Portrait (9:16) shares the
  // same short side, so the SAME px() would render identical absolute sizes —
  // which read small in the tall/narrow frame. Scale the whole cover up in
  // portrait (≈1.25) so the logo + text match the previous portrait devotionals.
  const coverScale = isLandscape ? 1 : 1.25
  const cpx = (n: number) => px(n * coverScale)
  const symbolWNum = 31.4 * coverScale

  // Sizes (Claude Design spec): symbol 58px wide, full lockup ≈167px at that
  // height, date container measured, 44px column gap — all × coverScale.
  const symbolW = cpx(31.4)
  const lockupW = cpx(31.4 * (160.27 / 55.65)) // ≈ px(90) → 167px at 720
  const rowH = cpx(31.4 * (40.7 / 55.65)) // symbol height ≈ 42px
  // Date container target = the date's EXACT rendered width + its left padding,
  // so the settled [symbol · date] row has no trailing gap and centres cleanly
  // for any date string (measured, not a fixed 268px).
  const dateLeftPad = cpx(9.75) // 18px
  const dateTargetW =
    hideDate || hideLogo
      ? 0
      : measureLineWidth(date.toUpperCase(), cpx(8.1), cpx(1.625)) + dateLeftPad

  // ---- logo: stamp then morph -----------------------------------------------
  const logoOpacity = interpolate(p, [0, 0.04], [0, 1], clamp)
  // Keyframed stamp: slams in oversized, dips under, settles (linear between).
  const stamp = interpolate(
    p,
    [0, 0.035, 0.06, 0.085],
    [1.4, 0.93, 1.05, 1.0],
    clamp,
  )
  // Clip width shrinks full-lockup → symbol, cropping the wordmark from the right.
  const clipW = interpolate(p, [0.16, 0.35], [lockupW, symbolW], {
    ...clamp,
    ...inOutCubic,
  })
  const lockupOpacity = interpolate(p, [0.29, 0.35], [1, 0], {
    ...clamp,
    ...inOutCubic,
  })
  const symbolOpacity = interpolate(p, [0.29, 0.35], [0, 1], {
    ...clamp,
    ...inOutCubic,
  })

  // ---- date: clip-wipes in beside the symbol (container width 0→target, the
  // SAME clip mechanism mirrored; easeInOutCubic, no fade — the text is revealed
  // purely by the expanding clip, constant opacity).
  const dateW = interpolate(p, [0.42, 0.58], [0, dateTargetW], {
    ...clamp,
    ...inOutCubic,
  })

  // ---- headline: rises in below the row -------------------------------------
  const headOpacity = interpolate(p, [0.72, 0.94], [0, 1], {
    ...clamp,
    ...outCubic,
  })
  const textOpacity = titleLeads || textStatic ? 1 : headOpacity
  const headY = interpolate(pText, [0.72, 0.96], [cpx(10.8), 0], {
    ...clamp,
    ...outCubic,
  })

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: cpx(23.8), // 44px
        padding: `0 ${px(30)}px`,
      }}
    >
      {hideLogo ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: rowH,
            opacity: logoOpacity,
            transform: `scale(${stamp})`,
          }}
        >
          {/* logo group: full lockup clipped down to the clean symbol */}
          <div
            style={{
              position: "relative",
              width: clipW,
              height: rowH,
              flex: "none",
            }}
          >
            <div
              style={{
                width: clipW,
                height: rowH,
                overflow: "hidden",
                opacity: lockupOpacity,
              }}
            >
              <img
                src={BRAND_LOCKUP_URI}
                alt=""
                style={{ display: "block", width: lockupW, height: rowH }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                opacity: symbolOpacity,
              }}
            >
              <BrandSymbol px={px} w={symbolWNum} />
            </div>
          </div>
          {hideDate ? null : (
            <div
              style={{
                width: dateW,
                height: rowH,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                flex: "none",
              }}
            >
              <div
                style={{
                  paddingLeft: dateLeftPad, // 18px
                  whiteSpace: "nowrap",
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: cpx(8.1), // 15px
                  letterSpacing: cpx(1.625), // 3px
                  textTransform: "uppercase",
                  // Muted cool grey (not bright white) so the date sits quietly next
                  // to the mark and reads as a kicker, on light or dark footage.
                  color: "rgba(214,217,224,0.82)",
                }}
              >
                {date}
              </div>
            </div>
          )}
        </div>
      )}

      {/* headline */}
      {occasion ? (
        <div
          style={{
            marginBottom: cpx(-10),
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: cpx(8.1),
            letterSpacing: cpx(1.625),
            textTransform: "uppercase",
            color: "rgba(214,217,224,0.82)",
            opacity: textOpacity,
          }}
        >
          {occasion}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: cpx(32.5), // 60px
          lineHeight: 1.04,
          letterSpacing: cpx(-0.758), // −1.4px
          color: "#fff",
          maxWidth: cpx(487), // 900px
          opacity: textOpacity,
          transform: `translateY(${headY}px)`,
        }}
      >
        {title}
      </div>
      {secondaryLine ? (
        <div
          style={{
            marginTop: cpx(-8),
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: cpx(8.1),
            letterSpacing: cpx(1.625),
            textTransform: "uppercase",
            color: "rgba(214,217,224,0.82)",
            opacity: textOpacity,
          }}
        >
          {secondaryLine}
        </div>
      ) : null}
      {attribution ? (
        <AttributionCredit
          px={px}
          text={attribution}
          bottomPx={isLandscape ? px(17.35) : px(28)}
          // Desktop (16:9) is 2px smaller than portrait: px(5.9)≈16px vs
          // px(6.6)≈18px at 1080.
          fontUnits={isLandscape ? 5.9 : 6.6}
          frame={frame}
          fps={fps}
          // Start once the headline has landed (headline finishes at p≈0.96).
          delaySec={(animSpan * 0.96) / fps}
          animate={!staticCover}
        />
      ) : null}
    </AbsoluteFill>
  )
}

function MuteButton({
  px,
  style,
}: {
  px: (n: number) => number
  style: DevotionalStyle
}) {
  const d = px(42)
  return (
    <div
      style={{
        position: "absolute",
        right: px(18),
        bottom: px(18),
        width: d,
        height: d,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          style.id === "grain"
            ? "rgba(255,255,255,0.2)"
            : "rgba(255,255,255,0.14)",
        backdropFilter: style.id === "grain" ? "blur(8px)" : undefined,
      }}
    >
      <svg width={px(20)} height={px(20)} viewBox="0 0 24 24">
        <path d="M4 9h3l4-3v12l-4-3H4z" fill="#fff" />
        <path
          d="M16 9l5 6M21 9l-5 6"
          stroke="#fff"
          strokeWidth={2}
          fill="none"
        />
      </svg>
    </div>
  )
}

// Currently unrendered (cards draw their own header/date row) — kept for reuse.

function Header({
  style,
  px,
  frame,
  fps,
  date,
  cover,
}: {
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  date: string
  cover?: boolean
}) {
  const eyebrow: CSSProperties = {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: px(12),
    letterSpacing: px(2.6),
    color: style.secondary,
    textTransform: "uppercase",
  }
  const dateNode = <div style={eyebrow}>{date}</div>
  const rev = reveal(frame, fps, 0.1, 1, "fade")
  if (style.header === "row" && !cover) {
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: `${px(26)}px ${px(24)}px 0`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          ...rev,
        }}
      >
        <BrandMark px={px} />
        {dateNode}
      </div>
    )
  }
  // centered column (grain) or brand-only (sepia)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${px(26)}px ${px(24)}px 0`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: px(9),
        ...rev,
      }}
    >
      <BrandMark px={px} />
      {style.header !== "brand" || cover ? dateNode : null}
    </div>
  )
}

/** Render text with one phrase highlighted in the accent color. */
function withHighlight(
  text: string,
  phrase: string | undefined,
  style: DevotionalStyle,
): ReactNode {
  const idx = phrase ? text.indexOf(phrase) : -1
  if (idx === -1) return text
  // Highlight only the FIRST occurrence; keep the rest intact (a phrase can
  // appear more than once — e.g. "hope … hope." — and split() would drop the tail).
  const before = text.slice(0, idx)
  const after = text.slice(idx + phrase!.length)
  return (
    <>
      {before}
      <span
        style={{
          color: style.highlight,
          // Highlighted phrases are always italic (owner rule).
          fontStyle: "italic",
        }}
      >
        {phrase}
      </span>
      {after}
    </>
  )
}

/** Rounded frosted rectangle: blurs the video only behind the text it wraps. */
function FrostPanel({
  px,
  children,
  extra,
}: {
  px: (n: number) => number
  children: ReactNode
  extra?: CSSProperties
}) {
  return (
    <div
      style={{
        alignSelf: "stretch",
        // Blur only — no dark fill behind the text (per request).
        backdropFilter: `blur(${px(22)}px)`,
        WebkitBackdropFilter: `blur(${px(22)}px)`,
        borderRadius: px(18),
        padding: px(26),
        ...extra,
      }}
    >
      {children}
    </div>
  )
}

function Eyebrow({
  children,
  px,
  color,
  size = 11,
  mb = 24,
}: {
  children: ReactNode
  px: (n: number) => number
  color: string
  size?: number
  mb?: number
}) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: px(size),
        letterSpacing: px(3),
        textTransform: "uppercase",
        color,
        marginBottom: px(mb),
      }}
    >
      {children}
    </div>
  )
}

export { CoverIntro, Eyebrow, FrostPanel, Header, MuteButton, withHighlight }
