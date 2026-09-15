"use client"

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"

import { cn } from "@/lib/cn"
import { type RenameConversationResult } from "@/lib/conversation-session"
import {
  CONVERSATION_TITLE_MAX_UNITS,
  fallbackTitle,
  normalizeConversationTitle,
  type Conversation,
} from "@/lib/conversations"
import { type RenameHistoryFailureReason } from "@/lib/history-client"

import { PencilIcon } from "./icons"
import { type CollapsedStyles } from "./sidebar-collapsed-styles"
import { type HistoryListUi } from "./sidebar-projection"

type ConversationListProps = {
  conversations: Conversation[]
  activeId: string
  pendingIds: ReadonlySet<string>
  /** feat-450: rows with a rename write in flight (pencil disabled, R3). */
  renamingIds: ReadonlySet<string>
  /** feat-450 (R2): the rename affordance exists only on a granted shell. */
  grantedShell: boolean
  styles: CollapsedStyles
  history: HistoryListUi
  onSelect: (id: string) => void
  onCloseMobile: () => void
  onRetryHistory: () => void
  onLoadMore: () => void
  onRename: (id: string, draft: string) => Promise<RenameConversationResult>
}

/** The failure reasons the editor renders inline; `not_available` closes the
 * editor instead (the row takes the muted presentation, AE7). */
type RenameNotice = Exclude<RenameHistoryFailureReason, "not_available">

// Component-local editor view state (KTD9): one row at a time. The DRAFT
// lives in the editor child, initialized once on entry (R17).
type EditorState = {
  id: string
  phase: "editing" | "saving" | "failed"
  failure?: RenameNotice
}

// Exhaustive per-reason copy (KTD9) — the message-list `failureNotice`
// pattern: a raw reason token never reaches the DOM.
function renameFailureNotice(reason: RenameNotice): string {
  switch (reason) {
    case "access":
      return "Your access has changed. Sign in again to check."
    case "invalid_title":
      return "That name can't be used. Try different text."
    case "unavailable":
      return "Couldn't rename. Try again."
  }
}

// Focus-return guard (KTD9): the re-mounted select button must be connected
// and visible. `checkVisibility` is the browser's layout answer; jsdom has
// neither layout nor the method, so the fallback keeps its assertions honest.
function canReceiveFocus(el: HTMLElement | undefined): el is HTMLElement {
  if (el === undefined || !el.isConnected) return false
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true
}

function displayTitleFor(conversation: Conversation): string {
  // Untitled server threads (title "" — pre-existing, generation pending, or
  // generation failed) get the date-derived label (AE6).
  return conversation.title.trim().length > 0
    ? conversation.title
    : fallbackTitle(conversation.lastActivityAt ?? "")
}

// The row's pulsing dot with its sr-only label — one markup for the Replying
// (send in flight) and Saving (rename in flight) states.
function PulseDot({ marker, label }: { marker: string; label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        {...{ [`data-${marker}`]: "true" }}
        className="size-1.5 shrink-0 rounded-full bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
      />
      <span className="sr-only">{label}</span>
    </>
  )
}

type RenameEditorProps = {
  /** Prefill; empty for an untitled row, whose label becomes the placeholder. */
  initialValue: string
  placeholder: string | undefined
  saving: boolean
  failure: RenameNotice | undefined
  /** Parent-owned so the list's focus latch can target the input. */
  inputRef: RefObject<HTMLInputElement | null>
  onSubmit: (draft: string) => void
  /** Escape returns focus to the row's select button; blur leaves focus where
   * the person put it (KTD9). */
  onCancel: (via: "escape" | "blur") => void
}

/**
 * The inline rename editor (KTD9). The draft is component state initialized
 * ONCE on entry, so a server title landing mid-edit never touches it (R17).
 * Enter submits, Escape cancels, blur before submit cancels; while saving
 * the input is read-only, Enter is a no-op and blur is ignored. The input
 * carries `data-escape-owner` so the drawer's Escape listener ignores it by
 * target (KTD10).
 */
