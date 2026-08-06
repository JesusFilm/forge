// Direct unit coverage for the conversation session (feat-281): injected
// streamReply + history fetchers drive every machine through the store
// interface — no DOM, no React. Behavioral flows stay in the shell suites.
import { describe, expect, it, vi } from "vitest"

import {
  buildStubReply,
  type StreamReplyInput,
  type StreamReplyResult,
} from "./chat-stub"
import {
  createConversationSession,
  type ConversationSessionDeps,
} from "./conversation-session"
import {
  type FetchHistoryPageResult,
  type FetchHistoryThreadResult,
} from "./history-client"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Flushes the microtask/macrotask chain the fire-and-forget callbacks settle
// on (real timers — the suite never uses fake ones).
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const OK_STUB: StreamReplyResult = {
  ok: true,
  text: "stub reply",
  sources: [],
  grounded: false,
  engine: "stub",
}

const OK_SEEKER: StreamReplyResult = {
  ok: true,
  text: "seeker reply",
  sources: [],
  grounded: true,
  engine: "seeker",
}

const VIDEO = {
  videoId: "vid_1",
  title: "Jesus Calms the Storm",
  playbackId: "abcdEFGH1234",
  durationSeconds: 754,
  watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
}

const ROW = {
  id: "thread-1",
  title: "Server thread",
  updatedAt: "2026-07-12T08:00:00.000Z",
}

function makeSession(over: Partial<ConversationSessionDeps> = {}) {
  const streamReply = vi.fn<ConversationSessionDeps["streamReply"]>(
    async () => OK_STUB,
  )
  const fetchHistoryPage = vi.fn<ConversationSessionDeps["fetchHistoryPage"]>(
    async () => ({ ok: true, threads: [], hasMore: false }),
  )
  const fetchHistoryThread = vi.fn<
    ConversationSessionDeps["fetchHistoryThread"]
  >(async () => ({ ok: true, messages: [] }))
  const session = createConversationSession({
    streamReply,
    fetchHistoryPage,
    fetchHistoryThread,
    seekerEnabled: false,
    ...over,
  })
  return { session, streamReply, fetchHistoryPage, fetchHistoryThread }
}

