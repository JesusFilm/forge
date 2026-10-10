import type { CalculateMetadataFunction } from "remotion"

import type { ShortInputProps } from "./schema"

// Duration is driven by the server-injected clip metadata: the composition
// always spans the full pre-trimmed clip.
export const calculateShortMetadata: CalculateMetadataFunction<
  ShortInputProps
> = ({ props }) => ({
  durationInFrames: Math.max(1, Math.round(props.clipDurationSec * props.fps)),
  fps: props.fps,
})
