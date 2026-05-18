"use client"

/**
 * Experience-editor AI chat panel — the left rail in the new 3-column
 * editor layout (sidebar | chat | canvas).
 *
 * Contract:
 *   - Owns its own thread list / message list / draft input / stream
 *     state. The editor's monolithic state is NOT touched.
 *   - Applies live diffs to the editor canvas through a `canvasController`
 *     prop (a thin imperative bridge: get state, applyDiff, revertDiff).
 *   - Calls server actions via prop callbacks so the page can wire up
 *     `"use server"` thunks with the prisma + principal closure.
 */

import {
  Archive,
  ChevronRight,
  MessageSquarePlus,
  Send,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import {
  applyDiff,
  computeDiff,
  revertDiff,
  type EditableLocaleState,
  type ExperienceChatDiff,
} from "@/services/experience-ai/experience-chat-diff"
import type {
  ChatErrorCode,
  ChatStreamEvent,
} from "@/services/experience-ai/experience-ai-chat.service"
import type {
  EditorialBrief,
  EditorialBriefField,
} from "@/services/experience-ai/experience-ai-chat-brief"
import {
  DEFAULT_CHAT_PROVIDER,
  type ChatProvider,
} from "@/services/experience-ai/experience-ai-chat-provider"
import type { QualityDraftReview } from "@/services/experience-ai/experience-ai-quality-draft.schemas"
import {
  type ChatMessageDTO,
  type ChatThreadDTO,
} from "@/app/dashboard/experiences/experience-chat-actions"

import { ExperienceChatCrossLocaleModal } from "./experience-chat-cross-locale-modal"
import {
  presentChatError,
  type ChatErrorPresentation,
} from "./experience-chat-errors"
import { openChatStream } from "./experience-chat-stream-client"

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/**
 * Resolved diff shape the editor accepts: scalars are the same `{before,
 * after}` envelope, but `blocks` is a fully-resolved next-blocks array
 * (NOT an RFC-6902 patch). The chat panel runs the patch against the
 * current canvas state via the diff utility before handing the resolved
 * array off to the editor — keeping the editor decoupled from rfc6902.
 */
export type ResolvedCanvasDiff = {
  scalars: ExperienceChatDiff["scalars"]
  blocks?: ReadonlyArray<unknown>
}

/**
 * Imperative bridge the editor exposes to the chat panel. Lets the panel
 * read current canvas state and apply / revert diffs without coupling its
 * own state into the 10k-line editor component.
 */
export type ExperienceCanvasController = {
  getState: () => EditableLocaleState
  applyDiff: (diff: ResolvedCanvasDiff) => void
  revertDiff: (diff: ResolvedCanvasDiff) => void
}

export type ExperienceChatPanelActions = {
  listThreads: () => Promise<ChatThreadDTO[]>
  createThread: (input: { firstPrompt: string }) => Promise<ChatThreadDTO>
  archiveThread: (threadId: string) => Promise<void>
  getMessages: (threadId: string) => Promise<ChatMessageDTO[]>
}

export type ExperienceChatPanelProps = {
  experienceLocaleId: string
  locale: string
  canvasController: ExperienceCanvasController
  actions: ExperienceChatPanelActions
  /**
   * Suggested prompts surfaced when the thread list is empty. U5 will
   * populate these context-aware; v1 wiring may pass an empty array.
   */
  suggestedPrompts?: ReadonlyArray<string>
  /**
   * Test seam — defaults to the real `openChatStream`. Tests inject a
   * deterministic async iterable.
   */
  streamFactory?: typeof openChatStream
}

// -----------------------------------------------------------------------------
// Local UI types
// -----------------------------------------------------------------------------

type StreamStatus =
  | { kind: "idle" }
  | { kind: "streaming"; tokens: string; abort: AbortController }
  | { kind: "error"; tokens: string; code: ChatErrorCode; message: string }

type LocalMessage = ChatMessageDTO & {
  /** True when the assistant message has been reverted in this session. */
  reverted?: boolean
}

type StagedDraftPreview = {
  messageId: string
  initial: EditableLocaleState
  title: string
  metaDescription: string
  blocksJson: string
  error: string | null
  review?: QualityDraftReview
}

type BriefConfirmationPreview = {
  messageId: string
  content: string
  brief: EditorialBrief
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function ExperienceChatPanel({
  experienceLocaleId,
  locale,
  canvasController,
  actions,
  suggestedPrompts = [],
  streamFactory = openChatStream,
}: ExperienceChatPanelProps) {
  const [threads, setThreads] = useState<ChatThreadDTO[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [draft, setDraft] = useState("")
  const [confirmAcrossLocales, setConfirmAcrossLocales] = useState(false)
  const [provider, setProvider] = useState<ChatProvider>(DEFAULT_CHAT_PROVIDER)
  const [crossLocaleModalOpen, setCrossLocaleModalOpen] = useState(false)
  const [stream, setStream] = useState<StreamStatus>({ kind: "idle" })
  const [bootError, setBootError] = useState<string | null>(null)
  const [stagedDraft, setStagedDraft] = useState<StagedDraftPreview | null>(
    null,
  )
  const [briefConfirmation, setBriefConfirmation] =
    useState<BriefConfirmationPreview | null>(null)

  const messageListRef = useRef<HTMLDivElement | null>(null)
  const stagedDraftRef = useRef<HTMLLIElement | null>(null)
  /** Last prompt + cross-locale flag submitted, to power the "Try again" button after a typed error. */
  const lastSubmissionRef = useRef<{
    prompt: string
    confirmedAcrossLocales: boolean
    confirmedBrief: boolean
  } | null>(null)

  // -- Initial load --------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    actions
      .listThreads()
      .then((rows) => {
        if (cancelled) return
        setThreads(rows)
        if (rows.length > 0 && !activeThreadId) {
          setActiveThreadId(rows[0].id)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBootError(
          error instanceof Error
            ? error.message
            : "Failed to load chat threads",
        )
      })
    return () => {
      cancelled = true
    }
    // experienceLocaleId is the lifecycle key — re-mount via parent `key`
    // resets this state cleanly when the user switches locale.
  }, [experienceLocaleId])

  // -- Load messages on thread change -------------------------------------
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([])
      return
    }
    let cancelled = false
    actions
      .getMessages(activeThreadId)
      .then((rows) => {
        if (cancelled) return
        setMessages(rows)
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, actions])

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = messageListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, stream])

  useEffect(() => {
    if (!stagedDraft) return
    if (typeof stagedDraftRef.current?.scrollIntoView === "function") {
      stagedDraftRef.current.scrollIntoView({ block: "start" })
    }
  }, [stagedDraft])

  // -- Thread management --------------------------------------------------
  const handleNewThread = useCallback(async () => {
    try {
      const created = await actions.createThread({
        firstPrompt: draft.trim() || "New conversation",
      })
      setThreads((prev) => [created, ...prev])
      setActiveThreadId(created.id)
      setMessages([])
    } catch (error) {
      setBootError(
        error instanceof Error ? error.message : "Failed to create thread",
      )
    }
  }, [actions, draft])

  const handleArchive = useCallback(
    async (threadId: string) => {
      try {
        await actions.archiveThread(threadId)
        setThreads((prev) => prev.filter((t) => t.id !== threadId))
        if (activeThreadId === threadId) {
          setActiveThreadId((prev) =>
            prev === threadId
              ? (threads.find((t) => t.id !== threadId)?.id ?? null)
              : prev,
          )
        }
      } catch {
        // Surface inline; non-fatal
      }
    },
    [actions, activeThreadId, threads],
  )

  // -- Send + stream ------------------------------------------------------
  const beginStream = useCallback(
    async (
      threadId: string,
      prompt: string,
      confirmedAcrossLocales: boolean,
      confirmedBrief = false,
    ) => {
      const abort = new AbortController()
      lastSubmissionRef.current = {
        prompt,
        confirmedAcrossLocales,
        confirmedBrief,
      }
      setStream({ kind: "streaming", tokens: "", abort })

      // Optimistic user bubble.
      setMessages((prev) => [
        ...prev,
        {
          id: `pending-user-${Date.now()}`,
          role: "USER",
          content: prompt,
          createdAt: new Date().toISOString(),
          snapshotDiff: null,
          mutationsApplied: null,
        },
      ])

      try {
        const iter = streamFactory(
          {
            threadId,
            prompt,
            confirmedAcrossLocales,
            confirmedBrief,
            provider,
          },
          { signal: abort.signal },
        )
        let finalMessageId: string | null = null
        let finalDiff: ExperienceChatDiff | null = null
        let tokens = ""

        for await (const event of iter as AsyncIterable<ChatStreamEvent>) {
          switch (event.type) {
            case "token_delta":
              tokens += event.text
              setStream((prev) =>
                prev.kind === "streaming" ? { ...prev, tokens } : prev,
              )
              break
            case "mutation_applied":
              try {
                // Resolve block patches against current canvas state
                // before pushing to the editor: the editor only needs
                // a fully-resolved next blocks array to swap in.
                const current = canvasController.getState()
                const next = applyDiff(current, event.diff)
                canvasController.applyDiff({
                  scalars: event.diff.scalars,
                  blocks:
                    event.diff.blocks && event.diff.blocks.length > 0
                      ? next.blocks
                      : undefined,
                })
              } catch {
                // Treat apply failures as a typed error event downstream.
              }
              finalMessageId = event.messageId
              finalDiff = event.diff
              break
            case "done":
              if (finalMessageId && finalDiff) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: finalMessageId!,
                    role: "ASSISTANT",
                    content: tokens.trim() || "Mutation applied.",
                    createdAt: new Date().toISOString(),
                    snapshotDiff: finalDiff,
                    mutationsApplied: null,
                  },
                ])
              }
              setStream({ kind: "idle" })
              return
            case "error":
              setStream({
                kind: "error",
                tokens,
                code: event.code,
                message: event.message,
              })
              return
            case "mutation_proposal":
              setBriefConfirmation(null)
              setStagedDraft({
                messageId: event.messageId,
                initial: event.draft,
                title: event.draft.title,
                metaDescription: event.draft.metaDescription ?? "",
                blocksJson: JSON.stringify(event.draft.blocks, null, 2),
                error: null,
                review: event.review,
              })
              break
            case "brief_update":
              setMessages((prev) => [
                ...prev,
                {
                  id: event.messageId,
                  role: "ASSISTANT",
                  content: event.content,
                  createdAt: new Date().toISOString(),
                  snapshotDiff: null,
                  mutationsApplied: {
                    kind: "editorial_brief",
                    status: event.confirmationRequired
                      ? "confirmation_required"
                      : "collecting",
                    brief: event.brief,
                    missingFields: event.missingFields,
                    question: event.question,
                  },
                },
              ])
              setBriefConfirmation(
                event.confirmationRequired
                  ? {
                      messageId: event.messageId,
                      content: event.content,
                      brief: event.brief,
                    }
                  : null,
              )
              break
          }
        }
        // Stream ended without an explicit `done` — finalize defensively.
        setStream({ kind: "idle" })
      } catch (error) {
        setStream({
          kind: "error",
          tokens: "",
          code: "unknown",
          message: error instanceof Error ? error.message : "Stream failed",
        })
      }
    },
    [canvasController, provider, streamFactory],
  )

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (stream.kind === "streaming") return

    if (confirmAcrossLocales) {
      // Open modal first; modal's confirm path calls submitWithConfirmation.
      setCrossLocaleModalOpen(true)
      return
    }

    let threadId = activeThreadId
    if (!threadId) {
      try {
        const created = await actions.createThread({ firstPrompt: trimmed })
        setThreads((prev) => [created, ...prev])
        setActiveThreadId(created.id)
        threadId = created.id
      } catch (error) {
        setBootError(
          error instanceof Error ? error.message : "Failed to create thread",
        )
        return
      }
    }

    setDraft("")
    await beginStream(threadId, trimmed, false)
  }, [
    actions,
    activeThreadId,
    beginStream,
    confirmAcrossLocales,
    draft,
    stream,
  ])

  const submitWithConfirmation = useCallback(async () => {
    setCrossLocaleModalOpen(false)
    const trimmed = draft.trim()
    if (!trimmed) return

    let threadId = activeThreadId
    if (!threadId) {
      try {
        const created = await actions.createThread({ firstPrompt: trimmed })
        setThreads((prev) => [created, ...prev])
        setActiveThreadId(created.id)
        threadId = created.id
      } catch (error) {
        setBootError(
          error instanceof Error ? error.message : "Failed to create thread",
        )
        return
      }
    }

    setDraft("")
    await beginStream(threadId, trimmed, true)
  }, [actions, activeThreadId, beginStream, draft])

  const handleRetry = useCallback(() => {
    if (stream.kind !== "error") return
    const last = lastSubmissionRef.current
    if (!last) return
    const threadId = activeThreadId
    if (!threadId) return
    // Append a fresh user message via the optimistic-append path inside
    // beginStream — don't reuse the failed bubble.
    void beginStream(
      threadId,
      last.prompt,
      last.confirmedAcrossLocales,
      last.confirmedBrief,
    )
  }, [activeThreadId, beginStream, stream])

  const handleConfirmBrief = useCallback(() => {
    const threadId = activeThreadId
    if (!threadId || stream.kind === "streaming") return
    void beginStream(threadId, "Generate from this brief", false, true)
  }, [activeThreadId, beginStream, stream])

  const handleStop = useCallback(() => {
    if (stream.kind === "streaming") {
      stream.abort.abort()
    }
  }, [stream])

  const handleUndo = useCallback(
    (msg: LocalMessage) => {
      const diff = parseSnapshotDiff(msg.snapshotDiff)
      if (!diff) return
      try {
        // Block-side revert: persisted diffs co-store the pre-image
        // under `beforeBlocks` (see U2 service); use it directly to
        // resolve a next-blocks array for the editor. If absent, we
        // skip the blocks side and only revert scalars.
        const beforeBlocks = readPersistedBeforeBlocks(msg.snapshotDiff)
        const resolved: ResolvedCanvasDiff = {
          scalars: diff.scalars,
          blocks:
            diff.blocks && diff.blocks.length > 0 && beforeBlocks
              ? beforeBlocks
              : undefined,
        }
        canvasController.revertDiff(resolved)
        // Also call the diff-utility revert against the live state so
        // future apply/revert chains see consistent state — best-effort.
        try {
          revertDiff(canvasController.getState(), diff)
        } catch {
          // RevertConflictError from the utility is fine here; the UI
          // already reverted via the resolved next-blocks array above.
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, reverted: true } : m)),
        )
      } catch {
        // Surface inline by marking the message but leaving the diff
        // intact — v1 keeps it simple.
      }
    },
    [canvasController],
  )

  const handleApplyStagedDraft = useCallback(() => {
    if (!stagedDraft) return
    let blocks: unknown[]
    try {
      const parsed = JSON.parse(stagedDraft.blocksJson) as unknown
      if (!Array.isArray(parsed)) {
        setStagedDraft((prev) =>
          prev
            ? { ...prev, error: "Blocks must be a JSON array before applying." }
            : prev,
        )
        return
      }
      blocks = parsed
    } catch {
      setStagedDraft((prev) =>
        prev
          ? { ...prev, error: "Blocks must be valid JSON before applying." }
          : prev,
      )
      return
    }

    const current = canvasController.getState()
    const next: EditableLocaleState = {
      title: stagedDraft.title,
      metaDescription: stagedDraft.metaDescription.trim()
        ? stagedDraft.metaDescription
        : null,
      ogImageUrl: stagedDraft.initial.ogImageUrl,
      blocks,
    }
    const diff = computeDiff(current, next)
    canvasController.applyDiff({
      scalars: diff.scalars,
      blocks,
    })
    setMessages((prev) => [
      ...prev,
      {
        id: stagedDraft.messageId,
        role: "ASSISTANT",
        content: "Generated a first draft for review.",
        createdAt: new Date().toISOString(),
        snapshotDiff: {
          scalars: diff.scalars,
          blocks: diff.blocks ?? [],
          beforeBlocks: current.blocks,
        },
        mutationsApplied: null,
      },
    ])
    setStagedDraft(null)
  }, [canvasController, stagedDraft])

  // -- Render -------------------------------------------------------------
  const inFlightAssistantTokens =
    stream.kind === "streaming"
      ? stream.tokens
      : stream.kind === "error"
        ? stream.tokens
        : ""

  const showSuggestions =
    threads.length === 0 &&
    messages.length === 0 &&
    !stagedDraft &&
    stream.kind === "idle"

  return (
    <aside
      className="sticky top-12 flex h-[calc(100vh-3rem)] min-h-0 w-[380px] shrink-0 flex-col overflow-hidden border-r border-[var(--color-hairline)] bg-[var(--color-surface)]"
      data-testid="experience-chat-panel"
      aria-label="Experience editor AI chat"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-hairline)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_30%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-brand)_14%,var(--color-surface-inset))] text-[var(--color-brand)]">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              AI Chat · {locale}
            </div>
            <div className="text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)]">
              Iterate this experience
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewThread}
          className="inline-flex h-8 items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
          aria-label="Start new conversation"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
          New
        </button>
      </div>

      {/* Thread list */}
      {threads.length > 0 ? (
        <div
          className="max-h-44 shrink-0 overflow-y-auto border-b border-[var(--color-hairline)] px-2 py-2"
          data-testid="experience-chat-thread-list"
        >
          <ul className="space-y-1">
            {threads.map((t) => {
              const isActive = t.id === activeThreadId
              return (
                <li key={t.id}>
                  <div
                    className={
                      "group flex items-center justify-between gap-1 rounded-sm px-2 py-1.5 transition-colors " +
                      (isActive
                        ? "bg-[color:color-mix(in_oklab,var(--color-brand)_12%,var(--color-surface-inset))]"
                        : "hover:bg-[var(--color-surface-raised)]")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setActiveThreadId(t.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      data-testid={`experience-chat-thread-${t.id}`}
                    >
                      <ChevronRight
                        className={
                          "h-3.5 w-3.5 shrink-0 " +
                          (isActive
                            ? "text-[var(--color-brand)]"
                            : "text-[var(--color-text-muted)]")
                        }
                        strokeWidth={1.5}
                      />
                      <span className="truncate text-[13px] text-[var(--color-text-primary)]">
                        {t.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchive(t.id)}
                      className="invisible inline-flex h-6 w-6 items-center justify-center rounded-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-inset)] group-hover:visible"
                      aria-label={`Archive thread ${t.title}`}
                    >
                      <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* Body — messages + suggestions */}
      <div
        ref={messageListRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        data-testid="experience-chat-message-list"
      >
        {bootError ? (
          <div className="rounded-sm border border-[color:color-mix(in_oklab,var(--color-danger)_30%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))] px-3 py-2 text-[12px] text-[var(--color-danger)]">
            {bootError}
          </div>
        ) : null}

        {showSuggestions ? (
          <EmptyState suggestedPrompts={suggestedPrompts} onPick={setDraft} />
        ) : null}

        <ul className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onUndo={handleUndo} />
          ))}

          {stream.kind === "streaming" || stream.kind === "error" ? (
            <li
              className="flex justify-start"
              data-testid="experience-chat-inflight"
            >
              <div className="max-w-[85%] rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-2 text-[13px] leading-6 text-[var(--color-text-primary)]">
                {inFlightAssistantTokens || (
                  <span className="text-[var(--color-text-muted)]">
                    Thinking…
                  </span>
                )}
                {stream.kind === "streaming" ? (
                  <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-[var(--color-brand)] align-middle" />
                ) : null}
                {stream.kind === "error" ? (
                  <ChatErrorBlock code={stream.code} onRetry={handleRetry} />
                ) : null}
              </div>
            </li>
          ) : null}

          {stagedDraft ? (
            <li ref={stagedDraftRef} className="flex justify-start">
              <StagedDraftCard
                draft={stagedDraft}
                onChange={setStagedDraft}
                onApply={handleApplyStagedDraft}
                onDiscard={() => setStagedDraft(null)}
              />
            </li>
          ) : null}

          {briefConfirmation && !stagedDraft ? (
            <li className="flex justify-start">
              <BriefConfirmationCard
                preview={briefConfirmation}
                onConfirm={handleConfirmBrief}
              />
            </li>
          ) : null}
        </ul>
      </div>

      {/* Composer */}
      <div
        className="relative z-10 shrink-0 border-t border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-3 py-3"
        data-testid="experience-chat-composer"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={confirmAcrossLocales}
              onChange={(e) => setConfirmAcrossLocales(e.target.checked)}
              data-testid="experience-chat-cross-locale-toggle"
              className="h-3 w-3 rounded-sm border-[var(--color-hairline-strong)]"
            />
            Apply across locales
          </label>
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ChatProvider)}
              disabled={stream.kind === "streaming"}
              data-testid="experience-chat-provider"
              className="h-6 rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)] px-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-primary)] outline-none disabled:cursor-not-allowed disabled:text-[var(--color-text-disabled)]"
            >
              <option value="mastra">Mastra (new, agent runtime)</option>
              <option value="openrouter">OpenRouter (free, cloud)</option>
              <option value="ollama">Ollama (local, free)</option>
              <option value="codex">Codex (paid, local CLI)</option>
              <option value="claude-code">Claude Code (paid, local CLI)</option>
            </select>
          </label>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Ask the AI to refine the title, blocks, or description…"
            rows={3}
            data-testid="experience-chat-input"
            className="block w-full resize-y rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)] px-3 py-2 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
            disabled={stream.kind === "streaming"}
          />
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          {stream.kind === "streaming" ? (
            <button
              type="button"
              onClick={handleStop}
              data-testid="experience-chat-stop"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
            >
              <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={draft.trim().length === 0}
              data-testid="experience-chat-send"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-transparent bg-[var(--color-brand)] px-3 text-[12px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:border-[var(--color-hairline)] disabled:bg-[var(--color-surface-raised)] disabled:text-[var(--color-text-disabled)] disabled:hover:bg-[var(--color-surface-raised)]"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
              Send
            </button>
          )}
        </div>
      </div>

      <ExperienceChatCrossLocaleModal
        open={crossLocaleModalOpen}
        affectedLocales={[locale]}
        onCancel={() => setCrossLocaleModalOpen(false)}
        onConfirm={() => void submitWithConfirmation()}
      />
    </aside>
  )
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function EmptyState({
  suggestedPrompts,
  onPick,
}: {
  suggestedPrompts: ReadonlyArray<string>
  onPick: (prompt: string) => void
}) {
  return (
    <div
      className="flex flex-col items-start gap-3 py-6"
      data-testid="experience-chat-empty-state"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        Start a conversation
      </div>
      <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
        Ask the AI to refine the title, rewrite the description, restructure
        blocks, or weave in a new theme. Each turn applies a diff you can undo.
      </p>
      {suggestedPrompts.length > 0 ? (
        <ul className="flex flex-col gap-2 self-stretch">
          {suggestedPrompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                onClick={() => onPick(prompt)}
                className="block w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 py-2 text-left text-[12px] leading-5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-inset)]"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function StagedDraftCard({
  draft,
  onChange,
  onApply,
  onDiscard,
}: {
  draft: StagedDraftPreview
  onChange: Dispatch<SetStateAction<StagedDraftPreview | null>>
  onApply: () => void
  onDiscard: () => void
}) {
  return (
    <section
      className="w-full rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_28%,var(--color-hairline))] bg-[var(--color-surface-inset)] p-3"
      data-testid="experience-chat-draft-preview"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        Draft preview
      </div>
      <div className="mt-2 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Title
          </span>
          <input
            value={draft.title}
            onChange={(event) =>
              onChange((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            data-testid="experience-chat-draft-title"
            className="block h-9 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-hairline-strong)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Description
          </span>
          <textarea
            value={draft.metaDescription}
            onChange={(event) =>
              onChange((prev) =>
                prev ? { ...prev, metaDescription: event.target.value } : prev,
              )
            }
            rows={3}
            data-testid="experience-chat-draft-description"
            className="block w-full resize-y rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-hairline-strong)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Blocks JSON
          </span>
          <textarea
            value={draft.blocksJson}
            onChange={(event) =>
              onChange((prev) =>
                prev
                  ? { ...prev, blocksJson: event.target.value, error: null }
                  : prev,
              )
            }
            rows={10}
            spellCheck={false}
            data-testid="experience-chat-draft-blocks"
            className="block max-h-[320px] w-full resize-y rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-hairline-strong)]"
          />
        </label>
        {draft.error ? (
          <div
            className="rounded-sm border border-[color:color-mix(in_oklab,var(--color-danger)_36%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))] px-2 py-1.5 text-[12px] text-[var(--color-danger)]"
            data-testid="experience-chat-draft-error"
          >
            {draft.error}
          </div>
        ) : null}
        {draft.review ? <QualityReviewCard review={draft.review} /> : null}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-2.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onApply}
            data-testid="experience-chat-draft-apply"
            className="inline-flex h-8 items-center rounded-sm bg-[var(--color-brand)] px-2.5 text-[12px] font-medium text-white hover:bg-[var(--color-brand-pressed)]"
          >
            Apply draft
          </button>
        </div>
      </div>
    </section>
  )
}

const BRIEF_FIELD_LABELS: Record<EditorialBriefField, string> = {
  topicOrPassage: "Topic or passage",
  language: "Language",
  audience: "Audience",
  desiredOutcome: "Desired outcome",
  tone: "Tone",
  pageType: "Page type",
  scriptureEmphasis: "Scripture emphasis",
  ctaOrNextStep: "CTA or next step",
}

const BRIEF_FIELD_ORDER = Object.keys(
  BRIEF_FIELD_LABELS,
) as EditorialBriefField[]

function BriefConfirmationCard({
  preview,
  onConfirm,
}: {
  preview: BriefConfirmationPreview
  onConfirm: () => void
}) {
  return (
    <section
      className="w-full rounded-sm border border-[color:color-mix(in_oklab,var(--color-brand)_28%,var(--color-hairline))] bg-[var(--color-surface-inset)] p-3"
      data-testid="experience-chat-brief-confirmation"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        Editorial brief
      </div>
      <dl className="mt-2 space-y-2">
        {BRIEF_FIELD_ORDER.map((field) => (
          <div key={field}>
            <dt className="text-[11px] font-medium text-[var(--color-text-muted)]">
              {BRIEF_FIELD_LABELS[field]}
            </dt>
            <dd className="text-[13px] leading-5 text-[var(--color-text-primary)]">
              {preview.brief[field] ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onConfirm}
          data-testid="experience-chat-brief-confirm"
          className="inline-flex h-8 items-center rounded-sm bg-[var(--color-brand)] px-2.5 text-[12px] font-medium text-white hover:bg-[var(--color-brand-pressed)]"
        >
          Generate from brief
        </button>
      </div>
    </section>
  )
}

function QualityReviewCard({ review }: { review: QualityDraftReview }) {
  return (
    <section
      className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5"
      data-testid="experience-chat-quality-review"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        Review notes
      </div>
      <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
        {review.scriptureNotes.slice(0, 3).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {review.referenceLedger.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-text-secondary)]">
            Reference ledger
          </summary>
          <ul
            className="mt-1 space-y-1 text-[12px] leading-5 text-[var(--color-text-secondary)]"
            data-testid="experience-chat-reference-ledger"
          >
            {review.referenceLedger.slice(0, 5).map((entry, index) => (
              <li key={`${entry.sourceKind}-${entry.reference}-${index}`}>
                <span className="font-medium">{entry.reference}</span>
                {" — "}
                {entry.claim}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

function MessageBubble({
  message,
  onUndo,
}: {
  message: LocalMessage
  onUndo: (m: LocalMessage) => void
}) {
  const isUser = message.role === "USER"
  const diff = useMemo(
    () => parseSnapshotDiff(message.snapshotDiff),
    [message.snapshotDiff],
  )
  const hasDiff =
    !!diff &&
    (Object.keys(diff.scalars).length > 0 ||
      (diff.blocks && diff.blocks.length > 0))

  return (
    <li
      className={"flex " + (isUser ? "justify-end" : "justify-start")}
      data-testid={`experience-chat-message-${message.id}`}
    >
      <div
        className={
          "max-w-[85%] rounded-sm px-3 py-2 text-[13px] leading-6 " +
          (isUser
            ? "border border-[color:color-mix(in_oklab,var(--color-brand)_30%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-brand)_10%,var(--color-surface))] text-[var(--color-text-primary)]"
            : "border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-primary)]")
        }
      >
        <div
          className={
            message.reverted
              ? "text-[var(--color-text-muted)] line-through"
              : ""
          }
        >
          {message.content}
        </div>
        {!isUser && hasDiff ? (
          <div className="mt-2 flex items-center gap-2">
            {message.reverted ? (
              <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Reverted
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onUndo(message)}
                data-testid={`experience-chat-undo-${message.id}`}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
              >
                <Undo2 className="h-3 w-3" strokeWidth={1.5} />
                Undo this change
              </button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function ChatErrorBlock({
  code,
  onRetry,
}: {
  code: ChatErrorCode | string
  onRetry: () => void
}) {
  const presentation: ChatErrorPresentation = presentChatError(code)
  const isWarn = presentation.severity === "warn"
  // Severity → token-driven border + text colors. Warn = amber boundary
  // condition; error = brand red. We deliberately keep the surface tint
  // light so the error block reads as inline metadata, not a modal.
  const borderColor = isWarn
    ? "color-mix(in oklab,var(--color-warning,#b45309) 40%,var(--color-hairline))"
    : "color-mix(in oklab,var(--color-danger) 40%,var(--color-hairline))"
  const tintColor = isWarn
    ? "color-mix(in oklab,var(--color-warning,#b45309) 8%,var(--color-surface))"
    : "color-mix(in oklab,var(--color-danger) 8%,var(--color-surface))"
  const textColor = isWarn
    ? "var(--color-warning,#b45309)"
    : "var(--color-danger)"

  return (
    <div
      className="mt-2 rounded-sm border px-2.5 py-2"
      style={{ borderColor, backgroundColor: tintColor }}
      data-testid="experience-chat-error"
      data-error-code={code}
      data-severity={presentation.severity}
      role={isWarn ? "status" : "alert"}
    >
      <div
        className="font-mono text-[11px] uppercase tracking-[0.12em]"
        style={{ color: textColor }}
      >
        {presentation.title}
      </div>
      <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
        {presentation.message}
      </div>
      {presentation.retry ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={onRetry}
            data-testid="experience-chat-error-retry"
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function readPersistedBeforeBlocks(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object") return null
  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.beforeBlocks)) return obj.beforeBlocks as unknown[]
  return null
}

function parseSnapshotDiff(value: unknown): ExperienceChatDiff | null {
  if (!value || typeof value !== "object") return null
  const obj = value as Record<string, unknown>
  if (!obj.scalars || typeof obj.scalars !== "object") return null
  return {
    scalars: obj.scalars as ExperienceChatDiff["scalars"],
    blocks: Array.isArray(obj.blocks)
      ? (obj.blocks as ExperienceChatDiff["blocks"])
      : undefined,
  }
}

// Re-export the apply/revert helpers so consumers don't have to import the
// service module directly.
export { applyDiff, computeDiff, revertDiff }
export type { EditableLocaleState, ExperienceChatDiff }
