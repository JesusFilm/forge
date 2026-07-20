"use client"

import { useEffect, useRef, useState } from "react"

import { streamReply } from "./chat-stub"
import {
  createConversation,
  deriveTitle,
  titleFromFirstUser,
  type Conversation,
  type Message,
} from "./conversations"
import {
  fetchHistoryPage,
  fetchHistoryThread,
  type HistoryMessage,
  type HistoryThreadSummary,
} from "./history-client"

/** Sidebar-facing server-history list state (feat-241, R12/R16). */
export type HistoryListUi = {
  /** First page in flight — the sidebar skeleton state. */
  loading: boolean
  /** First page failed (transport/5xx) — the error state with retry. */
  error: boolean
  /** More pages exist — render the Load-more control. */
  hasMore: boolean
  /** A Load-more fetch is in flight (inline pending on the control). */
  loadingMore: boolean
  /** The last Load-more failed — inline retry; page-1 rows stay rendered. */
  loadMoreError: boolean
}

export type UseConversations = {
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  pending: boolean
  pendingIds: ReadonlySet<string>
  streamingMessageId: string | null
  history: HistoryListUi
  setDraft: (value: string) => void
  send: (text: string) => void
  stopReply: () => void
  newConversation: () => void
  selectConversation: (id: string) => void
  retryHistory: () => void
  loadMoreHistory: () => void
  retryReplay: () => void
}

// Internal list-hydration phase. "denied" = a mid-session access denial
// (401 invalid_session / 403 gate_denied) reverted the sidebar to client-only
// silently (KTD8/R16) — indistinguishable from "idle" in the UI.
type HistoryPhase = "idle" | "loading" | "loaded" | "error" | "denied"

type HistoryState = {
  phase: HistoryPhase
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
}

const HISTORY_IDLE: HistoryState = {
  phase: "idle",
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
}

/**
 * Merge one page of server listing rows into the conversation list (KTD9).
 * By conversation id (client conversation id === server thread id, feat-208):
 * in-session state is authoritative — messages are kept, a non-empty server
 * LLM title wins over the client-derived snippet, and an existing row keeps
 * its first-seen position (cross-page dedupe). New rows join as message-less
 * server-origin conversations with replay "idle" and the server `updatedAt`
 * as their activity key. Every listed row is server-persisted by definition.
 * Pure — exported for direct unit coverage.
 */
export function mergeServerThreads(
  prev: Conversation[],
  rows: HistoryThreadSummary[],
): Conversation[] {
  const byId = new Map(prev.map((c) => [c.id, c]))
  const next = [...prev]
  for (const row of rows) {
    const existing = byId.get(row.id)
    if (existing) {
      const merged: Conversation = {
        ...existing,
        title: row.title.trim().length > 0 ? row.title : existing.title,
        serverPersisted: true,
        lastActivityAt: existing.lastActivityAt ?? row.updatedAt,
      }
      next[next.indexOf(existing)] = merged
      byId.set(row.id, merged)
    } else {
      const appended: Conversation = {
        id: row.id,
        title: row.title,
        messages: [],
        origin: "server",
        serverPersisted: true,
        lastActivityAt: row.updatedAt,
        replay: "idle",
      }
      next.push(appended)
      byId.set(row.id, appended)
    }
  }
  return next
}

/**
 * Merge a replayed transcript into a conversation's messages (KTD11). By
 * message id, never replacing: transcript turns the client does not know yet
 * are prepended (they predate the session); existing message objects are kept
 * untouched so an in-flight streamed turn keeps receiving its patches.
 * Replayed turns carry NO engine/grounded/sources metadata (KTD5 — bare text,
 * never a false "Ungrounded" badge). Pure — exported for direct unit coverage.
 */
export function mergeReplayMessages(
  fetched: HistoryMessage[],
  existing: Message[],
): Message[] {
  const existingIds = new Set(existing.map((m) => m.id))
  const transcript: Message[] = fetched
    .filter((m) => !existingIds.has(m.id))
    .map((m) => ({ id: m.id, role: m.role, content: m.text }))
  return [...transcript, ...existing]
}

