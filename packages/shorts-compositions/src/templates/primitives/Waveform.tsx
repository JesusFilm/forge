import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils"
import { useCurrentFrame, useVideoConfig } from "remotion"

type WaveformProps = {
  clipUrl: string
  accentColor: string
}

const NUMBER_OF_SAMPLES = 32
const BAR_WIDTH = 6
const BAR_GAP = 4
const MAX_BAR_HEIGHT = 72
const MIN_BAR_HEIGHT = 6
// Bottom edge of the bar cluster: just above the bottom safe area (320px).
const WAVEFORM_BOTTOM = 340

// This component must only be MOUNTED when the clip has audio (hasAudio) —
// the hook then runs unconditionally inside, satisfying the rules of hooks.
// useWindowedAudioData fetches via the browser, which is why the worker
// serves the clip from a loopback static server (plan decision 7).
export const Waveform = ({ clipUrl, accentColor }: WaveformProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: clipUrl,
    frame,
    fps,
    windowInSeconds: 30,
  })

  if (!audioData) return null

  const amplitudes = visualizeAudio({
    audioData,
    frame,
    fps,
    numberOfSamples: NUMBER_OF_SAMPLES,
    dataOffsetInSeconds,
  })

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: WAVEFORM_BOTTOM,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        gap: BAR_GAP,
        height: MAX_BAR_HEIGHT,
        opacity: 0.9,
      }}
    >
      {amplitudes.map((amplitude, index) => (
        <div
          key={index}
          style={{
            width: BAR_WIDTH,
            height:
              MIN_BAR_HEIGHT +
              Math.min(1, amplitude) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT),
            borderRadius: BAR_WIDTH / 2,
            // accentColor is schema-pinned hex; white/accent vertical mix.
            backgroundImage: `linear-gradient(to top, ${accentColor}, #ffffff)`,
          }}
        />
      ))}
    </div>
  )
}