describe("snapshot contract", () => {
  it("returns the identical snapshot object until a real change commits", () => {
    const { session } = makeSession()
    const first = session.getSnapshot()
    expect(session.getSnapshot()).toBe(first)
    session.setDraft("typing")
    const second = session.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.draft).toBe("typing")
    expect(session.getSnapshot()).toBe(second)
  })

  it("constructs side-effect-free: no dep is called before activate()", () => {
    const { session, streamReply, fetchHistoryPage, fetchHistoryThread } =
      makeSession({ seekerEnabled: true })
    expect(session.getSnapshot().conversations).toHaveLength(1)
    expect(streamReply).not.toHaveBeenCalled()
    expect(fetchHistoryPage).not.toHaveBeenCalled()
    expect(fetchHistoryThread).not.toHaveBeenCalled()
  })

  it("notifies subscribers on commit and stops after unsubscribe", () => {
    const { session } = makeSession()
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)
    session.setDraft("a")
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    session.setDraft("b")
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("draft + selection semantics", () => {
  it("clears the draft on a real send, keeps it on a guarded (whitespace) one", () => {
    const { session, streamReply } = makeSession()
    session.setDraft("   ")
    session.send("   ")
    expect(streamReply).not.toHaveBeenCalled()
    expect(session.getSnapshot().draft).toBe("   ")
    session.setDraft("real question")
    session.send("real question")
    expect(session.getSnapshot().draft).toBe("")
  })

  it("keeps the draft when reselecting the active conversation, clears it on a switch", async () => {
    const { session } = makeSession()
    session.send("first")
    await flush()
    session.newConversation()
    const freshId = session.getSnapshot().activeId
    session.setDraft("in progress")
    session.selectConversation(freshId)
    expect(session.getSnapshot().draft).toBe("in progress")
    const other = session
      .getSnapshot()
      .conversations.find((c) => c.id !== freshId)
    session.selectConversation(other!.id)
    expect(session.getSnapshot().draft).toBe("")
  })

  it("reuses the existing empty local conversation from New instead of minting a sibling", async () => {
    const { session } = makeSession()
    session.send("topic")
    await flush()
    session.newConversation()
    const freshId = session.getSnapshot().activeId
    session.setDraft("half a thought")
    session.newConversation()
    // No-op onto the already-active empty: same id, draft preserved.
    expect(session.getSnapshot().activeId).toBe(freshId)
    expect(session.getSnapshot().draft).toBe("half a thought")
    expect(
      session
        .getSnapshot()
        .conversations.filter((c) => c.messages.length === 0),
    ).toHaveLength(1)
  })
})

describe("reply lifecycle", () => {
  it("appends the user turn + empty assistant turn, streams tokens, finalizes on ok", async () => {
    const { session: s, streamReply } = makeSession()
    const gate = deferred<StreamReplyResult>()
    let onToken: ((text: string) => void) | undefined
    streamReply.mockImplementation((input: StreamReplyInput) => {
      onToken = input.onToken
      return gate.promise
    })
    s.send("hello")
    let snap = s.getSnapshot()
    expect(snap.pending).toBe(true)
    expect(snap.activeConversation.messages.map((m) => m.content)).toEqual([
      "hello",
      "",
    ])
    expect(snap.streamingMessageId).toBe(
      snap.activeConversation.messages[1]!.id,
    )
    onToken?.("par")
    onToken?.("tial")
    expect(s.getSnapshot().activeConversation.messages[1]!.content).toBe(
      "partial",
    )
    gate.resolve(OK_STUB)
    await flush()
    snap = s.getSnapshot()
    expect(snap.pending).toBe(false)
    expect(snap.streamingMessageId).toBeNull()
    const final = snap.activeConversation.messages[1]!
    expect(final.content).toBe("stub reply")
    expect(final.engine).toBe("stub")
  })

  it("no-ops a second send into the same conversation while one is in flight", () => {
    const { session, streamReply } = makeSession()
    streamReply.mockImplementation(
      () => new Promise<StreamReplyResult>(() => {}),
    )
    session.send("once")
    session.send("twice")
    expect(streamReply).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().activeConversation.messages).toHaveLength(2)
  })

  it("tracks pending PER conversation: parallel sends in two conversations", async () => {
    const { session, streamReply } = makeSession()
    const gates: Array<ReturnType<typeof deferred<StreamReplyResult>>> = []
    streamReply.mockImplementation(() => {
      const gate = deferred<StreamReplyResult>()
      gates.push(gate)
      return gate.promise
    })
    session.send("alpha")
    const alphaId = session.getSnapshot().activeId
    session.newConversation()
    session.send("beta")
    const betaId = session.getSnapshot().activeId
    expect(session.getSnapshot().pendingIds).toEqual(new Set([alphaId, betaId]))
    gates[0]!.resolve(OK_STUB)
    gates[1]!.resolve(OK_STUB)
    await flush()
    expect(session.getSnapshot().pendingIds.size).toBe(0)
  })

  it("keeps partial text and marks the failure reason on an error terminal", async () => {
    const { session, streamReply } = makeSession()
    streamReply.mockImplementation(async (input: StreamReplyInput) => {
      input.onToken?.("partial answer")
      return {
        ok: false as const,
        reason: "generation_failed" as const,
        partialText: "partial answer",
      }
    })
    session.send("interrupt me")
    await flush()
    const turn = session.getSnapshot().activeConversation.messages[1]!
    expect(turn.content).toBe("partial answer")
    expect(turn.error).toBe("generation_failed")
    expect(turn.engine).toBe("stub")
    expect(session.getSnapshot().pending).toBe(false)
  })

  it("finalizes a user stop quietly: partial kept, empty turn dropped, slot released", async () => {
    const { session, streamReply } = makeSession()
    streamReply.mockImplementation(
      (input: StreamReplyInput) =>
        new Promise<StreamReplyResult>((resolve) => {
          input.signal?.addEventListener("abort", () =>
            resolve({
              ok: false,
              reason: "cancelled",
              partialText: "",
            }),
          )
        }),
    )
    session.send("halt me")
    expect(session.getSnapshot().pending).toBe(true)
    session.stopReply()
    await flush()
    const snap = session.getSnapshot()
    expect(snap.pending).toBe(false)
    // Nothing streamed → the empty assistant turn was dropped, no error mark.
    expect(snap.activeConversation.messages.map((m) => m.content)).toEqual([
      "halt me",
    ])
    expect(snap.activeConversation.messages[0]!.error).toBeUndefined()
  })
})

// Ruling 3 (feat-281): the seam reports gate denials honestly; the session
// decides stub-vs-failure from the serverPersisted predicate it owns. These
// pin the decision at every KTD10 stamp path — and the reconstruction shape.
describe("KTD10 stub-vs-failure decision (all sites in the session)", () => {
  const GATE_DENIED: StreamReplyResult = {
    ok: false,
    reason: "gate_denied",
    partialText: "",
  }

  // The assistant turn of the LAST exchange in the active conversation.
  function lastTurn(session: ReturnType<typeof makeSession>["session"]) {
    const messages = session.getSnapshot().activeConversation.messages
    return messages[messages.length - 1]!
  }

  it("rebuilds the IMMEDIATE inline stub on gate_denied for a never-persisted conversation", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce(GATE_DENIED)
    session.send("fresh question")
    // Real timers + a 0ms flush: had the finalize re-entered streamStubReply,
    // its 800ms STUB_REPLY_DELAY_MS could not have elapsed and content would
    // still be "" here — this asserts the no-delay reconstruction contract.
    await flush()
    const turn = lastTurn(session)
    expect(turn.content).toBe(buildStubReply("fresh question"))
    expect(turn.engine).toBe("stub")
    expect(turn.grounded).toBe(false)
    expect(turn.sources).toEqual([])
    expect(turn.error).toBeUndefined()
    expect(session.getSnapshot().pending).toBe(false)
  })

  it("does not mark the conversation persisted on the stub reconstruction — a second denial still stubs", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValue(GATE_DENIED)
    session.send("first — denied")
    await flush()
    session.send("second — denied again")
    await flush()
    const turn = lastTurn(session)
    expect(turn.content).toBe(buildStubReply("second — denied again"))
    expect(turn.error).toBeUndefined()
  })

  it("fails visibly on gate_denied after a SUCCESSFUL seeker finalize", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce(OK_SEEKER)
    session.send("first")
    await flush()
    streamReply.mockResolvedValueOnce(GATE_DENIED)
    session.send("second")
    await flush()
    const turn = lastTurn(session)
    expect(turn.error).toBe("gate_denied")
    expect(turn.engine).toBe("seeker")
    expect(turn.content).toBe("")
  })

  it("still stubs after a failed turn with NO partial text (never reached the server)", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce({
      ok: false,
      reason: "config_missing",
      partialText: "",
    })
    session.send("first — config failure")
    await flush()
    streamReply.mockResolvedValueOnce(GATE_DENIED)
    session.send("second")
    await flush()
    const turn = lastTurn(session)
    expect(turn.content).toBe(buildStubReply("second"))
    expect(turn.error).toBeUndefined()
  })

  it("fails visibly after a failed turn WITH partial text (stream opened)", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce({
      ok: false,
      reason: "generation_failed",
      partialText: "partial before crash",
    })
    session.send("first — dies mid-stream")
    await flush()
    streamReply.mockResolvedValueOnce(GATE_DENIED)
    session.send("second")
    await flush()
    const turn = lastTurn(session)
    expect(turn.error).toBe("gate_denied")
    expect(turn.content).toBe("")
  })

  it("fails visibly after ANY user-stopped seeker turn (zero-token stop)", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockImplementationOnce(
      (input: StreamReplyInput) =>
        new Promise<StreamReplyResult>((resolve) => {
          input.signal?.addEventListener("abort", () =>
            resolve({ ok: false, reason: "cancelled", partialText: "" }),
          )
        }),
    )
    session.send("stopped before any token")
    session.stopReply()
    await flush()
    streamReply.mockResolvedValueOnce(GATE_DENIED)
    session.send("second")
    await flush()
    const turn = lastTurn(session)
    expect(turn.error).toBe("gate_denied")
    expect(turn.content).toBe("")
  })

  it("stub reconstruction beats a user stop when gate_denied is the settled result (pre-281 precedence)", async () => {
    // Pins the deliberate finalize order (ok -> gate stub -> stopped): before
    // Ruling 3 the seam's fabricated ok-result also beat the stopped flag, so
    // a stop racing an already-terminal gate_denied renders the full stub.
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockImplementationOnce(
      (input: StreamReplyInput) =>
        new Promise<StreamReplyResult>((resolve) => {
          input.signal?.addEventListener("abort", () =>
            resolve({ ok: false, reason: "gate_denied", partialText: "" }),
          )
        }),
    )
    session.send("stopped as the denial lands")
    session.stopReply()
    await flush()
    const turn = lastTurn(session)
    expect(turn.content).toBe(buildStubReply("stopped as the denial lands"))
    expect(turn.engine).toBe("stub")
    expect(turn.error).toBeUndefined()
    expect(session.getSnapshot().pending).toBe(false)
  })

  it("captures the decision at send START — a mid-flight hydration stamp does not flip it", async () => {
    const { session, streamReply, fetchHistoryPage } = makeSession({
      seekerEnabled: true,
    })
    const pageGate = deferred<FetchHistoryPageResult>()
    fetchHistoryPage.mockImplementationOnce(() => pageGate.promise)
    const replyGate = deferred<StreamReplyResult>()
    streamReply.mockImplementationOnce(() => replyGate.promise)
    session.activate()
    session.send("hello")
    const activeId = session.getSnapshot().activeId
    // Hydration lists the ACTIVE conversation while the reply is in flight —
    // mergeServerThreads stamps it serverPersisted mid-request.
    pageGate.resolve({
      ok: true,
      threads: [{ id: activeId, title: "", updatedAt: ROW.updatedAt }],
      hasMore: false,
    })
    await flush()
    expect(session.getSnapshot().activeConversation.serverPersisted).toBe(true)
    replyGate.resolve(GATE_DENIED)
    await flush()
    // The send-start capture (not persisted then) still wins: inline stub.
    const turn = lastTurn(session)
    expect(turn.content).toBe(buildStubReply("hello"))
    expect(turn.error).toBeUndefined()
  })
})