function RenameEditor({
  initialValue,
  placeholder,
  saving,
  failure,
  inputRef,
  onSubmit,
  onCancel,
}: RenameEditorProps) {
  const [draft, setDraft] = useState(initialValue)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      if (!saving) onSubmit(draft)
    } else if (event.key === "Escape") {
      event.preventDefault()
      if (!saving) onCancel("escape")
    }
  }

  return (
    <div className="flex flex-col gap-1 px-3.5 py-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          name="conversationName"
          value={draft}
          placeholder={placeholder}
          maxLength={CONVERSATION_TITLE_MAX_UNITS}
          readOnly={saving}
          aria-label="Conversation name"
          aria-invalid={failure !== undefined ? true : undefined}
          data-escape-owner="rename"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!saving) onCancel("blur")
          }}
          className="min-w-0 flex-1 rounded-md border border-linen/20 bg-hearthblack px-2 py-1 text-sm text-linen outline-none placeholder:text-ash focus:border-linen/40 read-only:opacity-70"
        />
        {saving ? <PulseDot marker="saving" label="Saving" /> : null}
      </div>
      {failure !== undefined ? (
        <p role="alert" className="text-xs text-ash">
          {renameFailureNotice(failure)}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The conversation history rail: a labeled nav whose rows select a conversation
 * (and close the mobile drawer). The active row is highlighted; a row awaiting a
 * reply shows a pulsing dot. Hidden entirely when the desktop rail is collapsed.
 *
 * feat-241 additions, all presentational: a polite loading skeleton while the
 * server history hydrates, an error state with retry, a Load-more control with
 * inline pending/retry (already-rendered rows always stay), date-derived
 * fallback labels for untitled server threads (R11), and a muted presentation
 * (+ sr-only note) for rows whose transcript is no longer available. An empty
 * server list renders nothing extra — today's client-only look (R16).
 *
 * feat-450 (KTD8/KTD9): each `<li>` is a flex row holding the select button
 * and, on a granted shell, a pencil button named "Rename <title>" that opens
 * an inline editor in place of both. The pencil is revealed on hover and
 * focus-within where a hover pointer exists and is always visible on coarse
 * pointers and in the drawer (class contract — Tailwind v4's `hover:` is
 * `(hover: hover)`-scoped). Editor view state is component-local, one row at
 * a time; the write itself is the session's pessimistic `onRename`.
 *
 * feat-401 makes a FULLY empty list reachable for the first time, by three
 * paths: a first-time signed-in user with no server history, and either
 * access-denial revert (list or replay), which empties a rail the user just
 * saw populated. Decided for all three: leave it bare — no empty-state copy,
 * no reserved space. The chat pane beside it already answers "what now?"
 * ("What would you like to ask?"), so a second empty-state message a few
 * pixels away only restates it, and the rail's own affordance is the New
 * action directly above; the denial paths additionally want R16 silence.
 * That same pane is also why nothing marks `aria-current` while the open
 * conversation is unstarted: the pane, not a highlighted row, is the
 * indication. Revisit only if the rail gains a purpose beyond history.
 */
export function ConversationList({
  conversations,
  activeId,
  pendingIds,
  renamingIds,
  grantedShell,
  styles,
  history,
  onSelect,
  onCloseMobile,
  onRetryHistory,
  onLoadMore,
  onRename,
}: ConversationListProps) {
  const [editor, setEditorState] = useState<EditorState | null>(null)
  // Synchronous mirror of `editor` so an awaited rename can tell whether it
  // still owns the editor when it settles (the identity check below).
  const editorRef = useRef<EditorState | null>(null)
  const setEditor = (next: EditorState | null) => {
    editorRef.current = next
    setEditorState(next)
  }
  // Focus hand-off latches (the hidden-subtree law): armed INSIDE the handler
  // that changes what is mounted, consumed by the effect below — never a bare
  // effect on the editing state, which would steal focus on first paint.
  const focusInputRef = useRef(false)
  const focusSelectRef = useRef<string | null>(null)
  const editorInputRef = useRef<HTMLInputElement | null>(null)
  const selectButtons = useRef(new Map<string, HTMLButtonElement>())

  // Consume the latches after the commit that mounted the target: into the
  // input on entry (pencil handler armed it), back to the row's select
  // button once the editor has closed — Enter-commit and Escape-cancel only.
  useEffect(() => {
    if (editor !== null) {
      if (!focusInputRef.current) return
      focusInputRef.current = false
      editorInputRef.current?.focus()
      return
    }
    const id = focusSelectRef.current
    if (id === null) return
    focusSelectRef.current = null
    const button = selectButtons.current.get(id)
    if (canReceiveFocus(button)) button.focus()
  }, [editor])

  const startEditing = (id: string) => {
    focusInputRef.current = true
    setEditor({ id, phase: "editing" })
  }

  const cancelEditing = (id: string, returnFocus: boolean) => {
    if (returnFocus) focusSelectRef.current = id
    setEditor(null)
  }

  const submitEditing = async (conversation: Conversation, draft: string) => {
    const normalized = normalizeConversationTitle(draft)
    // KD4: an empty or unchanged submit cancels quietly — no request.
    if (normalized.length === 0 || normalized === conversation.title) {
      cancelEditing(conversation.id, true)
      return
    }
    setEditor({ id: conversation.id, phase: "saving" })
    const result = await onRename(conversation.id, draft)
    // Identity check: a pencil on ANOTHER row may have replaced this editor
    // while the write was in flight — a stale settle must not touch it.
    const current = editorRef.current
    if (current?.id !== conversation.id || current.phase !== "saving") return
    // Return focus only while the editor still holds it (blur is ignored
    // while saving, so the person may have moved on to the composer).
    const hadFocus =
      editorInputRef.current !== null &&
      document.activeElement === editorInputRef.current
    if (result.ok) {
      cancelEditing(conversation.id, hadFocus)
    } else if (result.reason === "not_available") {
      // AE7: the session marked the row; the affordance leaves with it.
      cancelEditing(conversation.id, hadFocus)
    } else {
      setEditor({
        id: conversation.id,
        phase: "failed",
        failure: result.reason,
      })
    }
  }

  return (
    <nav
      aria-label="Conversations"
      // pt-1.5 (with mt-2.5 — the old mt-4's 16px, split) gives the first
      // row's 4px focus ring room inside this scroll container: without it
      // the ring's top edge is clipped when focus returns after a rename.
      className={cn(
        "mt-2.5 flex-1 overflow-y-auto px-3 pt-1.5 pb-5",
        styles.nav,
      )}
    >
      <ul className="flex flex-col gap-0.5">
        {conversations.map((conversation) => {
          const active = conversation.id === activeId
          const replying = pendingIds.has(conversation.id)
          const renaming = renamingIds.has(conversation.id)
          const notAvailable = conversation.replay === "not_available"
          const displayTitle = displayTitleFor(conversation)
          const editing = editor?.id === conversation.id ? editor : null
          if (editing !== null) {
            return (
              <li key={conversation.id} className="flex flex-col">
                <RenameEditor
                  initialValue={conversation.title}
                  placeholder={
                    conversation.title.trim().length > 0
                      ? undefined
                      : displayTitle
                  }
                  saving={editing.phase === "saving"}
                  failure={editing.failure}
                  inputRef={editorInputRef}
                  onSubmit={(draft) => void submitEditing(conversation, draft)}
                  onCancel={(via) =>
                    cancelEditing(conversation.id, via === "escape")
                  }
                />
              </li>
            )
          }
          return (
            <li
              key={conversation.id}
              className="group flex items-center gap-0.5"
            >
              <button
                type="button"
                data-row-select="true"
                ref={(el) => {
                  if (el) selectButtons.current.set(conversation.id, el)
                  else selectButtons.current.delete(conversation.id)
                }}
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  onSelect(conversation.id)
                  onCloseMobile()
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors duration-300",
                  active
                    ? "bg-linen/[0.06] text-linen"
                    : "text-ash hover:bg-linen/[0.03] hover:text-linen",
                  notAvailable && "opacity-50",
                )}
                title={displayTitle}
              >
                <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                {notAvailable ? (
                  <span className="sr-only">(unavailable)</span>
                ) : null}
                {replying ? (
                  <PulseDot marker="replying" label="Replying" />
                ) : null}
              </button>
              {grantedShell && !notAvailable ? (
                <button
                  type="button"
                  aria-label={`Rename ${displayTitle}`}
                  disabled={replying || renaming}
                  onClick={() => startEditing(conversation.id)}
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ash transition-[opacity,color,background-color] duration-300 hover:bg-linen/[0.06] hover:text-linen focus-visible:opacity-100 disabled:opacity-30",
                    // Reveal on a hover pointer or keyboard focus within the
                    // row; always visible on coarse pointers and in the
                    // drawer (below md the rail IS the drawer).
                    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 max-md:opacity-100",
                  )}
                >
                  <PencilIcon className="size-4" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {history.loading ? (
        // Polite announcement + a visual skeleton while the first page loads
        // (same aria treatment as replay loading in the chat pane).
        <div aria-live="polite" data-history="loading" className="mt-2 px-3.5">
          <span className="sr-only">Loading conversations</span>
          <div aria-hidden="true" className="flex flex-col gap-2">
            <span className="block h-4 w-4/5 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
            <span className="block h-4 w-3/5 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
            <span className="block h-4 w-2/3 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
          </div>
        </div>
      ) : null}

      {history.error ? (
        <div data-history="error" className="mt-2 flex flex-col gap-2 px-3.5">
          {/* role="alert" so AT users hear the failure, not just the loading
              announcement that preceded it. */}
          <p role="alert" className="text-xs text-ash">
            Your conversations couldn&apos;t be loaded.
          </p>
          <button
            type="button"
            onClick={onRetryHistory}
            className="self-start rounded-full border border-linen/15 px-3 py-1 text-xs text-linen transition-colors duration-300 hover:bg-linen/[0.06]"
          >
            Retry
          </button>
        </div>
      ) : null}

      {history.hasMore ? (
        <div
          data-history="load-more"
          className="mt-2 flex flex-col gap-1 px-3.5"
        >
          {history.loadMoreError ? (
            <p role="alert" className="text-xs text-ash">
              Couldn&apos;t load more.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLoadMore}
            disabled={history.loadingMore}
            className="self-start rounded-full border border-linen/15 px-3 py-1 text-xs text-linen transition-colors duration-300 hover:bg-linen/[0.06] disabled:opacity-50"
          >
            {history.loadingMore
              ? "Loading…"
              : history.loadMoreError
                ? "Retry"
                : "Load more"}
          </button>
        </div>
      ) : null}
    </nav>
  )
}
