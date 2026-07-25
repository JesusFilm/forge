import { AbsoluteFill, OffthreadVideo } from "remotion"

import { SHORT_HEIGHT, SHORT_WIDTH } from "../../schema"

type SourceVideoProps = {
  clipUrl: string
  mode: "fill" | "frame"
}

// Downscaled-blur technique (plan decision 14 / perf C3): render the blurred
// background copy into a small container and CSS-scale it up to cover the
// canvas. Blurring ~270x480 pixels then upscaling is visually equivalent to
// a full-res blur and ~16x cheaper per frame.
const BLUR_CONTAINER_WIDTH = 270
const BLUR_CONTAINER_HEIGHT = 480
// Scale factor with headroom so rounding can never expose canvas edges.
const BLUR_SCALE = (SHORT_HEIGHT / BLUR_CONTAINER_HEIGHT) * 1.05

export const SourceVideo = ({ clipUrl, mode }: SourceVideoProps) => {
  if (mode === "fill") {
    // Focus: center-crop — video scaled to cover the 1080x1920 canvas.
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <OffthreadVideo
          src={clipUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    )
  }

  // Frame: letterboxed at native aspect over a blurred, downscaled copy of
  // the same video. The background instance MUST be muted — two
  // OffthreadVideo instances would double the audio; the foreground copy
  // carries it.
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000000" }}>
      <div
        style={{
          position: "absolute",
          top: (SHORT_HEIGHT - BLUR_CONTAINER_HEIGHT) / 2,
          left: (SHORT_WIDTH - BLUR_CONTAINER_WIDTH) / 2,
          width: BLUR_CONTAINER_WIDTH,
          height: BLUR_CONTAINER_HEIGHT,
          transform: `scale(${BLUR_SCALE})`,
          overflow: "hidden",
        }}
      >
        <OffthreadVideo
          muted
          src={clipUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.7)",
          }}
        />
      </div>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <OffthreadVideo
          src={clipUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
