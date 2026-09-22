import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import { loadShortFonts } from "../fonts"
import { loadLiterata } from "./teaser-fonts"
import { StepProgressLine } from "./StepProgressLine"

/**
 * A review-only composition: the step row and the hand-over between two steps,
 * over a still of the film, so the owner can judge the MOTION (and the blur
 * behind it) without a ten-minute film render. Never shipped in a devotional.
 */
export const STEPS_PREVIEW_ID = "devotional-steps-preview"

/** The step being entered, written across the frame at a whisper: it arrives
 *  out of the blur, comes into focus with the picture, and goes back into the
 *  blur as the reflection starts (owner). */
function BigStepWord({
  label,
  frame,
  fps,
  px,
  atFrame,
}: {
  label: string
  frame: number
  fps: number
  px: (n: number) => number
  /** Frame the hand-over happens on. */
  atFrame: number
}) {
  const t = (frame - atFrame) / fps
  const ease = Easing.bezier(0.42, 0, 0.58, 1)
  // Owner: it dissolved too fast. In over 1.2s, hold 2.2s, then a long 2.4s
  // way out — the word should leave the way mist does, not the way a cut does.
  const opacity = interpolate(t, [-0.2, 1.2, 3.4, 5.8], [0, 0.15, 0.15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  })
  const blur = interpolate(t, [-0.2, 1.2, 3.4, 5.8], [26, 0, 0, 26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  })
  const scale = interpolate(t, [-0.2, 5.8], [1.06, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  if (opacity <= 0.002) return null
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: "'Literata', Georgia, serif",
          fontWeight: 600,
          fontSize: px(126),
          lineHeight: 1,
          letterSpacing: px(7),
          // Gold, not white (owner picked it): white read as light ON the
          // picture, gold reads as a word surfacing FROM it.
          color: "#f2c46b",
          opacity,
          filter: `blur(${blur.toFixed(2)}px)`,
          // Optically centred, not box-centred: a serif's em box has more
          // room above the caps than below the baseline, so a box-centred word
          // reads as sitting low (owner spotted it). Lift by 0.08em.
          transform: `translateY(-0.08em) scale(${scale.toFixed(3)})`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  )
}

export const StepsPreview = () => {
  loadShortFonts()
  loadLiterata()
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const px = (n: number) => (n * Math.min(width, height)) / 390
  // WATCH runs 5s, REFLECT 6s, PRAY to the end — the shape of a real piece,
  // compressed so the two hand-overs can be judged in one preview.
  const watchStart = 0
  const reflectStart = Math.round(5 * fps)
  const prayStart = Math.round(12 * fps)
  const endFrame = Math.round(18 * fps)
  // The picture blurs while the step changes hands and clears again as the
  // next stage settles.
  const blurAt = (at: number) =>
    interpolate(
      frame,
      [at - 0.4 * fps, at + 0.7 * fps, at + 3.6 * fps, at + 5.6 * fps],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    )
  const blurAmount = Math.max(blurAt(reflectStart), blurAt(prayStart))
  return (
    <AbsoluteFill style={{ background: "#0c0805" }}>
      <AbsoluteFill>
        <Img
          src={staticFile("steps-preview-bg.jpg")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `blur(${(blurAmount * 18).toFixed(2)}px) brightness(${(1 - 0.25 * blurAmount).toFixed(3)})`,
            transform: "scale(1.06)",
          }}
        />
      </AbsoluteFill>
      <BigStepWord
        label="REFLECT"
        frame={frame}
        fps={fps}
        px={px}
        atFrame={reflectStart}
      />
      {/* A soft band of blur under the row: the labels are small and thin, and
          a busy frame behind them costs legibility (owner). It fades out
          downwards so there is no visible edge. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: px(62),
          backdropFilter: `blur(${px(5).toFixed(1)}px)`,
          WebkitBackdropFilter: `blur(${px(5).toFixed(1)}px)`,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.34), rgba(0,0,0,0))",
          maskImage: "linear-gradient(to bottom, #000 55%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, #000 55%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      {/* The row sits at the top, spanning the reflection text's own column. */}
      <div style={{ position: "absolute", top: px(24), left: 0, right: 0 }}>
        <StepProgressLine
          steps={["WATCH", "REFLECT", "PRAY"]}
          starts={[watchStart, reflectStart, prayStart]}
          endFrame={endFrame}
          frame={frame}
          fps={fps}
          px={px}
          widthPx={px(287)}
        />
      </div>
    </AbsoluteFill>
  )
}