describe("history hydration", () => {
  it("does not fetch on activate when seekerEnabled is false", () => {
    const { session, fetchHistoryPage } = makeSession()
    session.activate()
    expect(fetchHistoryPage).not.toHaveBeenCalled()
  })

  it("hydrates page 0 on activate and merges the listed rows", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage.mockResolvedValueOnce({
      ok: true,
      threads: [ROW],
      hasMore: true,
    })
    session.activate()
    expect(session.getSnapshot().history.loading).toBe(true)
    await flush()
    const snap = session.getSnapshot()
    expect(fetchHistoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0 }),
    )
    expect(snap.history.loading).toBe(false)
    expect(snap.history.hasMore).toBe(true)
    expect(snap.conversations.map((c) => c.id)).toContain(ROW.id)
  })

  it("surfaces the error state on a failed first page and recovers via retryHistory", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: false })
    session.activate()
    await flush()
    expect(session.getSnapshot().history.error).toBe(true)
    session.retryHistory()
    await flush()
    expect(session.getSnapshot().history.error).toBe(false)
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      ROW.id,
    )
  })

  it("loads the next page via loadMoreHistory and flags a failed load-more inline", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
    session.activate()
    await flush()
    session.loadMoreHistory()
    expect(session.getSnapshot().history.loadingMore).toBe(true)
    await flush()
    expect(fetchHistoryPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    )
    const snap = session.getSnapshot()
    expect(snap.history.loadingMore).toBe(false)
    expect(snap.history.loadMoreError).toBe(true)
    // Page-1 rows stay rendered through an inline load-more failure.
    expect(snap.conversations.map((c) => c.id)).toContain(ROW.id)
  })

  it("reverts silently to the client-only sidebar on an access denial", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockResolvedValueOnce({ ok: false, reason: "access" })
    session.activate()
    await flush()
    session.loadMoreHistory()
    await flush()
    const snap = session.getSnapshot()
    expect(snap.conversations.map((c) => c.id)).not.toContain(ROW.id)
    // Quiet: no error banner, no loading — today's client-only look.
    expect(snap.history).toEqual({
      loading: false,
      error: false,
      hasMore: false,
      loadingMore: false,
      loadMoreError: false,
    })
  })
})

