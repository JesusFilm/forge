import { Composition } from "remotion"

import { calculateShortMetadata } from "./calculate-metadata"
import {
  SHORT_COMPOSITION_ID,
  SHORT_FPS,
  SHORT_HEIGHT,
  SHORT_WIDTH,
  shortInputPropsSchema,
  type ShortInputProps,
} from "./schema"
import { ShortComposition } from "./templates/ShortComposition"

// Placeholder defaults — real inputProps are always injected (manager for
// preview, worker for render). durationInFrames below is a placeholder too:
// calculateShortMetadata derives the real value from clipDurationSec * fps.
const defaultProps: ShortInputProps = {
  templateId: "focus",
  accentColor: "#f97316",
  captionPosition: "center",
  captionFont: "montserrat",
  waveformStyle: "bars",
  showCaptions: true,
  captionPages: [],
  clipUrl: "https://example.com/clip.mp4",
  fps: SHORT_FPS,
  clipDurationSec: 10,
  hasAudio: true,
}

export const Root = () => (
  <Composition
    id={SHORT_COMPOSITION_ID}
    component={ShortComposition}
    schema={shortInputPropsSchema}
    calculateMetadata={calculateShortMetadata}
    width={SHORT_WIDTH}
    height={SHORT_HEIGHT}
    fps={SHORT_FPS}
    durationInFrames={300}
    defaultProps={defaultProps}
  />
)
