import { Composition } from "remotion"

import { calculateDevotionalMetadata } from "./calculate-metadata"
import { DevotionalVideo } from "./DevotionalVideo"
import {
  DEVOTIONAL_COMPOSITION_ID,
  DEVOTIONAL_FPS,
  DEVOTIONAL_HEIGHT,
  DEVOTIONAL_WIDE_COMPOSITION_ID,
  DEVOTIONAL_WIDE_HEIGHT,
  DEVOTIONAL_WIDE_WIDTH,
  DEVOTIONAL_WIDTH,
  devotionalInputPropsSchema,
  type DevotionalInputProps,
} from "./schema"

// Placeholder defaults; real inputProps are always injected at render time and
// calculateDevotionalMetadata derives the true duration from audioDurationSec.
const defaultProps = {
  headerDate: "Dec 25",
  cards: [
    {
      kind: "cover",
      title: "What if God came close enough to be held?",
      durationSec: 6,
    },
    {
      kind: "scripture",
      verse: "…",
      citation: "John 1:14 · NASB",
      durationSec: 8,
    },
  ],
  audioDurationSec: 14,
  style: "grain",
  // NOTE: intentionally NOT setting `layout` here. Remotion merges defaultProps
  // into inputProps, so pinning a layout would override the filter's native
  // layout whenever a render omits `--layout`. Leaving it unset lets
  // resolveDevotionalStyle fall back to each filter's native layout.
  showMuteButton: true,
  musicVolume: 0.28,
  textAnim: "block",
  filmTreatment: false,
  bgAudio: false,
} as DevotionalInputProps

export const DevotionalRoot = () => (
  <>
    <Composition
      id={DEVOTIONAL_COMPOSITION_ID}
      component={DevotionalVideo}
      schema={devotionalInputPropsSchema}
      calculateMetadata={calculateDevotionalMetadata}
      width={DEVOTIONAL_WIDTH}
      height={DEVOTIONAL_HEIGHT}
      fps={DEVOTIONAL_FPS}
      durationInFrames={900}
      defaultProps={defaultProps}
    />
    {/* Desktop/YouTube 16:9 — same component; layout adapts by orientation. */}
    <Composition
      id={DEVOTIONAL_WIDE_COMPOSITION_ID}
      component={DevotionalVideo}
      schema={devotionalInputPropsSchema}
      calculateMetadata={calculateDevotionalMetadata}
      width={DEVOTIONAL_WIDE_WIDTH}
      height={DEVOTIONAL_WIDE_HEIGHT}
      fps={DEVOTIONAL_FPS}
      durationInFrames={900}
      defaultProps={defaultProps}
    />
  </>
)
