"use client"
import { useState } from "react"
import type { StudioDocument } from "@forge/studio-contracts"
import type { EditorSnapshot } from "./editor-session"
import Preview from "./preview"
export default function ProposalPreview({
  document,
  projectId,
}: {
  document: StudioDocument
  projectId: string
}) {
  const [state, setState] = useState<EditorSnapshot>({
      document,
      revision: 1,
      selection: null,
      playhead: 0,
      status: "saved",
      error: null,
      remote: null,
      canUndo: false,
      canRedo: false,
      editable: false,
    }),
    [playing, setPlaying] = useState(false)
  const session = {
    edit: (change: (document: StudioDocument) => StudioDocument) =>
      setState((previous) => ({
        ...previous,
        document: change(structuredClone(previous.document)),
      })),
    seek: (frame: number) =>
      setState((previous) => ({
        ...previous,
        playhead: Math.max(
          0,
          Math.min(frame, previous.document.durationInFrames - 1),
        ),
      })),
  }
  return (
    <section aria-label="Proposed composition preview">
      <div
        className="nle-proposal-canvas"
        style={{
          aspectRatio: `${document.width} / ${document.height}`,
          width: `min(100%, ${(60 * document.width) / document.height}vh)`,
        }}
      >
        <Preview
          session={session}
          state={state}
          projectId={projectId}
          playing={playing}
          onPlaying={setPlaying}
        />
      </div>
      <button onClick={() => setPlaying((value) => !value)}>
        {playing ? "Pause proposal" : "Play proposal"}
      </button>
      <input
        aria-label="Proposal playhead"
        type="range"
        min="0"
        max={state.document.durationInFrames - 1}
        value={state.playhead}
        onChange={(e) => session.seek(Number(e.target.value))}
      />
      <p>This preview has not applied the proposed edits.</p>
    </section>
  )
}
