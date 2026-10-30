"use client"
import {
  AudioLines,
  Check,
  ChevronDown,
  FilePenLine,
  History,
  Library,
  MonitorPlay,
  Redo2,
  Save,
  Settings,
  Sparkles,
  Undo2,
} from "lucide-react"
import type { EditorSession, EditorSnapshot } from "./editor-session"

type HeaderActions = {
  onWorkspaceChange: (workspace: "media" | "preview") => void
  onSettings: () => void
  onAssistant: () => void
  onScripts: () => void
  onProduction: () => void
  onRender: () => void
  onHistory: () => void
}

type HeaderProps =
  | (HeaderActions & {
      state: EditorSnapshot
      workspace: "media" | "preview"
      session: Pick<EditorSession, "undo" | "redo" | "save">
    })
  | ({ state: null; session?: never; workspace?: never } & Partial<
      Record<keyof HeaderActions, never>
    >)

export function EditorHeader({
  state,
  session,
  onWorkspaceChange,
  workspace,
  onSettings,
  onAssistant,
  onScripts,
  onProduction,
  onRender,
  onHistory,
}: HeaderProps) {
  const doc = state?.document
  const loading = !state
  const status = !state
    ? "Loading project…"
    : state.authenticationRequired
      ? "Sign in required"
      : state?.status === "saved"
        ? "Saved"
        : state?.status === "saving"
          ? "Saving…"
          : state?.status === "conflict"
            ? "Save conflict"
            : state?.status === "failed"
              ? "Save failed"
              : "Unsaved changes"
  const saveDisabled =
    !state?.editable ||
    state?.status === "saving" ||
    state?.status === "conflict"
  const attention =
    state?.authenticationRequired ||
    state?.status === "failed" ||
    state?.status === "conflict"
  const saveButton = (
    <button disabled={saveDisabled} onClick={() => void session?.save()}>
      <Save size={15} />
      {state?.status === "failed" ? "Retry save" : "Save now"}
    </button>
  )
  return (
    <header
      className="nle-editor-header"
      inert={loading}
      onBlur={(event) => {
        const menu = (event.target as HTMLElement).closest("details")
        if (menu && !menu.contains(event.relatedTarget as Node | null))
          menu.removeAttribute("open")
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("button"))
          target.closest("details")?.removeAttribute("open")
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        const menu = (event.target as HTMLElement).closest("details")
        if (!menu) return
        menu.removeAttribute("open")
        menu.querySelector("summary")?.focus()
      }}
    >
      <div className="nle-header-project-row">
        <h1 title={doc?.title}>{doc?.title ?? "Project"}</h1>
        <div className="nle-header-project-actions">
          <div className="nle-save-status" data-attention={attention}>
            {state?.status === "saved" && !state.authenticationRequired && (
              <Check size={14} />
            )}
            <span role="status">{status}</span>
          </div>
          {state?.status === "failed" && saveButton}
          <button
            aria-label="Version history"
            title="Version history"
            disabled={loading}
            onClick={onHistory}
          >
            <History size={16} />
          </button>
          <button
            aria-label="Project settings"
            title="Project settings"
            disabled={loading}
            onClick={onSettings}
          >
            <Settings size={16} />
          </button>
          <div className="nle-header-delivery">
            <button
              className="nle-primary"
              disabled={loading}
              onClick={onRender}
            >
              Render and publish
            </button>
            <details className="nle-header-menu nle-header-delivery-menu">
              <summary
                className="nle-primary"
                aria-label="Render and publish options"
              >
                <ChevronDown size={14} />
              </summary>
              <div className="nle-header-menu-panel">{saveButton}</div>
            </details>
          </div>
        </div>
      </div>
      <div className="nle-header-tools-row">
        <div className="nle-header-edit-actions">
          <div
            className="nle-workspace-tabs"
            role="tablist"
            aria-label="Editor workspace"
          >
            {(
              [
                ["media", "Media", Library],
                ["preview", "Preview", MonitorPlay],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                id={`nle-${id}-tab`}
                role="tab"
                aria-selected={(workspace ?? "preview") === id}
                aria-controls={`nle-${id}-panel`}
                disabled={loading}
                onClick={() => onWorkspaceChange?.(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <button
            title="Undo"
            aria-label="Undo"
            disabled={!state?.canUndo || !state.editable}
            onClick={() => session?.undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={!state?.canRedo || !state.editable}
            onClick={() => session?.redo()}
          >
            <Redo2 size={17} />
          </button>
        </div>
        <div className="nle-header-creation-actions">
          <button
            aria-label="Generate scripts"
            title="Generate scripts"
            disabled={loading}
            onClick={onScripts}
          >
            <FilePenLine size={15} />
            Scripts
          </button>
          <button disabled={loading} onClick={onProduction}>
            <AudioLines size={15} />
            Speech and production
          </button>
          <button disabled={loading} onClick={onAssistant}>
            <Sparkles size={15} />
            Assistant
          </button>
        </div>
      </div>
    </header>
  )
}