describe("replay", () => {
  async function hydrated(threadResult: Promise<FetchHistoryThreadResult>) {
    const setup = makeSession({ seekerEnabled: true })
    setup.fetchHistoryPage.mockResolvedValue({
      ok: true,
      threads: [ROW],
      hasMore: false,
    })
    setup.fetchHistoryThread.mockImplementation(() => threadResult)
    setup.session.activate()
    await flush()
    return setup
  }

  it("lazy-loads a selected server row exactly once and session-caches it", async () => {
    const { session, fetchHistoryThread } = await hydrated(
      Promise.resolve({
        ok: true,
        messages: [
          { id: "m1", role: "user", text: "old q", createdAt: "" },
          { id: "m2", role: "assistant", text: "old a", createdAt: "" },
        ],
      }),
    )
    session.selectConversation(ROW.id)
    await flush()
    expect(
      session.getSnapshot().activeConversation.messages.map((m) => m.content),
    ).toEqual(["old q", "old a"])
    // Select away and back: cached, no refetch.
    session.newConversation()
    session.selectConversation(ROW.id)
    await flush()
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
  })

  it("marks a transport-failed replay 'failed' and refetches only via retryReplay", async () => {
    const setup = await hydrated(
      Promise.resolve({ ok: false, reason: "unavailable" }),
    )
    const { session, fetchHistoryThread } = setup
    session.selectConversation(ROW.id)
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe("failed")
    fetchHistoryThread.mockResolvedValue({ ok: true, messages: [] })
    session.retryReplay()
    await flush()
    expect(fetchHistoryThread).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
  })

  it("treats not_available as terminal for the session", async () => {
    const { session, fetchHistoryThread } = await hydrated(
      Promise.resolve({ ok: false, reason: "not_available" }),
    )
    session.selectConversation(ROW.id)
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe(
      "not_available",
    )
    session.retryReplay()
    await flush()
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
  })

  it("reverts to client-only when replay hits an access denial", async () => {
    const { session } = await hydrated(
      Promise.resolve({ ok: false, reason: "access" }),
    )
    session.selectConversation(ROW.id)
    await flush()
    const snap = session.getSnapshot()
    expect(snap.conversations.map((c) => c.id)).not.toContain(ROW.id)
    expect(snap.activeConversation.origin).toBeUndefined()
  })

  it("blocks sends into a server row until its replay is loaded (R22)", async () => {
    const { session, streamReply } = await hydrated(
      new Promise(() => {}), // replay hangs → stays "loading"
    )
    session.selectConversation(ROW.id)
    session.setDraft("resume question")
    session.send("resume question")
    expect(streamReply).not.toHaveBeenCalled()
    // The draft is untouched — only the send action was refused.
    expect(session.getSnapshot().draft).toBe("resume question")
  })
})