/**
 * Sidebar ordering (KTD9): fresh empty local conversations pinned on top (in
 * their existing order), then everything else activity-descending — local
 * conversations by the `lastActivityAt` stamped on send, server rows by their
 * listed `updatedAt`. Pure — exported for direct unit coverage.
 */
export function orderConversations(
  conversations: Conversation[],
): Conversation[] {
  const pinned: Conversation[] = []
  const rest: Conversation[] = []
  for (const conversation of conversations) {
    if (
      conversation.origin !== "server" &&
      conversation.messages.length === 0
    ) {
      pinned.push(conversation)
    } else {
      rest.push(conversation)
    }
  }
  const activityMs = (conversation: Conversation): number => {
    if (!conversation.lastActivityAt) return 0
    const parsed = new Date(conversation.lastActivityAt).getTime()
    return Number.isNaN(parsed) ? 0 : parsed
  }
  // Array.prototype.sort is stable: equal keys keep first-seen order.
  const sorted = [...rest].sort((a, b) => activityMs(b) - activityMs(a))
  return [...pinned, ...sorted]
}

/**
 * The sidebar-visible projection (feat-270): ordered per orderConversations,
 * minus never-used empty local conversations that are not active — the New
 * action reuses those, so an inactive empty is pure clutter under the
 * identically-labeled action button. The active fresh row stays pinned.
 * Pure — exported for direct unit coverage.
 */
export function listConversations(
  conversations: Conversation[],
  activeId: string,
): Conversation[] {
  return orderConversations(conversations).filter(
    (c) => c.id === activeId || c.origin === "server" || c.messages.length > 0,
  )
}

/**
 * Owns all conversation + reply state so the components stay presentational.
 * `seekerEnabled` selects the reply source (Seeker proxy vs local stub) inside
 * the streamReply seam AND gates server-history hydration (feat-241, KTD9 —
 * the prop already means "full gate grant", so denied/anonymous users never
 * fire a doomed fetch). Returns the ordered conversation list, the active
 * conversation + draft, the per-conversation pending set, the in-flight
 * `streamingMessageId`, the server-history list state, and the actions.
 *
 * Reply lifecycle: append an empty assistant turn (pulse shows pre-first-token),
 * feed tokens in as they arrive, finalize on the terminal result, and on failure
 * keep the partial text + mark the turn. In-flight replies are tracked PER
 * CONVERSATION via an AbortController map (not a global flag) so a slow reply in
 * one conversation never locks sending in another; the slot is held across the
 * full stream lifecycle and released in a `finally` so a throw can't wedge it.
 *
 * History lifecycle (feat-241): one first-page fetch on mount when enabled;
 * Load more appends pages (first-seen dedupe); selecting a server-origin row
 * lazy-loads its transcript exactly once (single-flight, session-cached);
 * sends into a server-origin conversation are blocked unless its replay is
 * "loaded" (R22); a send that succeeded through Seeker marks the conversation
 * server-persisted, which withholds the gate-denied stub fallback (KTD10).
 * History fetches track their own AbortController — never `controllersRef`,
 * which doubles as the double-send guard and the sidebar "Replying" pulse.
 */
