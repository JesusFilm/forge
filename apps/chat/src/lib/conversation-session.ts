// The framework-agnostic conversation session (feat-281): every conversation
// machine lives here behind a subscribe/getSnapshot store, consumed via the
// use-conversations.ts adapter. No React import may ever appear here.

import {
  buildStubReply,
  type StreamReplyInput,
  type StreamReplyResult,
} from "./chat-stub"
import {
  createConversation,
  deriveTitle,
  titleFromFirstUser,
  type Conversation,
  type Message,
} from "./conversations"
import {
  type FetchHistoryPageResult,
  type FetchHistoryThreadResult,
  type HistoryMessage,
  type HistoryThreadSummary,
} from "./history-client"

/**
 * One immutable view of the session, rebuilt only when state actually changes
 * (identity-stable between changes — the useSyncExternalStore contract).
 * Carries the data half of the old hook return: the full conversation list
 * (UNPROJECTED — the sidebar applies its own visible-row projection, Ruling
 * 4b: `components/shell/sidebar-projection.ts`, whose `HistoryListUi` the
 * `history` field satisfies structurally), the active conversation + draft,
 * the per-conversation pending set, the in-flight streaming message id, and
 * the history list state.
 */
export type ConversationSessionSnapshot = {
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  /** True only when the ACTIVE conversation is waiting on a reply. */
  pending: boolean
  pendingIds: ReadonlySet<string>
  streamingMessageId: string | null
  history: {
    loading: boolean
    error: boolean
    hasMore: boolean
    loadingMore: boolean
    loadMoreError: boolean
  }
}

/**
 * Injected seams (feat-281): the reply seam plus the two history fetchers, so
 * the session's unit suite drives every machine directly — no DOM, no global
 * fetch. `seekerEnabled` selects the reply source inside streamReply AND gates
 * history hydration (it means "full gate grant"; anonymous/stub users run the
 * same session with it false — the interface is not seeker-shaped).
 */
export type ConversationSessionDeps = {
  streamReply: (input: StreamReplyInput) => Promise<StreamReplyResult>
  fetchHistoryPage: (input: {
    page: number
    signal?: AbortSignal
  }) => Promise<FetchHistoryPageResult>
  fetchHistoryThread: (input: {
    conversationId: string
    signal?: AbortSignal
  }) => Promise<FetchHistoryThreadResult>
  seekerEnabled: boolean
}

/**
 * The session's public surface. `subscribe`/`getSnapshot` follow the external-
 * store contract; the actions mirror the old hook's callbacks one-to-one.
 * `activate`/`deactivate` are the lifecycle seam the React adapter drives from
 * its mount effect: activation arms the effect-triggered work (history
 * hydration, replay of the active row), deactivation aborts in-flight fetches
 * AND rolls their pending states back so re-activating the SAME instance
 * re-arms cleanly (dev StrictMode runs setup → cleanup → setup on one
 * instance — see the remount-safety solution doc).
 */
export type ConversationSession = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConversationSessionSnapshot
  activate(): void
  deactivate(): void
  setDraft(value: string): void
  send(text: string): void
  stopReply(): void
  selectConversation(id: string): void
  newConversation(): void
  retryHistory(): void
  loadMoreHistory(): void
  retryReplay(): void
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
 * Create one conversation session. Construction is side-effect-free (no
 * fetch, no timer, no subscription — safe under dev StrictMode's doubled
 * useState initializer); all effectful work starts at `activate()`.
 *
 * Reply lifecycle: append an empty assistant turn (pulse shows pre-first-token),
 * feed tokens in as they arrive, finalize on the terminal result, and on failure
 * keep the partial text + mark the turn. In-flight replies are tracked PER
 * CONVERSATION via an AbortController map (not a global flag) so a slow reply in
 * one conversation never locks sending in another; the slot is held across the
 * full stream lifecycle and released in a `finally` so a throw can't wedge it.
 *
 * History lifecycle (feat-241): one first-page fetch on activation when
 * enabled; Load more appends pages (first-seen dedupe); selecting a
 * server-origin row lazy-loads its transcript exactly once (single-flight,
 * session-cached); sends into a server-origin conversation are blocked unless
 * its replay is "loaded" (R22); a send that succeeded through Seeker marks the
 * conversation server-persisted. The seam reports gate denials honestly
 * (Ruling 3), so the stub-vs-failure decision lives HERE: never-persisted
 * conversations get the immediate inline stub rebuilt in the finalize;
 * persisted ones fail visibly (KTD10 — the stamp sites and the decision are
 * all in this module). History fetches track their own AbortController —
 * never the reply-slot map, which doubles as the double-send guard and the
 * sidebar "Replying" pulse.
 */