describe("activate → deactivate → activate (the StrictMode contract)", () => {
  it("aborts an in-flight hydration on deactivate and re-arms a full refetch on activate", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    const signals: Array<AbortSignal | undefined> = []
    fetchHistoryPage
      .mockImplementationOnce((input: { signal?: AbortSignal }) => {
        signals.push(input.signal)
        return new Promise(() => {})
      })
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: false })
    session.activate()
    expect(session.getSnapshot().history.loading).toBe(true)
    session.deactivate()
    expect(signals[0]?.aborted).toBe(true)
    // The rollback leaves no wedged "loading" behind…
    expect(session.getSnapshot().history.loading).toBe(false)
    session.activate()
    await flush()
    // …so the SAME instance refetches: exactly two fetches, both page 0.
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      ROW.id,
    )
  })

  it("never applies a late hydration result that resolves after deactivate", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    const gate = deferred<FetchHistoryPageResult>()
    fetchHistoryPage.mockImplementationOnce(() => gate.promise)
    session.activate()
    session.deactivate()
    gate.resolve({ ok: true, threads: [ROW], hasMore: false })
    await flush()
    expect(session.getSnapshot().conversations.map((c) => c.id)).not.toContain(
      ROW.id,
    )
  })

  it("aborts in-flight replies on deactivate without finalizing them", async () => {
    const { session, streamReply } = makeSession()
    const gate = deferred<StreamReplyResult>()
    let signal: AbortSignal | undefined
    streamReply.mockImplementation((input: StreamReplyInput) => {
      signal = input.signal
      return gate.promise
    })
    session.activate()
    session.send("mid-flight")
    session.deactivate()
    expect(signal?.aborted).toBe(true)
    session.activate()
    gate.resolve(OK_STUB)
    await flush()
    const snap = session.getSnapshot()
    // The aborted turn was never finalized (no text applied) and no slot leaks.
    expect(snap.activeConversation.messages[1]!.content).toBe("")
    expect(snap.pendingIds.size).toBe(0)
  })

  it("does not notify subscribers during deactivate (teardown never re-renders)", () => {
    const { session } = makeSession({ seekerEnabled: true })
    const listener = vi.fn()
    session.subscribe(listener)
    session.activate()
    const calls = listener.mock.calls.length
    session.deactivate()
    expect(listener).toHaveBeenCalledTimes(calls)
    // The cached snapshot still reflects the rollback for the next subscriber.
    expect(session.getSnapshot().history.loading).toBe(false)
  })

  it("rolls back an in-flight Load more on deactivate; the loaded page survives", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockImplementationOnce(() => new Promise(() => {}))
    session.activate()
    await flush()
    session.loadMoreHistory()
    expect(session.getSnapshot().history.loadingMore).toBe(true)
    session.deactivate()
    // No wedge: the flag an aborted fetch could never clear is rolled back,
    // and the page-1 rows stay (phase "loaded" is real completed state).
    expect(session.getSnapshot().history.loadingMore).toBe(false)
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      ROW.id,
    )
    session.activate()
    await flush()
    // Re-arm does NOT re-hydrate (phase is "loaded", not "idle").
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2)
  })

  it("rolls a loading replay back to idle on deactivate and re-arms it on activate", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
    })
    fetchHistoryPage.mockResolvedValue({
      ok: true,
      threads: [ROW],
      hasMore: false,
    })
    fetchHistoryThread
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ id: "m1", role: "user", text: "old q", createdAt: "" }],
      })
    session.activate()
    await flush()
    session.selectConversation(ROW.id)
    expect(session.getSnapshot().activeConversation.replay).toBe("loading")
    session.deactivate()
    // The state only an aborted fetch could complete is rolled back…
    expect(session.getSnapshot().activeConversation.replay).toBe("idle")
    session.activate()
    await flush()
    // …and activate re-arms the ACTIVE row's replay on the SAME instance.
    expect(fetchHistoryThread).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    expect(
      session.getSnapshot().activeConversation.messages.map((m) => m.content),
    ).toEqual(["old q"])
  })
})

