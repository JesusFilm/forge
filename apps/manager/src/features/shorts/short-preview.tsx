"use client"

// Remotion <Player> preview wrapper. ALWAYS loaded via next/dynamic with
// ssr:false from the detail screen — this module pulls remotion/react
// renderer code that must stay out of the server bundle (plan "UI").
//
// Perf rules (plan): the parent memoizes inputProps and debounces text-input
// commits before they reach this component; the Player is NEVER keyed by
// draftVersion — a remount resets playback and refetches the waveform's
// audio windows.

import React from "react"
import { Player } from "@remotion/player"
import { ShortComposition } from "@forge/shorts-compositions"
import type { ShortInputProps } from "@forge/shorts-compositions/schema"
import { SHORT_HEIGHT, SHORT_WIDTH } from "@forge/shorts-compositions/schema"

export default function ShortPreview({
  inputProps,
}: {
  inputProps: ShortInputProps
}) {
  const durationInFrames = Math.max(
    1,
    Math.round(inputProps.clipDurationSec * inputProps.fps),
  )

  return (
    <Player
      component={ShortComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={inputProps.fps}
      compositionWidth={SHORT_WIDTH}
      compositionHeight={SHORT_HEIGHT}
      controls
      // JFP is a non-profit — free Remotion license per LICENSE.md (plan
      // decision 13); this silences the console notice.
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: "9 / 16", maxHeight: 640 }}
      renderLoading={() => (
        <p className="small jobs-empty-state">Loading preview…</p>
      )}
    />
  )
}
