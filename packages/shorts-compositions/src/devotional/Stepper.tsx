/**
 * The stepper screen: READ / WATCH / REFLECT / PRAY, with the light sitting on
 * one of them.
 *
 * Shared by the real devotional composition and the design-test composition, so
 * what the owner approved in the tests is literally what ships. Pure in its
 * inputs: the caller decides where the light is (`glowPos`, fractional while it
 * travels) and how gold each step is.
 *
 * Design decisions the owner made across three rounds of animated tests:
 *  - No step label pinned at the top of the frame, and nothing entering or
 *    leaving: only the light moves, so there is one thing to track.
 *  - Type is a label (600 weight), not a headline — round one read as too big
 *    and too heavy.
 *  - The steps still ahead sit at 22% opacity; at 40% they competed with the
 *    active one.
 *  - The outer pool of light is constant; only the inner, more opaque element
 *    thins out in transit, because that element was what read as a bead
 *    sliding across the frame.
 *  - The word fills with the light (a glow on the glyphs) rather than merely
 *    changing colour. This was the detail the owner singled out.
 */
import React from "react"
import { interpolateColors } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { DEVOTIONAL_STEPS } from "./schema"
import { resolveDevotionalStyle } from "./styles"

const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const SERIF = `'${SHORT_FONT_FAMILIES.sourceSerif}', Georgia, 'Times New Roman', serif`