describe("featured video on the finalized turn (feat-328)", () => {
  function lastTurn(session: ReturnType<typeof makeSession>["session"]) {
    const messages = session.getSnapshot().activeConversation.messages
    return messages[messages.length - 1]!
  }

  it("lands the terminal result's video on the finalized assistant message", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce({ ...OK_SEEKER, video: VIDEO })
    session.send("show me a video about the storm")
    await flush()
    expect(lastTurn(session).video).toEqual(VIDEO)
  })

  it("leaves video absent when the terminal result carries none", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce(OK_SEEKER)
    session.send("a plain question")
    await flush()
    expect(lastTurn(session).video).toBeUndefined()
  })

  it("never attaches a video on a failed terminal", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce({
      ok: false,
      reason: "timeout",
      partialText: "part",
    })
    session.send("q")
    await flush()
    const turn = lastTurn(session)
    expect(turn.error).toBe("timeout")
    expect(turn.video).toBeUndefined()
  })

  it("never attaches a video on the gate_denied stub-downgrade rebuild", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    streamReply.mockResolvedValueOnce({
      ok: false,
      reason: "gate_denied",
      partialText: "",
    })
    session.send("q")
    await flush()
    const turn = lastTurn(session)
    expect(turn.engine).toBe("stub")
    expect(turn.video).toBeUndefined()
  })

  it("carries a video only onto the conversation the send targeted", async () => {
    const { session, streamReply } = makeSession({ seekerEnabled: true })
    const first = session.getSnapshot().activeConversation.id
    const pending = deferred<StreamReplyResult>()
    streamReply.mockReturnValueOnce(pending.promise)
    session.send("q in the first conversation")
    session.newConversation()
    pending.resolve({ ...OK_SEEKER, video: VIDEO })
    await flush()
    const snapshot = session.getSnapshot()
    expect(snapshot.activeConversation.id).not.toBe(first)
    expect(snapshot.activeConversation.messages).toEqual([])
    const target = snapshot.conversations.find((c) => c.id === first)!
    expect(target.messages[target.messages.length - 1]!.video).toEqual(VIDEO)
  })
})

