import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion"

import { loadShortFonts } from "../fonts"
import { StepProgressLine } from "./StepProgressLine"

/**
 * A review-only composition: the step row alone, on the devotional's dark
 * ground, so the owner can judge the MOTION without a 10-minute film render.
 * Never shipped in a devotional; it exists so an animation can be approved in
 * a minute instead of after an encode (see the preview-before-render rule).
 */
export const STEPS_PREVIEW_ID = "devotional-steps-preview"

export const StepsPreview = () => {
  loadShortFonts()
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const px = (n: number) => (n * Math.min(width, height)) / 390
  // Three stages of four seconds each, as they would run in a devotional.
  const stage = Math.round(4 * fps)
  const starts = [0, stage, stage * 2]
  return (
    <AbsoluteFill style={{ background: "#0c0805" }}>
      {/* Where it sits in the real piece: just under the top edge. */}
      <div style={{ position: "absolute", top: px(26), left: 0, right: 0 }}>
        <StepProgressLine
          steps={["WATCH", "REFLECT", "PRAY"]}
          starts={starts}
          endFrame={stage * 3}
          frame={frame}
          fps={fps}
          px={px}
        />
      </div>
      {/* The same row at the size the step-connector cards use, centred. */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <StepProgressLine
          steps={["WATCH", "REFLECT", "PRAY"]}
          starts={starts}
          endFrame={stage * 3}
          frame={frame}
          fps={fps}
          px={px}
          size={19}
          railUnits={64}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
