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
  studioProjectSchema,
  studioDocumentSchema,
  type Short,
  type StudioApply,
  type StudioCommandResult,
  type StudioRevision,
} from "@forge/studio-contracts"
import { studioCall } from "./client"
import { EditorSession } from "./editor-session"
import { startEditorAutosave } from "./editor-autosave"
import { guardEditorNavigation } from "./editor-navigation"
import { Inspector } from "./inspector"
import { EditorHeader } from "./editor-header"
import { EditorLoading } from "./editor-loading"
import { useInspectorPreview } from "./use-inspector-preview"
import { InspectorSplit } from "./inspector-split"
import { Timeline } from "./timeline"
import { PreviewTransport } from "./preview-transport"
import { TimelineSplit } from "./timeline-split"
import { CanvasSelection } from "./canvas-selection"
import { ViewportFileDrop } from "./viewport-file-drop"
import { MediaDragProvider } from "./media-drag"
import "./studio.css"
const Library = dynamic(() => import("./library").then((m) => m.Library), {
  ssr: false,
})
const ProjectSettings = dynamic(
  () => import("./project-settings").then((m) => m.ProjectSettings),
  { ssr: false },
)
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
  handoff,
}: {
  projectId: string
  handoff?: import("./render-review-state").RenderHandoff
}) {
  const [session, setSession] = useState<EditorSession | null>(null),
    [error, setError] = useState("")
  useEffect(() => {
    let active = true
    studioCall<Short>("read", projectId)
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
    <Editor projectId={projectId} session={session} handoff={handoff} />
  ) : (
    <EditorLoading />
  )
}
function Editor({
  session,
  projectId,
  handoff,
}: {
  session: EditorSession
  projectId: string
  handoff?: import("./render-review-state").RenderHandoff
}) {
  const state = useSyncExternalStore(
      session.subscribe,
      session.getSnapshot,
      session.getSnapshot,
    ),
    doc = state.document
  const inspectorPreview = useInspectorPreview(state)
  const playbackRef = useRef<import("./preview").PreviewPlaybackHandle>(null)
  const [playing, updatePlaying] = useState(false),
    [looping, setLooping] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<StudioRevision[] | null>(null),
    [agentOpen, setAgentOpen] = useState(false),
    [renderOpen, setRenderOpen] = useState(Boolean(handoff)),
    [productionOpen, setProductionOpen] = useState(false),
    [generationOpen, setGenerationOpen] = useState(false),
    [workspace, setWorkspace] = useState<"preview" | "media">("preview"),
    [libraryOpened, setLibraryOpened] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const setPlaying = useCallback((value: boolean) => {
    if (!value) playbackRef.current?.pause()
    updatePlaying(value)
  }, [])
  const receiveFiles = useCallback(
    (files: File[]) => {
      setPlaying(false)
      setDroppedFiles((pending) => [...pending, ...files])
      setLibraryOpened(true)
      setWorkspace("media")
    },
    [setPlaying],
  )
  const consumeFiles = useCallback(
    (count: number) => setDroppedFiles((pending) => pending.slice(count)),
    [],
  )
  const report = useCallback((s: string) => setError(s), [])
  useEffect(() => startEditorAutosave(session), [session])
  useEffect(() => guardEditorNavigation(session, window, document), [session])
  useEffect(() => {
    try {
      if (!state.hasUnsavedChanges)
        sessionStorage.removeItem(`studio-recovery:${projectId}`)
      else
        sessionStorage.setItem(
          `studio-recovery:${projectId}`,
          JSON.stringify(session.recovery()),
        )
    } catch {
      /* Saving still works when browser recovery storage is unavailable. */
    }
  }, [
    state.document,
    state.revision,
    state.status,
    state.hasUnsavedChanges,
    projectId,
    session,
  ])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(
          "input,textarea,select,[contenteditable],[role=separator]",
        )
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
        if (workspace !== "preview") return
        e.preventDefault()
        setPlaying(!playing)
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [session, workspace, playing, setPlaying])
  async function showHistory() {
    try {
      setHistory(await studioCall("history", { projectId }))
    } catch (e) {
      report(e instanceof Error ? e.message : "History unavailable")
    }
  }
  return (
    <MediaDragProvider>
      <div className="nle-editor">
        <ViewportFileDrop enabled={state.editable} onFiles={receiveFiles} />
        <EditorHeader
          state={state}
          session={session}
          workspace={workspace}
          onWorkspaceChange={(next) => {
            setPlaying(false)
            if (next === "media") setLibraryOpened(true)
            setWorkspace(next)
          }}
          onSettings={() => {
            setPlaying(false)
            setSettingsOpen(true)
          }}
          onAssistant={() => setAgentOpen(true)}
          onScripts={() => setGenerationOpen(true)}
          onProduction={() => setProductionOpen(true)}
          onRender={() => setRenderOpen(true)}
          onHistory={showHistory}
        />
        {state.authenticationRequired && (
          <div className="nle-notice" role="alert">
            <span>
              {state.hasUnsavedChanges
                ? "Your changes are not saved — sign in again, then retry saving. Your edits are retained in this tab."
                : "Your session has expired — sign in again to continue. Your saved edits are safe."}
            </span>
            <a href="/login" target="_blank" rel="noopener noreferrer">
              Sign in again in a new tab
            </a>
          </div>
        )}
        {!state.authenticationRequired && (error || state.error) && (
          <div className="nle-notice" role="alert">
            <span>{state.error || error}</span>
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
        <TimelineSplit
          workspace={
            <>
              <div
                id="nle-media-panel"
                role="tabpanel"
                aria-labelledby="nle-media-tab"
                className="nle-workspace-panel"
                hidden={workspace !== "media"}
              >
                {libraryOpened && (
                  <Library
                    session={session}
                    state={state}
                    active={workspace === "media"}
                    incomingFiles={droppedFiles}
                    onIncomingFilesHandled={consumeFiles}
                  />
                )}
              </div>
              <div
                id="nle-preview-panel"
                role="tabpanel"
                aria-labelledby="nle-preview-tab"
                className="nle-workspace-panel"
                hidden={workspace !== "preview"}
              >
                <InspectorSplit
                  inspector={
                    <Inspector
                      session={session}
                      state={state}
                      onError={report}
                      onPreview={inspectorPreview.onPreview}
                    />
                  }
                >
                  <section className="nle-stage">
                    <div className="nle-canvas-space">
                      <div
                        className="nle-canvas"
                        style={{
                          aspectRatio: `${doc.width}/${doc.height}`,
                          width: `min(100cqw, ${(100 * doc.width) / doc.height}cqh)`,
                          height: `min(100cqh, ${(100 * doc.height) / doc.width}cqw)`,
                        }}
                      >
                        {workspace === "preview" && (
                          <Preview
                            projectId={projectId}
                            session={session}
                            state={inspectorPreview.state}
                            playbackRef={playbackRef}
                            looping={looping}
                            playing={playing}
                            onPlaying={setPlaying}
                          />
                        )}
                        <div onPointerDownCapture={() => setPlaying(false)}>
                          <CanvasSelection
                            session={session}
                            state={inspectorPreview.state}
                            onError={report}
                          />
                        </div>
                      </div>
                    </div>
                    <PreviewTransport
                      session={session}
                      state={state}
                      playing={playing}
                      onPlaying={setPlaying}
                      looping={looping}
                      onLooping={setLooping}
                    />
                  </section>
                </InspectorSplit>
              </div>
            </>
          }
        >
          <Timeline
            projectId={projectId}
            session={session}
            state={state}
            onError={report}
            onScrub={() => setPlaying(false)}
          />
        </TimelineSplit>
        {settingsOpen && (
          <ProjectSettings
            session={session}
            state={state}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {generationOpen && (
          <GenerationPanel
            session={session}
            projectId={projectId}
            onClose={() => setGenerationOpen(false)}
          />
        )}
        {renderOpen && (
          <RenderPanel
            handoff={handoff}
            session={session}
            projectId={projectId}
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
                      {revision.actor.id} ·{" "}
                      {revision.actor.authority ?? "legacy"}{" "}
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
    </MediaDragProvider>
  )
}