describe("module contract", () => {
  it("stays React-free: no react import may enter the session module", async () => {
    const { readFile } = await import("node:fs/promises")
    const { resolve } = await import("node:path")
    const source = await readFile(
      resolve(process.cwd(), "src/lib/conversation-session.ts"),
      "utf8",
    )
    expect(source).not.toMatch(/from\s+["']react["']|require\(["']react["']\)/)
  })

  it("resets every additive assistant field at the gate_denied rebuild site", async () => {
    // The behavioral reset test above is vacuous by construction today (no
    // live path writes `video` before the finalize), so pin the SITE: dropping
    // `video: undefined` from the rebuild literal must fail something.
    const { readFile } = await import("node:fs/promises")
    const { resolve } = await import("node:path")
    const source = await readFile(
      resolve(process.cwd(), "src/lib/conversation-session.ts"),
      "utf8",
    )
    const rebuild = source.slice(
      source.indexOf("content: buildStubReply(trimmed)"),
    )
    const literalEnd = rebuild.indexOf("}))")
    expect(literalEnd).toBeGreaterThan(0)
    // Strip comments before matching, mirroring the mastra source-pin
    // precedent: a bare substring check stays green when the reset line is
    // commented out, which is exactly the bypass this pin exists to catch.
    const literal = rebuild
      .slice(0, literalEnd)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    for (const field of ["sources:", "grounded:", "engine:", "video:"]) {
      expect(literal).toContain(field)
    }
    expect(literal.match(/\bvideo:/g)).toHaveLength(1)
  })
})
