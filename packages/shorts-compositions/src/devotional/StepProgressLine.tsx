import { Easing, interpolate, interpolateColors } from "remotion"

/**
 * The devotional's stage clock, as the owner's Figma draws it: the three step
 * names in a row with a hairline between them, the one you are inside lit gold
 * and breathing, the ones behind you plain white, the ones ahead dim.
 *
 * Replaces the corner ring and its travelling point of light: a ring reads as
 * decoration, while a named row tells a viewer where they are without being
 * studied (owner, 2026-09-22). The hairline between two names doubles as the
 * progress bar for the step being served — it fills left to right across the
 * stage, so the row says both WHERE you are and HOW FAR in.
 */

const GOLD = "#f2c46b"
const DONE = "rgba(255,255,255,0.86)"
const AHEAD = "rgba(255,255,255,0.34)"
/** One breath of the active label's glow. Slow on purpose: a fast pulse reads
 *  as a notification, this should read as something alive but at rest. */
const PULSE_SEC = 2.2
/** How long a label takes to change state (dim → gold, gold → white). */
const FADE_SEC = 0.55

const ease = Easing.bezier(0.42, 0, 0.58, 1)

export type StepProgressLineProps = {
  steps: ReadonlyArray<string>
  /** Frame at which each step becomes the active one; same length as `steps`. */
  starts: ReadonlyArray<number>
  /** Frame the last step ends — where the final hairline finishes filling. */
  endFrame: number
  frame: number
  fps: number
  px: (n: number) => number
  /** Type size in design units (px() is applied). Default 9 ≈ 25px in the
   *  16:9 cut, measured off the owner's Figma frame (cap height 17.5px). */
  size?: number
  /** Hairline length in design units. Ignored when `widthPx` is set: the
   *  hairlines then stretch to fill the container. */
  railUnits?: number
  /** Container width in px. The row spans it exactly — owner's rule is that
   *  the steps line up with the reflection text's column. */
  widthPx?: number
  /** Overall opacity, for fading the whole row in and out. */
  opacity?: number
}

export function StepProgressLine({
  steps,
  starts,
  endFrame,
  frame,
  fps,
  px,
  size = 9,
  railUnits = 46,
  widthPx,
  opacity = 1,
}: StepProgressLineProps) {
  const fade = Math.max(1, Math.round(FADE_SEC * fps))
  // 0 → not started, 1 → fully arrived. Each label reads two of these: its own
  // arrival, and the NEXT step's arrival, which is its own departure.
  const arrived = (i: number) =>
    i >= starts.length
      ? 0
      : interpolate(frame, [starts[i], starts[i] + fade], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        })
  const pulse =
    0.72 + 0.28 * Math.sin((2 * Math.PI * (frame / fps)) / PULSE_SEC)
  const gap = px(railUnits * 0.3)
  const stretch = widthPx != null

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap,
          ...(stretch ? { width: widthPx } : {}),
        }}
      >
        {steps.map((label, i) => {
          const on = arrived(i)
          const off = arrived(i + 1)
          // dim → gold as it arrives, gold → white as the next one takes over.
          const color = interpolateColors(
            off,
            [0, 1],
            [interpolateColors(on, [0, 1], [AHEAD, GOLD]), DONE],
          )
          const live = on * (1 - off)
          const glow = live * pulse
          // Grows a touch while it is the live step, from its own centre, so
          // the row's spacing never shifts.
          const grow = 1 + 0.08 * live
          // The hairline after this label carries the step's own progress: it
          // fills while the step is being served and stays lit behind you.
          const to = i + 1 < starts.length ? starts[i + 1] : endFrame
          const fill = interpolate(frame, [starts[i], to], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap,
                ...(stretch && i < steps.length - 1 ? { flex: 1 } : {}),
              }}
            >
              <span
                style={{
                  fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
                  fontWeight: 600,
                  fontSize: px(size),
                  letterSpacing: px(size * 0.22),
                  color,
                  // Two tight halos rather than one wide one: a single large
                  // blur spreads behind the whole word and reads as a lit box,
                  // not as letters catching light.
                  textShadow:
                    glow > 0.01
                      ? `0 0 ${px(4) * glow}px rgba(242,196,107,${0.55 * glow}), ` +
                        `0 0 ${px(11) * glow}px rgba(242,196,107,${0.3 * glow})`
                      : "none",
                  whiteSpace: "nowrap",
                  display: "inline-block",
                  transform: `scale(${grow.toFixed(3)})`,
                  transformOrigin: "center",
                }}
              >
                {label}
              </span>
              {i < steps.length - 1 ? (
                <span
                  style={{
                    position: "relative",
                    display: "inline-block",
                    ...(stretch ? { flex: 1 } : { width: px(railUnits) }),
                    height: px(1),
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: px(1),
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: 0,
                      width: `${(fill * 100).toFixed(2)}%`,
                      background: fill >= 1 ? DONE : GOLD,
                      borderRadius: px(1),
                    }}
                  />
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
