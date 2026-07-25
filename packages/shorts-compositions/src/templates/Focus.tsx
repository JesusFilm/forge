import { AbsoluteFill } from "remotion"

import type { ShortInputProps } from "../schema"
import { CaptionPages } from "./primitives/CaptionPages"
import { SourceVideo } from "./primitives/SourceVideo"
import { Title } from "./primitives/Title"
import { Waveform } from "./primitives/Waveform"

// Focus: source center-cropped to fill 9:16; captions in the center band by
// default; waveform bar cluster bottom-center above the safe margin.
export const Focus = (props: ShortInputProps) => (
  <AbsoluteFill style={{ backgroundColor: "#000000" }}>
    <SourceVideo clipUrl={props.clipUrl} mode="fill" />
    {props.title ? <Title text={props.title} /> : null}
    {props.showCaptions && props.hasAudio ? (
      <CaptionPages
        pages={props.captionPages}
        accentColor={props.accentColor}
        captionPosition={props.captionPosition}
        captionFont={props.captionFont}
      />
    ) : null}
    {props.waveformStyle !== "none" && props.hasAudio ? (
      <Waveform clipUrl={props.clipUrl} accentColor={props.accentColor} />
    ) : null}
  </AbsoluteFill>
)