export function createConversationSession(
  deps: ConversationSessionDeps,
): ConversationSession {
  let conversations: Conversation[] = [createConversation()]
  let activeId: string = conversations[0]?.id ?? ""
  let draft = ""
  let history: HistoryState = HISTORY_IDLE
  // Replaced (never mutated) at the same two sites the old hook synced it, so
  // its identity only changes when the reply-slot map does.
  let pendingIds: ReadonlySet<string> = new Set()

  // SINGLE source of truth for in-flight replies, keyed by conversation id.
  // Read synchronously in send() so a second submit can't double-send;
  // `pendingIds` is a snapshot of its keys. Mutated but never reassigned.
  const controllers = new Map<string, AbortController>()

  // The in-flight assistant message id per conversation — the explicit "this
  // turn is streaming" signal the view reads. Set on send, cleared on settle.
  const streamingIds = new Map<string, string>()

  // Conversations whose in-flight reply the USER stopped (feat-270): abort
  // finalizes quietly (partial text kept, no failure notice) instead of as a
  // teardown abort. Consumed where the stream settles in send().
  const stopped = new Set<string>()

  // History fetches get their own abort tracking (KTD11) — one session-owned
  // controller aborted on deactivate; select-away never aborts a replay fetch.
  let historyAbort: AbortController | null = null
  // Sync single-flight guard for replay fetches: the replay state alone lands
  // asynchronously, so a double-select in one tick could double-fetch.
  const replayInFlight = new Set<string>()
  let nextPage = 0

  // False between deactivate() and the next activate(): async completions
  // must not apply state into a torn-down tree. Starts true (the old
  // mountedRef); construction is live but unarmed — hydration waits.
  let active = true

  const listeners = new Set<() => void>()

  function buildSnapshot(): ConversationSessionSnapshot {
    const activeConversation =
      conversations.find((conversation) => conversation.id === activeId) ??
      conversations[0]
    return {
      // Unprojected — the current array reference is stable between commits
      // (state updates always reassign a new array, never mutate in place).
      conversations,
      activeId,
      activeConversation,
      draft,
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
    }
  }

  let snapshot: ConversationSessionSnapshot = buildSnapshot()
  // Lazily rebuilt: mutations only mark dirty, so a same-tick burst (send()
  // commits three times) costs one rebuild per READ, not per mutation.
  let snapshotDirty = false

  // Every state change funnels through here: mark the cached snapshot stale
  // (identity-stable between commits) and notify subscribers.
  function commit() {
    snapshotDirty = true
    for (const listener of Array.from(listeners)) listener()
  }

  function historyController(): AbortController {
    historyAbort ??= new AbortController()
    return historyAbort
  }

  function syncPendingIds() {
    pendingIds = new Set(controllers.keys())
  }

  function startReply(
    conversationId: string,
    controller: AbortController,
    assistantId: string,
  ) {
    controllers.set(conversationId, controller)
    streamingIds.set(conversationId, assistantId)
    syncPendingIds()
    commit()
  }

  function clearReply(conversationId: string) {
    // Release the slot unconditionally; skip the visible-state sync after
    // deactivation so the fire-and-forget finally never notifies a torn-down
    // tree (the aborted stream's settle races the unmount).
    controllers.delete(conversationId)
    if (!active) return
    streamingIds.delete(conversationId)
    syncPendingIds()
    commit()
  }

  function appendMessage(conversationId: string, message: Message) {
    conversations = conversations.map((conversation) =>
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
    )
    commit()
  }

  // KTD10 stamp, shared by the success/stopped/failure finalize branches —
  // each branch keeps its own guard for WHEN the thread provably exists.
  function markServerPersisted(conversationId: string) {
    conversations = conversations.map((c) =>
      c.id === conversationId && c.serverPersisted !== true
        ? { ...c, serverPersisted: true }
        : c,
    )
    commit()
  }

  // Patch a single message in place (token append + terminal finalize/error).
  function updateMessage(
    conversationId: string,
    messageId: string,
    patch: (message: Message) => Message,
  ) {
    conversations = conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === messageId ? patch(message) : message,
            ),
          }
        : conversation,
    )
    commit()
  }

  // ---------------------------------------------------------------------------
  // Server-history hydration (feat-241)
  // ---------------------------------------------------------------------------

  /** Silent revert to the client-only sidebar on a mid-session access denial
   * (KTD8/R16): message-less server rows disappear; anything the user already
   * replayed or resumed stays (it is client state now). No nudge, no banner. */
  function revertToClientOnly() {
    history = { ...HISTORY_IDLE, phase: "denied" }
    const activeConversation = conversations.find((c) => c.id === activeId)
    const isRemovable = (c: Conversation) =>
      c.origin === "server" && c.messages.length === 0
    if (activeConversation !== undefined && isRemovable(activeConversation)) {
      // The active pane is a disappearing server row — land on the existing
      // fresh local conversation when one is left, else mint one (never both:
      // a duplicate "New conversation" row would linger in the rail).
      const fallback = conversations.find(
        (c) =>
          !isRemovable(c) && c.origin !== "server" && c.messages.length === 0,
      )
      const fresh = fallback ?? createConversation()
      activeId = fresh.id
      draft = ""
      const kept = conversations.filter((c) => !isRemovable(c))
      conversations = fallback ? kept : [fresh, ...kept]
    } else {
      conversations = conversations.filter((c) => !isRemovable(c))
    }
    commit()
  }

  function runHistoryPageFetch(page: number) {
    const controller = historyController()
    void (async () => {
      const result = await deps.fetchHistoryPage({
        page,
        signal: controller.signal,
      })
      // A result from an aborted fetch (deactivation, or StrictMode's dev
      // mount-cycle) must never apply state — the next activation owns its own.
      if (!active || controller.signal.aborted) return
      if (!result.ok) {
        if (result.reason === "access") return revertToClientOnly()
        if (page === 0) {
          history = { ...HISTORY_IDLE, phase: "error" }
        } else {
          history = { ...history, loadingMore: false, loadMoreFailed: true }
        }
        commit()
        return
      }
      nextPage = page + 1
      conversations = mergeServerThreads(conversations, result.threads)
      history = {
        phase: "loaded",
        hasMore: result.hasMore,
        loadingMore: false,
        loadMoreFailed: false,
      }
      commit()
    })()
  }

  function startHistoryFirstPage() {
    history = { ...HISTORY_IDLE, phase: "loading" }
    commit()
    runHistoryPageFetch(0)
  }

  function retryHistory() {
    if (history.phase !== "error") return
    startHistoryFirstPage()
  }

  function loadMoreHistory() {
    if (history.phase !== "loaded" || history.loadingMore) return
    history = { ...history, loadingMore: true, loadMoreFailed: false }
    commit()
    runHistoryPageFetch(nextPage)
  }

  // ---------------------------------------------------------------------------
  // Replay (feat-241, KTD11)
  // ---------------------------------------------------------------------------

  function setReplayState(
    conversationId: string,
    replay: Conversation["replay"],
  ) {
    conversations = conversations.map((c) =>
      c.id === conversationId ? { ...c, replay } : c,
    )
    commit()
  }

  function startReplayFetch(conversationId: string) {
    if (replayInFlight.has(conversationId)) return
    replayInFlight.add(conversationId)
    setReplayState(conversationId, "loading")
    const controller = historyController()
    void (async () => {
      try {
        const result = await deps.fetchHistoryThread({
          conversationId,
          signal: controller.signal,
        })
        if (!active || controller.signal.aborted) return
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
        conversations = conversations.map((c) => {
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
        })
        commit()
      } finally {
        replayInFlight.delete(conversationId)
      }
    })()
  }

  // Lazy replay: landing on a server-origin row with an idle transcript fires
  // exactly one fetch (AE14). Loaded/not_available are session-cached;
  // "failed" refetches only via the explicit retry action (state diagram).
  function maybeStartReplay() {
    const activeConversation = conversations.find((c) => c.id === activeId)
    if (
      activeConversation?.origin === "server" &&
      activeConversation.replay === "idle"
    ) {
      startReplayFetch(activeConversation.id)
    }
  }

  function retryReplay() {
    const activeConversation = conversations.find((c) => c.id === activeId)
    if (
      activeConversation?.origin === "server" &&
      activeConversation.replay === "failed"
    ) {
      startReplayFetch(activeConversation.id)
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function send(text: string) {
    const trimmed = text.trim()
    // Capture the target up front so the reply lands in the conversation
    // active at send time even if the user switches mid-reply.
    const targetId = activeId
    // One in-flight reply per conversation: a second submit before it resolves
    // is a no-op. Other conversations stay free to send in parallel.
    if (!trimmed || controllers.has(targetId)) return
    const target = conversations.find((c) => c.id === targetId)
    // R22: resuming is only possible from a loaded transcript — sends into a
    // loading/failed/not-available server-origin conversation are no-ops.
    if (target?.origin === "server" && target.replay !== "loaded") return
    // KTD10: persisted conversations must not stub-degrade on gate_denied.
    // Captured at send START — the decision travels with the request, never
    // re-read at finalize time (a mid-flight hydration must not flip it).
    const stubOnGateDenied = target?.serverPersisted !== true
    draft = ""

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
        const result = await deps.streamReply({
          text: trimmed,
          conversationId: targetId,
          seekerEnabled: deps.seekerEnabled,
          signal: controller.signal,
          onToken: (token) =>
            updateMessage(targetId, assistantId, (message) => ({
              ...message,
              content: message.content + token,
            })),
        })
        // A user stop (feat-270) finalizes quietly below; any OTHER abort
        // (deactivation, StrictMode cycle) skips the finalize — the tree is
        // gone. The finally below still releases the slot either way.
        const wasStopped = stopped.delete(targetId)
        if (!active || (controller.signal.aborted && !wasStopped)) {
          return
        }
        if (result.ok) {
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.text,
            sources: result.sources,
            grounded: result.grounded,
            engine: result.engine,
            // feat-328: terminal-frame only (plan D3) — absent on a turn that
            // featured nothing, and on every stub turn.
            video: result.video,
          }))
          if (result.engine === "seeker") {
            // KTD10: the persisted predicate keys on a SUCCESSFUL Seeker turn
            // only — the failure branch below also stamps the engine tag on
            // turns that never reached the server, so tag presence is not it.
            markServerPersisted(targetId)
          }
        } else if (result.reason === "gate_denied" && stubOnGateDenied) {
          // Ruling 3 (feat-281): the seam reports gate denials honestly; a
          // never-persisted conversation keeps the feat-233 stub downgrade,
          // rebuilt inline — NEVER via streamStubReply (its 800ms delay).
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: buildStubReply(trimmed),
            sources: [],
            grounded: false,
            engine: "stub",
            video: undefined,
          }))
        } else if (wasStopped) {
          // User stop (feat-270): finalize with partial text kept — a plain
          // turn, no role="alert" notice, no engine/grounded stamp. Nothing
          // streamed → drop the empty turn instead of a blank bubble.
          conversations = conversations.map((c) => {
            if (c.id !== targetId) return c
            const messages = c.messages
              .map((m) =>
                m.id === assistantId
                  ? { ...m, content: result.partialText || m.content }
                  : m,
              )
              .filter((m) => m.id !== assistantId || m.content.length > 0)
            return { ...c, messages }
          })
          commit()
          // Mastra creates the thread row BEFORE generating, so a stop that
          // beat the first token may still have persisted the thread. Stamp
          // every stopped Seeker turn: a wrong stamp only costs a visible
          // gate_denied notice later; a missing one silently stub-forks.
          if (deps.seekerEnabled) {
            markServerPersisted(targetId)
          }
        } else {
          // Keep whatever streamed (partialText); mark the failure so the UI
          // renders a visible notice (R14/R17). The turn is still attributable
          // to its engine (R20).
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.partialText || message.content,
            engine: deps.seekerEnabled ? "seeker" : "stub",
            error: result.reason,
          }))
          // KTD10 refinement: non-empty partial text proves the stream opened
          // through Mastra, which creates the thread row BEFORE generating —
          // so the thread is server-persisted even though this turn failed.
          if (deps.seekerEnabled && result.partialText.length > 0) {
            markServerPersisted(targetId)
          }
        }
      } finally {
        // Belt-and-braces: the consume above sits in the try, so a (today
        // impossible) streamReply rejection must not leak the stopped flag.
        stopped.delete(targetId)
        clearReply(targetId)
      }
    })()
  }

  /** Abort the ACTIVE conversation's in-flight reply (feat-270). The quiet
   * finalize (partial text kept, no failure notice) happens where the stream
   * settles in send(); this only flags the abort as user-initiated. */
  function stopReply() {
    const controller = controllers.get(activeId)
    if (!controller) return
    stopped.add(activeId)
    controller.abort()
  }

  function newConversation() {
    // feat-270: reuse the existing never-used local conversation instead of
    // minting an identical sibling — so at most one fresh row ever exists.
    const existing = conversations.find(
      (c) => c.origin !== "server" && c.messages.length === 0,
    )
    if (existing) {
      if (existing.id !== activeId) {
        activeId = existing.id
        draft = ""
        commit()
      }
      return
    }
    const conversation = createConversation()
    activeId = conversation.id
    conversations = [conversation, ...conversations]
    draft = ""
    commit()
  }

  function selectConversation(id: string) {
    if (id === activeId) return
    activeId = id
    draft = ""
    commit()
    // Selection is the lazy-replay trigger (the old hook's [activeId] effect);
    // newConversation/revert always land on local rows, where this no-ops.
    maybeStartReplay()
  }

  function setDraft(value: string) {
    draft = value
    commit()
  }

  function activate() {
    active = true
    // Hydration fires on activation under a full gate grant (KTD9), guarded on
    // the live phase: only a still-"idle" phase starts over, so the StrictMode
    // cycle re-arms (deactivate rolled "loading" back) without double-fetching.
    if (deps.seekerEnabled && history.phase === "idle") {
      startHistoryFirstPage()
    }
    // Re-arm the active row's replay if deactivation rolled it back mid-fetch
    // (dev-only paths); at first activation the active row is local → no-op.
    maybeStartReplay()
  }

  function deactivate() {
    active = false
    // Abort in-flight streams so their async callbacks don't apply state after
    // teardown; same for in-flight history/replay fetches.
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    historyAbort?.abort()
    // Null it so the next activation lazily mints a FRESH controller instead
    // of reusing the aborted one.
    historyAbort = null
    // Roll back every state only an (aborted) in-flight fetch could complete,
    // so activate() on the SAME instance re-arms instead of wedging — the
    // StrictMode setup → cleanup → setup contract.
    if (history.phase === "loading") {
      history = HISTORY_IDLE
    } else if (history.loadingMore) {
      history = { ...history, loadingMore: false }
    }
    conversations = conversations.map((c) =>
      c.replay === "loading" ? { ...c, replay: "idle" } : c,
    )
    // Safe to clear even with settles pending: a stale finally's delete is a
    // no-op, and the sync "loading" state guards against a double fetch.
    replayInFlight.clear()
    // Mark stale WITHOUT notifying: teardown must never re-render a dying
    // tree; a StrictMode re-subscribe re-reads getSnapshot and rebuilds.
    snapshotDirty = true
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      if (snapshotDirty) {
        snapshot = buildSnapshot()
        snapshotDirty = false
      }
      return snapshot
    },
    activate,
    deactivate,
    setDraft,
    send,
    stopReply,
    selectConversation,
    newConversation,
    retryHistory,
    loadMoreHistory,
    retryReplay,
  }
}
