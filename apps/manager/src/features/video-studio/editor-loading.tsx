import {
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  StepBack,
  StepForward,
} from "lucide-react"
import { EditorHeader } from "./editor-header"

/** Layout only: no project, editing session, recovery writes or media requests. */
export function EditorLoading() {
  return (
    <div className="nle-editor nle-editor-loading" aria-busy="true">
      <span className="sr-only" role="status">
        Loading project
      </span>
      <EditorHeader state={null} />
      <div className="nle-editing-space">
        <div className="nle-preview-pane">
          <div className="nle-workspace">
            <section className="nle-stage" aria-label="Preview">
              <div className="nle-canvas-space" />
              <div className="nle-transport" aria-label="Preview playback">
                <input
                  className="nle-preview-scrubber"
                  type="range"
                  aria-label="Preview position"
                  min={0}
                  max={1}
                  value={0}
                  disabled
                  readOnly
                />
                <div className="nle-transport-buttons">
                  {(
                    [
                      [SkipBack, "Go to start"],
                      [StepBack, "Previous frame"],
                      [Square, "Stop"],
                      [Play, "Play"],
                      [StepForward, "Next frame"],
                      [SkipForward, "Go to end"],
                      [Repeat, "Loop playback"],
                    ] as const
                  ).map(([Icon, label]) => (
                    <button key={label} aria-label={label} disabled>
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <aside className="nle-inspector">
              <p className="nle-muted">Nothing to inspect</p>
            </aside>
          </div>
        </div>
        <div className="nle-timeline-pane" style={{ height: "40%" }}>
          <section className="nle-timeline" aria-label="Timeline">
            <div className="nle-timeline-toolbar">
              <strong>Timeline</strong>
            </div>
            <div className="nle-timeline-scroll">
              <div className="nle-track-labels" aria-hidden="true">
                <div />
                <div>Visual</div>
                <div>Audio</div>
              </div>
              <div className="nle-loading-tracks" aria-hidden="true">
                <div className="nle-ruler" />
                <div className="nle-track" />
                <div className="nle-track" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
