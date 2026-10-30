"use client"

import {
  SkipBack,
  StepBack,
  Square,
  Play,
  Pause,
  StepForward,
  SkipForward,
  Repeat,
} from "lucide-react"
import type { EditorSession, EditorSnapshot } from "./editor-session"

export function PreviewTransport({
  session,
  state,
  playing,
  onPlaying,
  looping,
  onLooping,
}: {
  session: Pick<EditorSession, "seek">
  state: EditorSnapshot
  playing: boolean
  onPlaying: (value: boolean) => void
  looping: boolean
  onLooping: (value: boolean) => void
}) {
  const last = state.document.durationInFrames - 1
  function seek(frame: number) {
    onPlaying(false)
    session.seek(frame)
  }
  return (
    <div className="nle-transport" role="group" aria-label="Preview playback">
      <input
        className="nle-preview-scrubber"
        aria-label="Preview position"
        type="range"
        min={0}
        max={last}
        step={1}
        value={state.playhead}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <div className="nle-transport-buttons">
        <button
          aria-label="Go to start"
          title="Go to start"
          onClick={() => seek(0)}
        >
          <SkipBack size={16} />
        </button>
        <button
          aria-label="Previous frame"
          title="Previous frame"
          onClick={() => seek(state.playhead - 1)}
        >
          <StepBack size={16} />
        </button>
        <button aria-label="Stop" title="Stop" onClick={() => seek(0)}>
          <Square size={13} fill="currentColor" />
        </button>
        <button
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && state.playhead === last) session.seek(0)
            onPlaying(!playing)
          }}
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
        </button>
        <button
          aria-label="Next frame"
          title="Next frame"
          onClick={() => seek(state.playhead + 1)}
        >
          <StepForward size={16} />
        </button>
        <button
          aria-label="Go to end"
          title="Go to end"
          onClick={() => seek(last)}
        >
          <SkipForward size={16} />
        </button>
        <button
          aria-label="Loop playback"
          title="Loop playback"
          aria-pressed={looping}
          onClick={() => onLooping(!looping)}
        >
          <Repeat size={17} />
        </button>
      </div>
    </div>
  )
}
