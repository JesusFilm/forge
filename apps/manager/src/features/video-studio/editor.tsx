"use client"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  ArrowLeft,
  Play,
  Pause,
  Save,
  Undo2,
  Redo2,
  History,
  SkipBack,
  Maximize2,
} from "lucide-react"
import {
  studioProjectSchema,
  studioDocumentSchema,
  type StudioProject,
  type StudioApply,
  type StudioCommandResult,
  type StudioRevision,
} from "@forge/studio-contracts"
import { studioCall } from "./client"
import { EditorSession } from "./editor-session"
import { Inspector, defaultTransform } from "./inspector"
import { Timeline, itemLabel } from "./timeline"
import { Library } from "./library"
import "./studio.css"
const RenderPanel = dynamic(() => import("./render-panel"), { ssr: false })
const ProductionPanel = dynamic(() => import("./production-panel"), {
  ssr: false,
})
const GenerationPanel = dynamic(() => import("./generation-panel"), {
  ssr: false,
})
const AgentPanel = dynamic(() => import("./agent-panel"), { ssr: false })
const Preview = dynamic(() => import("./preview"), {
  ssr: false,
  loading: () => <div className="nle-preview-message">Loading preview…</div>,
})
export function StudioEditor({
  projectId,
  watchOrigin,
}: {
  projectId: string
  watchOrigin?: string
}) {
  const [session, setSession] = useState<EditorSession | null>(null),
    [error, setError] = useState("")
  useEffect(() => {
    let active = true
    studioCall<StudioProject>("read", projectId)
      .then((raw) => {
        if (!active) return
        const project = studioProjectSchema.parse(raw),
          s = new EditorSession(project, {
            read: async () =>
              studioProjectSchema.parse(await studioCall("read", projectId)),
            apply: (input: StudioApply) =>
              studioCall<StudioCommandResult>("apply", input),
          })
        try {
          const saved = sessionStorage.getItem(`studio-recovery:${projectId}`)
          if (saved) {
            const value = JSON.parse(saved)
            s.recover({
              ...value,
              document: studioDocumentSchema.parse(value.document),
            })
          }
        } catch {
          /* Ignore an invalid local recovery record. */
        }
        setSession(s)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [projectId])
  if (error)
    return (
      <section className="nle-empty" role="alert">
        <h1>Project unavailable</h1>
        <p>{error}</p>
        <Link href="/dashboard/shorts">Back to projects</Link>
      </section>
    )
  return session ? (
    <Editor projectId={projectId} session={session} watchOrigin={watchOrigin} />
  ) : (
    <p className="nle-empty">Opening project…</p>
  )
}
function Editor({
  session,
  projectId,
  watchOrigin,
}: {
  session: EditorSession
  projectId: string
  watchOrigin?: string
}) {
  const state = useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
      session.getSnapshot,
    ),
    doc = state.document
  const [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<StudioRevision[] | null>(null),
    [selectCanvas, setSelectCanvas] = useState(true),
    [agentOpen, setAgentOpen] = useState(false),
    [renderOpen, setRenderOpen] = useState(false),
    [productionOpen, setProductionOpen] = useState(false),
    [generationOpen, setGenerationOpen] = useState(false)
  const canvas = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: string
      x: number
      y: number
      original: typeof defaultTransform
    } | null>(null)
  const report = useCallback((s: string) => setError(s), [])
  useEffect(() => {
    try {
      if (state.status === "saved")
        sessionStorage.removeItem(`studio-recovery:${projectId}`)
      else
        sessionStorage.setItem(
          `studio-recovery:${projectId}`,
          JSON.stringify(session.recovery()),
        )
    } catch {
      /* Saving still works when browser recovery storage is unavailable. */
    }
  }, [state.document, state.revision, state.status, projectId, session])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input,textarea,select,[contenteditable]")
      )
        return
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        void session.save()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault()
        if (e.shiftKey) session.redo()
        else session.undo()
      }
      if (e.code === "Space") {
        e.preventDefault()
        setPlaying((v) => !v)
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [session])
  const selected = doc.items.find((i) => i.id === state.selection)
  async function showHistory() {
    try {
      setHistory(await studioCall("history", { projectId }))
    } catch (e) {
      report(e instanceof Error ? e.message : "History unavailable")
    }
  }
  return (
    <div className="nle-editor">
      <header className="nle-editor-header">
        <Link href="/dashboard/shorts" title="Back to projects">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1>{doc.title}</h1>
          <span>
            {doc.width} × {doc.height} · {doc.fps} fps
          </span>
        </div>
        <div className="nle-header-actions">
          <button
            title="Undo"
            aria-label="Undo"
            disabled={!state.canUndo || !state.editable}
            onClick={() => session.undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={!state.canRedo || !state.editable}
            onClick={() => session.redo()}
          >
            <Redo2 size={17} />
          </button>
          <button onClick={() => setAgentOpen(true)}>Assistant</button>
          <button onClick={() => setGenerationOpen(true)}>
            Generate scripts
          </button>
          <button onClick={() => setProductionOpen(true)}>
            Speech and production
          </button>
          <button onClick={() => setRenderOpen(true)}>
            Render and publish
          </button>
          <button onClick={showHistory}>
            <History size={16} />
            History
          </button>
          <span className="nle-save-status" role="status">
            {state.status === "saved"
              ? `Saved · r${state.revision}`
              : state.status === "saving"
                ? "Saving…"
                : state.status === "conflict"
                  ? "Save conflict"
                  : state.status === "failed"
                    ? "Save failed"
                    : "Unsaved changes"}
          </span>
          <button
            className="nle-primary"
            disabled={
              !state.editable ||
              state.status === "saving" ||
              state.status === "conflict"
            }
            onClick={() => void session.save()}
          >
            <Save size={15} />
            {state.status === "failed" ? "Retry save" : "Save"}
          </button>
        </div>
      </header>
      {(error || state.error) && (
        <div className="nle-notice" role="alert">
          <span>{error || state.error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {!state.editable && (
        <div className="nle-notice">
          This published project is permanently read-only.
        </div>
      )}
      {state.status === "conflict" && (
        <div className="nle-conflict">
          <strong>Another session saved a newer version.</strong>
          <p>
            Your version: {doc.title}. Saved version:{" "}
            {state.remote?.document.title ?? "Reload to compare"} (r
            {state.remote?.revision ?? "unknown"}).
          </p>
          <button onClick={() => void session.reload()}>
            Load saved version
          </button>
          <button
            disabled={!state.remote}
            onClick={() => void session.useLocalVersion()}
          >
            Replace with my reviewed version
          </button>
        </div>
      )}
      <div className="nle-workspace">
        <Library session={session} state={state} onError={report} />
        <section className="nle-stage">
          <div className="nle-stage-toolbar">
            <span>Canvas</span>
            <button
              aria-pressed={selectCanvas}
              onClick={() => setSelectCanvas((v) => !v)}
            >
              <Maximize2 size={13} />
              {selectCanvas ? "Select & move" : "Playback view"}
            </button>
          </div>
          <div className="nle-canvas-space">
            <div
              ref={canvas}
              className="nle-canvas"
              style={{ aspectRatio: `${doc.width}/${doc.height}` }}
            >
              <Preview
                projectId={projectId}
                session={session}
                state={state}
                playing={playing}
                onPlaying={setPlaying}
              />
              {selectCanvas && (
                <div className="nle-canvas-overlay">
                  {doc.items
                    .filter(
                      (i) =>
                        i.kind !== "audio" &&
                        state.playhead >= i.startFrame &&
                        state.playhead < i.startFrame + i.durationInFrames,
                    )
                    .map((i) => {
                      const t = i.transform ?? defaultTransform
                      return (
                        <button
                          aria-label={`Select ${itemLabel(i)}`}
                          key={i.id}
                          className="nle-canvas-item"
                          aria-pressed={selected?.id === i.id}
                          style={{
                            transform: `translate(${(t.x / doc.width) * 100}%,${(t.y / doc.height) * 100}%) rotate(${t.rotation}deg) scale(${t.scaleX},${t.scaleY})`,
                          }}
                          onClick={() => session.select(i.id)}
                          onPointerDown={(e) => {
                            if (!state.editable) return
                            session.select(i.id)
                            e.currentTarget.setPointerCapture(e.pointerId)
                            drag.current = {
                              id: i.id,
                              x: e.clientX,
                              y: e.clientY,
                              original: t,
                            }
                          }}
                          onPointerMove={(e) => {
                            if (!drag.current) return
                            e.currentTarget.style.translate = `${e.clientX - drag.current.x}px ${e.clientY - drag.current.y}px`
                          }}
                          onPointerUp={(e) => {
                            const a = drag.current
                            drag.current = null
                            e.currentTarget.style.translate = ""
                            if (!a || !canvas.current) return
                            const scale =
                              doc.width /
                              canvas.current.getBoundingClientRect().width
                            session.edit((d) => ({
                              ...d,
                              items: d.items.map((x) =>
                                x.id === a.id
                                  ? {
                                      ...x,
                                      transform: {
                                        ...a.original,
                                        x:
                                          a.original.x +
                                          (e.clientX - a.x) * scale,
                                        y:
                                          a.original.y +
                                          (e.clientY - a.y) * scale,
                                      },
                                    }
                                  : x,
                              ),
                            }))
                          }}
                          onPointerCancel={() => {
                            drag.current = null
                          }}
                        >
                          <span>{itemLabel(i).slice(0, 36)}</span>
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
          <div className="nle-transport">
            <button title="Go to start" onClick={() => session.seek(0)}>
              <SkipBack size={16} />
            </button>
            <button
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <output>
              {(state.playhead / doc.fps).toFixed(2)} /{" "}
              {(doc.durationInFrames / doc.fps).toFixed(2)}s
            </output>
            <input
              type="range"
              aria-label="Playhead"
              min={0}
              max={doc.durationInFrames - 1}
              value={state.playhead}
              onChange={(e) => session.seek(+e.target.value)}
            />
          </div>
        </section>
        <Inspector session={session} state={state} onError={report} />
      </div>
      <Timeline session={session} state={state} onError={report} />
      {generationOpen && (
        <GenerationPanel
          session={session}
          projectId={projectId}
          onClose={() => setGenerationOpen(false)}
        />
      )}
      {renderOpen && (
        <RenderPanel
          session={session}
          projectId={projectId}
          watchOrigin={watchOrigin}
          onClose={() => setRenderOpen(false)}
        />
      )}
      {productionOpen && (
        <ProductionPanel
          key={projectId}
          session={session}
          projectId={projectId}
          onClose={() => setProductionOpen(false)}
        />
      )}
      {agentOpen && (
        <AgentPanel
          session={session}
          projectId={projectId}
          onClose={() => setAgentOpen(false)}
        />
      )}
      {history && (
        <div className="nle-dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Revision history"
            className="nle-dialog"
          >
            <header>
              <h2>Revision history</h2>
              <button onClick={() => setHistory(null)}>Close</button>
            </header>
            {history.map((revision) => (
              <div className="nle-history-row" key={revision.revision}>
                <div>
                  <strong>Revision {revision.revision}</strong>
                  <p>
                    {revision.document.title} · {revision.actor.kind}:{" "}
                    {revision.actor.id} · {revision.actor.authority ?? "legacy"}{" "}
                    {revision.actor.clientId ?? ""}
                  </p>
                </div>
                <button
                  disabled={!state.editable}
                  onClick={() => {
                    session.edit(() => revision.document)
                    setHistory(null)
                  }}
                >
                  Restore as draft
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