export function useConversations(seekerEnabled: boolean): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(),
  ])
  const [activeId, setActiveId] = useState<string>(
    () => conversations[0]?.id ?? "",
  )
  const [draft, setDraft] = useState("")
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  // The in-flight assistant message id per conversation — the explicit "this
  // turn is streaming" signal the view reads (so it never re-derives streaming
  // from Message field absence). Set on send, cleared when the turn settles.
  const [streamingIds, setStreamingIds] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )
  const [history, setHistory] = useState<HistoryState>(HISTORY_IDLE)

  // SINGLE source of truth for in-flight replies, keyed by conversation id. Read
  // synchronously in send() so a second submit can't double-send; `pendingIds`
  // is a derived snapshot of its keys. Mutated but never reassigned.
  const controllersRef = useRef<Map<string, AbortController>>(new Map())

  // Cleared on unmount so the fire-and-forget finally can skip its setState after
  // teardown (the ref-map delete still runs unconditionally).
  const mountedRef = useRef(true)

  // Mirror of activeId that updates synchronously when the conversation changes,
  // so send() captures the right target even if a switch and a send land in the
  // same React batch.
  const activeIdRef = useRef(activeId)

  // Render-fresh mirror of the conversation list for event handlers and async
  // callbacks that need a current snapshot without re-closing over state.
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations

  // Conversations whose in-flight reply the USER stopped (feat-270): abort
  // finalizes quietly (partial text kept, no failure notice) instead of as an
  // unmount abort. Consumed where the stream settles in send().
  const stoppedRef = useRef<Set<string>>(new Set())

  // History fetches get their own abort tracking (KTD11) — one hook-lifetime
  // controller aborted on unmount; select-away never aborts a replay fetch.
  const historyAbortRef = useRef<AbortController | null>(null)
  // Sync single-flight guard for replay fetches: the replay state alone lands
  // asynchronously, so a double-select in one tick could double-fetch.
  const replayInFlightRef = useRef<Set<string>>(new Set())
  const nextPageRef = useRef(0)
  const historyRef = useRef(history)
  historyRef.current = history

  function historyController(): AbortController {
    historyAbortRef.current ??= new AbortController()
    return historyAbortRef.current
  }

  useEffect(() => {
    const controllers = controllersRef.current
    // Restore what the cleanup below mutates: under dev StrictMode React runs
    // setup -> cleanup -> setup on the SAME hook instance, so without this the
    // remounted tree would keep the poisoned refs and never apply state again.
    mountedRef.current = true
    return () => {
      // Abort in-flight streams on unmount so their async callbacks don't fire
      // setState after teardown; same for in-flight history/replay fetches.
      mountedRef.current = false
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      historyAbortRef.current?.abort()
      // Null it so a remount lazily mints a FRESH controller instead of
      // reusing the aborted one.
      historyAbortRef.current = null
    }
  }, [])

  // pendingIds derives from the controller map's keys — recomputed on every
  // start/clear so the two never diverge. Both write paths go through these
  // helpers; nothing else touches the map.
  function syncPendingIds() {
    setPendingIds(new Set(controllersRef.current.keys()))
  }

  function startReply(
    conversationId: string,
    controller: AbortController,
    assistantId: string,
  ) {
    controllersRef.current.set(conversationId, controller)
    setStreamingIds((prev) => new Map(prev).set(conversationId, assistantId))
    syncPendingIds()
  }

  function clearReply(conversationId: string) {
    // Release the slot unconditionally; skip the state sync after unmount so the
    // fire-and-forget finally never setStates a torn-down tree.
    controllersRef.current.delete(conversationId)
    if (!mountedRef.current) return
    setStreamingIds((prev) => {
      const next = new Map(prev)
      next.delete(conversationId)
      return next
    })
    syncPendingIds()
  }

  function appendMessage(conversationId: string, message: Message) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              // Server-origin rows skip the retitle branch (KTD9) UNLESS
              // untitled (feat-270): a first send into an untitled thread
              // beats the date-fallback label; a real server title is kept.
              title:
                conversation.messages.length === 0 && message.role === "user"
                  ? conversation.origin !== "server"
                    ? deriveTitle(message.content)
                    : titleFromFirstUser(conversation.title, message.content)
                  : conversation.title,
              // A send bumps the activity key so ordering surfaces the
              // conversation (AE7); replies land in the same turn.
              lastActivityAt:
                message.role === "user"
                  ? new Date().toISOString()
                  : conversation.lastActivityAt,
              messages: [...conversation.messages, message],
            }
          : conversation,
      ),
    )
  }

  // KTD10 stamp, shared by the success/stopped/failure finalize branches —
  // each branch keeps its own guard for WHEN the thread provably exists.
  function markServerPersisted(conversationId: string) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId && c.serverPersisted !== true
          ? { ...c, serverPersisted: true }
          : c,
      ),
    )
  }

  // Patch a single message in place (token append + terminal finalize/error).
  function updateMessage(
    conversationId: string,
    messageId: string,
    patch: (message: Message) => Message,
  ) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? patch(message) : message,
              ),
            }
          : conversation,
      ),
    )
  }

  // ---------------------------------------------------------------------------
  // Server-history hydration (feat-241)
  // ---------------------------------------------------------------------------

  /** Silent revert to the client-only sidebar on a mid-session access denial
   * (KTD8/R16): message-less server rows disappear; anything the user already
   * replayed or resumed stays (it is client state now). No nudge, no banner. */
  function revertToClientOnly() {
    setHistory({ ...HISTORY_IDLE, phase: "denied" })
    const active = conversationsRef.current.find(
      (c) => c.id === activeIdRef.current,
    )
    const isRemovable = (c: Conversation) =>
      c.origin === "server" && c.messages.length === 0
    if (active !== undefined && isRemovable(active)) {
      // The active pane is a disappearing server row — land on the existing
      // fresh local conversation when one is left, else mint one (never both:
      // a duplicate "New conversation" row would linger in the rail).
      const fallback = conversationsRef.current.find(
        (c) =>
          !isRemovable(c) && c.origin !== "server" && c.messages.length === 0,
      )
      const fresh = fallback ?? createConversation()
      activeIdRef.current = fresh.id
      setActiveId(fresh.id)
      setDraft("")
      setConversations((prev) => {
        const kept = prev.filter((c) => !isRemovable(c))
        return fallback ? kept : [fresh, ...kept]
      })
    } else {
      setConversations((prev) => prev.filter((c) => !isRemovable(c)))
    }
  }

  function runHistoryPageFetch(page: number) {
    const controller = historyController()
    void (async () => {
      const result = await fetchHistoryPage({ page, signal: controller.signal })
      // A result from an aborted fetch (unmount, or StrictMode's dev
      // mount-cycle) must never apply state — the next mount owns its own.
      if (!mountedRef.current || controller.signal.aborted) return
      if (!result.ok) {
        if (result.reason === "access") return revertToClientOnly()
        if (page === 0) {
          setHistory({ ...HISTORY_IDLE, phase: "error" })
        } else {
          setHistory((h) => ({
            ...h,
            loadingMore: false,
            loadMoreFailed: true,
          }))
        }
        return
      }
      nextPageRef.current = page + 1
      setConversations((prev) => mergeServerThreads(prev, result.threads))
      setHistory({
        phase: "loaded",
        hasMore: result.hasMore,
        loadingMore: false,
        loadMoreFailed: false,
      })
    })()
  }

  function startHistoryFirstPage() {
    setHistory({ ...HISTORY_IDLE, phase: "loading" })
    runHistoryPageFetch(0)
  }

  // Hydration fires post-mount under a full gate grant (KTD9), guarded on the
  // phase REF, not a fired-once flag: StrictMode's cleanup aborts the first
  // fetch pre-render, so only a still-"idle" phase lets a remount start over.
  useEffect(() => {
    if (!seekerEnabled || historyRef.current.phase !== "idle") return
    startHistoryFirstPage()
    // Intentionally keyed on the (deploy-static) flag only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekerEnabled])

  function retryHistory() {
    if (historyRef.current.phase !== "error") return
    startHistoryFirstPage()
  }

  function loadMoreHistory() {
    const current = historyRef.current
    if (current.phase !== "loaded" || current.loadingMore) return
    setHistory((h) => ({ ...h, loadingMore: true, loadMoreFailed: false }))
    runHistoryPageFetch(nextPageRef.current)
  }

  // ---------------------------------------------------------------------------
  // Replay (feat-241, KTD11)
  // ---------------------------------------------------------------------------

  function setReplayState(
    conversationId: string,
    replay: Conversation["replay"],
  ) {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, replay } : c)),
    )
  }

  function startReplayFetch(conversationId: string) {
    if (replayInFlightRef.current.has(conversationId)) return
    replayInFlightRef.current.add(conversationId)
    setReplayState(conversationId, "loading")
    const controller = historyController()
    void (async () => {
      try {
        const result = await fetchHistoryThread({
          conversationId,
          signal: controller.signal,
        })
        if (!mountedRef.current || controller.signal.aborted) return
        if (!result.ok) {
          if (result.reason === "access") {
            // KTD8 uniformity: session/gate loss reverts to the client-only
            // sidebar on EVERY surface, like the list path. "No longer
            // available" stays reserved for forbidden/vanished threads (R18).
            revertToClientOnly()
            return
          }
          // "unavailable" (transport/5xx) is retryable via the explicit
          // action; not_available is terminal for the session.
          setReplayState(
            conversationId,
            result.reason === "unavailable" ? "failed" : "not_available",
          )
          return
        }
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conversationId) return c
            const messages = mergeReplayMessages(result.messages, c.messages)
            // feat-270: a replayed first user turn beats the date-fallback
            // label on an untitled thread (titleFromFirstUser — a non-empty
            // LLM or snippet title always wins).
            const title = titleFromFirstUser(
              c.title,
              messages.find((m) => m.role === "user")?.content,
            )
            return { ...c, replay: "loaded", messages, title }
          }),
        )
      } finally {
        replayInFlightRef.current.delete(conversationId)
      }
    })()
  }

  // Lazy replay: selecting a server-origin row with an idle transcript fires
  // exactly one fetch (AE14). Loaded/not_available are session-cached;
  // "failed" refetches only via the explicit retry action (state diagram).
  useEffect(() => {
    const active = conversationsRef.current.find((c) => c.id === activeId)
    if (active?.origin === "server" && active.replay === "idle") {
      startReplayFetch(active.id)
    }
    // Selection is the trigger; startReplayFetch is render-scoped but stable
    // in behavior (guarded by replayInFlightRef + the idle check).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function retryReplay() {
    const active = conversationsRef.current.find(
      (c) => c.id === activeIdRef.current,
    )
    if (active?.origin === "server" && active.replay === "failed") {
      startReplayFetch(active.id)
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function send(text: string) {
    const trimmed = text.trim()
    // Capture the target up front (from the synchronous ref) so the reply lands
    // in the conversation active at send time even if the user switches mid-reply.
    const targetId = activeIdRef.current
    // One in-flight reply per conversation: a second submit before it resolves
    // is a no-op. Other conversations stay free to send in parallel.
    if (!trimmed || controllersRef.current.has(targetId)) return
    const target = conversationsRef.current.find((c) => c.id === targetId)
    // R22: resuming is only possible from a loaded transcript — sends into a
    // loading/failed/not-available server-origin conversation are no-ops.
    if (target?.origin === "server" && target.replay !== "loaded") return
    // KTD10: persisted conversations must not stub-degrade on gate_denied.
    const allowStubFallback = target?.serverPersisted !== true
    setDraft("")

    appendMessage(targetId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    })

    // Empty assistant turn — the pulse renders against it pre-first-token (R8),
    // and tokens append into it as they stream (R9).
    const assistantId = crypto.randomUUID()
    appendMessage(targetId, { id: assistantId, role: "assistant", content: "" })

    const controller = new AbortController()
    startReply(targetId, controller, assistantId)

    // Fire-and-forget: the whole body is wrapped so the slot releases on EVERY
    // path (terminal result, error, abort) — see the slot-leak guard pattern.
    void (async () => {
      try {
        const result = await streamReply({
          text: trimmed,
          conversationId: targetId,
          seekerEnabled,
          allowStubFallback,
          signal: controller.signal,
          onToken: (token) =>
            updateMessage(targetId, assistantId, (message) => ({
              ...message,
              content: message.content + token,
            })),
        })
        // A user stop (feat-270) finalizes quietly below; any OTHER abort
        // (unmount, StrictMode cycle) skips the finalize setState — the tree
        // is gone. The finally below still releases the slot either way.
        const stopped = stoppedRef.current.delete(targetId)
        if (!mountedRef.current || (controller.signal.aborted && !stopped)) {
          return
        }
        if (result.ok) {
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.text,
            sources: result.sources,
            grounded: result.grounded,
            engine: result.engine,
          }))
          if (result.engine === "seeker") {
            // KTD10: the persisted predicate keys on a SUCCESSFUL Seeker turn
            // only — the failure branch below also stamps the engine tag on
            // turns that never reached the server, so tag presence is not it.
            markServerPersisted(targetId)
          }
        } else if (stopped) {
          // User stop (feat-270): finalize with partial text kept — a plain
          // turn, no role="alert" notice, no engine/grounded stamp. Nothing
          // streamed → drop the empty turn instead of a blank bubble.
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== targetId) return c
              const messages = c.messages
                .map((m) =>
                  m.id === assistantId
                    ? { ...m, content: result.partialText || m.content }
                    : m,
                )
                .filter((m) => m.id !== assistantId || m.content.length > 0)
              return { ...c, messages }
            }),
          )
          // Mastra creates the thread row BEFORE generating, so a stop that
          // beat the first token may still have persisted the thread. Stamp
          // every stopped Seeker turn: a wrong stamp only costs a visible
          // gate_denied notice later; a missing one silently stub-forks.
          if (seekerEnabled) {
            markServerPersisted(targetId)
          }
        } else {
          // Keep whatever streamed (partialText); mark the failure so the UI
          // renders a visible notice (R14/R17). The turn is still attributable
          // to its engine (R20).
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.partialText || message.content,
            engine: seekerEnabled ? "seeker" : "stub",
            error: result.reason,
          }))
          // KTD10 refinement: non-empty partial text proves the stream opened
          // through Mastra, which creates the thread row BEFORE generating —
          // so the thread is server-persisted even though this turn failed.
          if (seekerEnabled && result.partialText.length > 0) {
            markServerPersisted(targetId)
          }
        }
      } finally {
        // Belt-and-braces: the consume above sits in the try, so a (today
        // impossible) streamReply rejection must not leak the stopped flag.
        stoppedRef.current.delete(targetId)
        clearReply(targetId)
      }
    })()
  }

  /** Abort the ACTIVE conversation's in-flight reply (feat-270). The quiet
   * finalize (partial text kept, no failure notice) happens where the stream
   * settles in send(); this only flags the abort as user-initiated. */
  function stopReply() {
    const targetId = activeIdRef.current
    const controller = controllersRef.current.get(targetId)
    if (!controller) return
    stoppedRef.current.add(targetId)
    controller.abort()
  }

  function newConversation() {
    // feat-270: reuse the existing never-used local conversation instead of
    // minting an identical sibling — so at most one fresh row ever exists.
    const existing = conversationsRef.current.find(
      (c) => c.origin !== "server" && c.messages.length === 0,
    )
    if (existing) {
      if (existing.id !== activeIdRef.current) {
        activeIdRef.current = existing.id
        setActiveId(existing.id)
        setDraft("")
      }
      return
    }
    const conversation = createConversation()
    // Keep the synchronous mirror in lockstep so a send batched with this switch
    // targets the new conversation.
    activeIdRef.current = conversation.id
    setConversations((prev) => [conversation, ...prev])
    setActiveId(conversation.id)
    setDraft("")
  }

  function selectConversation(id: string) {
    if (id === activeIdRef.current) return
    activeIdRef.current = id
    setActiveId(id)
    setDraft("")
  }

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ??
    conversations[0]

  return {
    conversations: listConversations(conversations, activeId),
    activeId,
    activeConversation,
    draft,
    // Pending for the active pane is true only when the active conversation
    // itself is waiting.
    pending: pendingIds.has(activeConversation.id),
    pendingIds,
    streamingMessageId: streamingIds.get(activeConversation.id) ?? null,
    history: {
      loading: history.phase === "loading",
      error: history.phase === "error",
      hasMore: history.phase === "loaded" && history.hasMore,
      loadingMore: history.loadingMore,
      loadMoreError: history.loadMoreFailed,
    },
    setDraft,
    send,
    stopReply,
    newConversation,
    selectConversation,
    retryHistory,
    loadMoreHistory,
    retryReplay,
  }
}