export const StepperStack: React.FC<{
  variant: "glow" | "rail"
  /** Position of the light in row units; fractional while it travels. */
  glowPos: number
  goldness: (i: number) => number
  style: ReturnType<typeof resolveDevotionalStyle>
  px: (n: number) => number
  width: number
  height: number
  /**
   * Fades the light in. The OPENING screen holds it at 0 while its line is
   * being read — the four stages are all still ahead, so lighting one of them
   * would say something untrue about where the viewer is — then brings it up
   * as READ takes over.
   */
  lightOpacity?: number
  /** A line above the stack (the opening screen's spoken line). */
  headline?: React.ReactNode
  /** The stage labels. Defaults to the four; the clip-first structure passes
   *  three (WATCH / REFLECT / PRAY) because the film has already played. */
  steps?: ReadonlyArray<string>
}> = ({
  variant,
  glowPos,
  goldness,
  style,
  px,
  width,
  height,
  lightOpacity = 1,
  headline,
  steps,
}) => {
  const STEPS = steps ?? DEVOTIONAL_STEPS
  // Owner: round one's type was too big and too heavy. Smaller, and 600 rather
  // than 700 — still a label, no longer a headline.
  const SIZE = px(15)
  const ROW_GAP = px(44)
  const stackH = ROW_GAP * (STEPS.length - 1)
  const stackTop = height / 2 - stackH / 2
  const rowY = (i: number) => stackTop + i * ROW_GAP
  const RAIL_X = variant === "rail" ? px(52) : 0
  const LABEL_X = RAIL_X + px(28)

  /**
   * 16:9 lays the four stages out as a ROW, not a column (owner's design).
   *
   * A vertical stack is a thin strip down the middle of a wide frame, and the
   * headline — positioned from the stack's top edge — was thrown up against
   * the very top, half a screen away from what it introduces. In landscape
   * both live in ONE centred group, and glowing dots divide the stages.
   */
  const isLandscape = width > height

  /**
   * Owner's final read on the light: keep the outer pool exactly as it was in
   * the cut she liked — same size, same presence throughout — and let only the
   * INNER, more opaque element thin out between steps. That element is what
   * read as a bead sliding across the frame; the pool never did.
   *
   * Distance to the nearest step drives it (0 at a step, 0.5 midway), so it
   * needs no phase tracking and cannot fall out of step with the movement.
   */
  const nearestFrac = Math.abs(glowPos - Math.round(glowPos))
  const coreFade = 0.22 + 0.78 * (1 - nearestFrac / 0.5)

  if (isLandscape) {
    const common = {
      fontFamily: SANS,
      fontWeight: 600,
      fontSize: SIZE,
      letterSpacing: SIZE * 0.16,
      whiteSpace: "nowrap" as const,
    }
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: px(23),
          pointerEvents: "none",
        }}
      >
        {headline ? (
          <div
            style={{
              maxWidth: px(400),
              textAlign: "center",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: px(20),
              lineHeight: 1.28,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {headline}
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: px(20) }}>
          {STEPS.map((label, i) => {
            const gold = goldness(i)
            const near = Math.max(0, 1 - Math.abs(glowPos - i))
            return (
              <React.Fragment key={label}>
                {i > 0 ? (
                  // Divider (owner's design). Gold and softly lit, so it reads
                  // as part of the same light rather than a grey bullet.
                  <span
                    style={{
                      width: px(2.4),
                      height: px(2.4),
                      borderRadius: "50%",
                      background: style.eyebrow,
                      opacity: 0.55,
                      boxShadow: `0 0 ${px(5)}px ${px(1.5)}px rgba(242,196,107,0.5)`,
                      flex: "0 0 auto",
                    }}
                  />
                ) : null}
                <span style={{ position: "relative", display: "inline-block" }}>
                  {/* The pool of light that sits on the CURRENT step. In
                      portrait a single pool travels down the column; here it
                      belongs to the label it lights, so no measurement of the
                      row's geometry is needed. */}
                  {lightOpacity > 0 && near > 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        width: px(96),
                        height: px(34),
                        marginLeft: px(-48),
                        marginTop: px(-17),
                        borderRadius: "50%",
                        background: style.eyebrow,
                        opacity: 0.3 * near * lightOpacity,
                        filter: `blur(${px(18)}px)`,
                        mixBlendMode: "screen",
                      }}
                    />
                  ) : null}
                  <span
                    style={{
                      ...common,
                      position: "relative",
                      color: interpolateColors(
                        gold,
                        [0, 1],
                        ["#ffffff", style.eyebrow],
                      ),
                      opacity: 0.22 + 0.78 * gold,
                      // Kept from the portrait cut — the owner's favourite
                      // detail is the word FILLING with light, not just
                      // changing colour.
                      textShadow: `0 0 ${px(16) * near}px rgba(242,196,107,${0.65 * near})`,
                      display: "inline-block",
                      transform: `scale(${1 + 0.06 * near})`,
                    }}
                  >
                    {label}
                  </span>
                </span>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Variant 1: the light is the only moving thing. Two layers, both
          screen-blended so the pool ADDS light instead of washing over the
          frame — in normal blend it simply vanished wherever the background
          clip was bright. */}
      {variant === "glow" && lightOpacity > 0 ? (
        <>
          <div
            style={{
              position: "absolute",
              left: width / 2 - px(84),
              top: rowY(glowPos) - px(30),
              width: px(168),
              height: px(60),
              borderRadius: "50%",
              background: style.eyebrow,
              opacity: 0.3 * lightOpacity,
              filter: `blur(${px(26)}px)`,
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: width / 2 - px(46),
              top: rowY(glowPos) - px(13),
              width: px(92),
              height: px(26),
              borderRadius: "50%",
              background: style.eyebrow,
              // The one element that changes: nearly gone mid-travel, fully
              // present once the light is sitting on a step.
              opacity: 0.34 * coreFade * lightOpacity,
              filter: `blur(${px(11)}px)`,
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}

      {/* Variant 2: a straight line, a bead running down it, and the line
          filling gold behind the bead. */}
      {variant === "rail" ? (
        <>
          <div
            style={{
              position: "absolute",
              left: RAIL_X,
              top: rowY(0),
              width: 1,
              height: stackH,
              background: "#ffffff",
              opacity: 0.16,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: RAIL_X,
              top: rowY(0),
              width: 1,
              height: rowY(glowPos) - rowY(0),
              background: style.eyebrow,
              opacity: 0.75,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: RAIL_X - px(5),
              top: rowY(glowPos) - px(5),
              width: px(10),
              height: px(10),
              borderRadius: "50%",
              background: style.eyebrow,
              boxShadow: `0 0 ${px(14)}px ${px(5)}px rgba(242,196,107,0.55)`,
            }}
          />
        </>
      ) : null}

      {headline ? (
        <div
          style={{
            position: "absolute",
            left: px(34),
            right: px(34),
            // Sits ABOVE the stack with a clear gap, so the four stages read
            // as what the line is talking about rather than part of it.
            bottom: height - stackTop + px(70),
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              // Owner: the English default line ran edge-to-edge on one long
              // line. Capping the width forces it onto two — this is a wrap
              // constraint, not a hard-coded break, so it holds for any
              // locale's line, not just the English wording.
              maxWidth: px(230),
              textAlign: "center",
              fontFamily: SERIF,
              fontStyle: "italic",
              // Light, like the scripture verse it introduces.
              fontWeight: 300,
              // Owner trimmed it by 4 units after seeing it on the opening
              // screen: it introduces the stages, it is not the subject.
              fontSize: px(22),
              lineHeight: 1.28,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {headline}
          </div>
        </div>
      ) : null}

      {STEPS.map((label, i) => {
        const gold = goldness(i)
        const near = Math.max(0, 1 - Math.abs(glowPos - i))
        const common = {
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: SIZE,
          letterSpacing: SIZE * 0.16,
          whiteSpace: "nowrap" as const,
        }
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: variant === "rail" ? LABEL_X : 0,
              right: variant === "rail" ? undefined : 0,
              top: rowY(i) - SIZE * 0.72,
              display: "flex",
              justifyContent: variant === "rail" ? "flex-start" : "center",
              // Owner: grow it a little as the light arrives, not a lot.
              transform: `scale(${1 + 0.06 * near})`,
              transformOrigin: variant === "rail" ? "left center" : "center",
              pointerEvents: "none",
            }}
          >
            {variant === "rail" ? (
              // Left-to-right gold: a clipped gold copy over the white one.
              <div style={{ position: "relative", display: "inline-block" }}>
                <span style={{ ...common, color: "#ffffff", opacity: 0.22 }}>
                  {label}
                </span>
                <span
                  style={{
                    ...common,
                    position: "absolute",
                    left: 0,
                    top: 0,
                    overflow: "hidden",
                    width: `${gold * 100}%`,
                    color: style.eyebrow,
                  }}
                >
                  {label}
                </span>
              </div>
            ) : (
              <span
                style={{
                  ...common,
                  color: interpolateColors(
                    gold,
                    [0, 1],
                    ["#ffffff", style.eyebrow],
                  ),
                  // Owner: the steps still ahead were pulling too much
                  // attention. They are a promise, not the subject.
                  opacity: 0.22 + 0.78 * gold,
                  // The owner's favourite detail: the word looks like it FILLS
                  // with the light rather than merely changing colour.
                  textShadow: `0 0 ${px(16) * near}px rgba(242,196,107,${0.65 * near})`,
                }}
              >
                {label}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
