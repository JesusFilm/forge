// feat-209 adopt-by-id suite for the conversation session, split out of
// conversation-session.test.ts so neither file crosses the 1k-line bar; the
// shared fixtures + makeSession live in conversation-session-test-harness.ts.
import { describe, expect, it } from "vitest"

import { orderConversations } from "./conversation-session"
import {
  deferred,
  flush,
  makeSession,
  ROW,
} from "./conversation-session-test-harness"
import {
  type FetchHistoryPageResult,
  type FetchHistoryThreadResult,
} from "./history-client"

// feat-209 (KTD3): starting on, or adopting at runtime, a server thread id
// the session has never seen — the deep-link / popstate machinery.
describe("adopt-by-id (feat-209)", () => {
  const DEEP_ID = "deep-thread-1"

  it("seeds initialConversationId at construction and replays it exactly once on activate", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    const snap = session.getSnapshot()
    expect(snap.conversations).toHaveLength(1)
    expect(snap.activeId).toBe(DEEP_ID)
    expect(snap.activeConversation).toMatchObject({
      id: DEEP_ID,
      title: "",
      messages: [],
      origin: "server",
      serverPersisted: true,
      replay: "idle",
    })
    // Deliberately unset so a later hydration merge's updatedAt fills it.
    expect(snap.activeConversation.lastActivityAt).toBeUndefined()
    expect(fetchHistoryThread).not.toHaveBeenCalled()
    fetchHistoryThread.mockResolvedValueOnce({
      ok: true,
      messages: [
        { id: "m1", role: "user", text: "old q", createdAt: "" },
        { id: "m2", role: "assistant", text: "old a", createdAt: "" },
      ],
    })
    session.activate()
    await flush()
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
    expect(fetchHistoryThread).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: DEEP_ID }),
    )
    const after = session.getSnapshot().activeConversation
    expect(after.replay).toBe("loaded")
    expect(after.messages.map((m) => m.content)).toEqual(["old q", "old a"])
    // The seeded "" title backfills from the first replayed user turn.
    expect(after.title).toBe("old q")
  })

  it("merges a later hydration page over the adopted row without duplicating it", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    const replayGate = deferred<FetchHistoryThreadResult>()
    const pageGate = deferred<FetchHistoryPageResult>()
    fetchHistoryThread.mockImplementationOnce(() => replayGate.promise)
    fetchHistoryPage.mockImplementationOnce(() => pageGate.promise)
    session.activate()
    replayGate.resolve({
      ok: true,
      messages: [{ id: "m1", role: "user", text: "old q", createdAt: "" }],
    })
    await flush()
    pageGate.resolve({
      ok: true,
      threads: [{ id: DEEP_ID, title: "LLM Title", updatedAt: ROW.updatedAt }],
      hasMore: false,
    })
    await flush()
    const snap = session.getSnapshot()
    expect(snap.conversations.filter((c) => c.id === DEEP_ID)).toHaveLength(1)
    const row = snap.conversations.find((c) => c.id === DEEP_ID)!
    // Messages/replay untouched; updatedAt fills the omitted activity key;
    // the non-empty server title wins over the replay backfill.
    expect(row.messages.map((m) => m.content)).toEqual(["old q"])
    expect(row.replay).toBe("loaded")
    expect(row.lastActivityAt).toBe(ROW.updatedAt)
    expect(row.title).toBe("LLM Title")
  })

  it("pins the ACTIVE adopted row above hydrated rows and unpins it once deselected", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryPage.mockResolvedValueOnce({
      ok: true,
      threads: [ROW],
      hasMore: false,
    })
    fetchHistoryThread.mockImplementation(() => new Promise(() => {}))
    session.activate()
    await flush()
    let snap = session.getSnapshot()
    expect(
      orderConversations(snap.conversations, snap.activeId).map((c) => c.id),
    ).toEqual([DEEP_ID, ROW.id])
    session.selectConversation(ROW.id)
    snap = session.getSnapshot()
    // Active-scoped pin: deselected, the key-less row falls to last (key 0).
    expect(
      orderConversations(snap.conversations, snap.activeId).map((c) => c.id),
    ).toEqual([ROW.id, DEEP_ID])
  })

  it("adopts a known id by selecting it — no refetch of a loaded replay, even after a revert", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
    })
    fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockResolvedValueOnce({ ok: false, reason: "access" })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: "m1", role: "user", text: "old q", createdAt: "" }],
    })
    session.activate()
    await flush()
    expect(session.adoptConversation(ROW.id)).toBe(true)
    await flush()
    expect(session.getSnapshot().activeId).toBe(ROW.id)
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    session.newConversation()
    expect(session.adoptConversation(ROW.id)).toBe(true)
    expect(session.getSnapshot().activeId).toBe(ROW.id)
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
    // Mid-session revert: the replayed row is client state now and must stay
    // traversable — the refusal covers UNKNOWN ids only.
    session.newConversation()
    session.loadMoreHistory()
    await flush()
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      ROW.id,
    )
    expect(session.adoptConversation(ROW.id)).toBe(true)
    expect(session.getSnapshot().activeId).toBe(ROW.id)
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
  })

  it("adopts an unknown id: seeds a server row, replays, blocks sends until loaded (R22)", async () => {
    const { session, streamReply, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
    })
    const replayGate = deferred<FetchHistoryThreadResult>()
    fetchHistoryThread.mockImplementationOnce(() => replayGate.promise)
    session.activate()
    await flush()
    expect(session.adoptConversation("srv-unseen")).toBe(true)
    const snap = session.getSnapshot()
    expect(snap.activeId).toBe("srv-unseen")
    expect(snap.activeConversation).toMatchObject({
      origin: "server",
      serverPersisted: true,
      replay: "loading",
      title: "",
    })
    session.send("too early")
    expect(streamReply).not.toHaveBeenCalled()
    expect(session.getSnapshot().activeConversation.messages).toEqual([])
    replayGate.resolve({ ok: true, messages: [] })
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    session.send("now it goes")
    expect(streamReply).toHaveBeenCalledTimes(1)
  })

  it("refuses an unknown id after a 401-driven revert: returns false, adds no row", async () => {
    const { session, fetchHistoryPage } = makeSession({ seekerEnabled: true })
    fetchHistoryPage.mockResolvedValueOnce({ ok: false, reason: "access" })
    session.activate()
    await flush()
    const before = session.getSnapshot()
    expect(session.adoptConversation("srv-unseen")).toBe(false)
    // No row, no state change at all — the identical snapshot proves it.
    expect(session.getSnapshot()).toBe(before)
    expect(before.conversations.map((c) => c.id)).not.toContain("srv-unseen")
  })

  it("survives a mid-flight access denial on the deep link with replay not_available (R1)", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryThread.mockImplementationOnce(() => new Promise(() => {}))
    fetchHistoryPage.mockResolvedValueOnce({ ok: false, reason: "access" })
    session.activate()
    expect(session.getSnapshot().activeConversation.replay).toBe("loading")
    await flush()
    const snap = session.getSnapshot()
    // Never a silently vacated pane: the row survives the revert, active.
    expect(snap.activeId).toBe(DEEP_ID)
    expect(snap.activeConversation.id).toBe(DEEP_ID)
    expect(snap.activeConversation.replay).toBe("not_available")
    expect(snap.history).toEqual({
      loading: false,
      error: false,
      hasMore: false,
      loadingMore: false,
      loadMoreError: false,
    })
  })

  it("keeps rule-1 protection after hydration listed the deep link: a later replay denial never vacates the pane", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    const replayGate = deferred<FetchHistoryThreadResult>()
    fetchHistoryThread.mockImplementationOnce(() => replayGate.promise)
    fetchHistoryPage.mockResolvedValueOnce({
      ok: true,
      threads: [{ id: DEEP_ID, title: "", updatedAt: ROW.updatedAt }],
      hasMore: false,
    })
    session.activate()
    await flush()
    // The page landed first: marker cleared, row merged, still message-less.
    expect(session.getSnapshot().activeConversation.replay).toBe("loading")
    replayGate.resolve({ ok: false, reason: "access" })
    await flush()
    const snap = session.getSnapshot()
    // The deep-link row survives the revert, active — never a vacated pane.
    expect(snap.activeId).toBe(DEEP_ID)
    expect(snap.activeConversation.id).toBe(DEEP_ID)
    expect(snap.activeConversation.replay).toBe("not_available")
  })

  it("keeps a LOADED adopted row's transcript through a revert — never flipped, never dropped", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: "m1", role: "user", text: "old q", createdAt: "" }],
    })
    const pageGate = deferred<FetchHistoryPageResult>()
    fetchHistoryPage.mockImplementationOnce(() => pageGate.promise)
    session.activate()
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    // The list fetch 401s AFTER the replay proved ownership: the loaded row
    // is kept client state (R16 silence), not flipped to not_available.
    pageGate.resolve({ ok: false, reason: "access" })
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    session.newConversation()
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      DEEP_ID,
    )
  })

  it("drops a deselected adopted row whose replay resolved not_available (R2)", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    session.activate()
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe(
      "not_available",
    )
    session.newConversation()
    expect(session.getSnapshot().conversations.map((c) => c.id)).not.toContain(
      DEEP_ID,
    )
  })

  it("re-adopts a session-dead id from cache: replay not_available, never a refetch", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    session.activate()
    await flush()
    expect(session.adoptConversation("srv-dead")).toBe(true)
    await flush()
    expect(session.getSnapshot().activeConversation.replay).toBe(
      "not_available",
    )
    session.newConversation()
    expect(session.getSnapshot().conversations.map((c) => c.id)).not.toContain(
      "srv-dead",
    )
    // Back into the dead id (popstate): the cached terminal state re-renders;
    // the plan's residual holds — "session-cached, cannot repeat" the fetch.
    expect(session.adoptConversation("srv-dead")).toBe(true)
    const snap = session.getSnapshot()
    expect(snap.activeId).toBe("srv-dead")
    expect(snap.activeConversation.replay).toBe("not_available")
    expect(fetchHistoryThread).toHaveBeenCalledTimes(1)
  })

  it("drops a re-adopted dead row again on the next deselect (R2 still holds)", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    session.activate()
    await flush()
    session.adoptConversation("srv-dead")
    await flush()
    session.newConversation()
    session.adoptConversation("srv-dead")
    expect(session.getSnapshot().activeId).toBe("srv-dead")
    session.newConversation()
    expect(session.getSnapshot().conversations.map((c) => c.id)).not.toContain(
      "srv-dead",
    )
  })

  it("never drops a hydration-merged row on deselect — the marker was cleared", async () => {
    const { session, fetchHistoryPage, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryPage.mockResolvedValueOnce({
      ok: true,
      threads: [{ id: DEEP_ID, title: "", updatedAt: ROW.updatedAt }],
      hasMore: false,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    session.activate()
    await flush()
    session.newConversation()
    expect(session.getSnapshot().conversations.map((c) => c.id)).toContain(
      DEEP_ID,
    )
  })

  it("re-arms an in-flight adopted replay across the StrictMode cycle", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryThread
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ id: "m1", role: "user", text: "old q", createdAt: "" }],
      })
    session.activate()
    expect(session.getSnapshot().activeConversation.replay).toBe("loading")
    session.deactivate()
    // The rollback covers the seeded row exactly like any server row…
    expect(session.getSnapshot().activeConversation.replay).toBe("idle")
    session.activate()
    await flush()
    // …so the SAME instance refetches and completes.
    expect(fetchHistoryThread).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().activeConversation.replay).toBe("loaded")
    expect(
      session.getSnapshot().activeConversation.messages.map((m) => m.content),
    ).toEqual(["old q"])
  })

  it("keeps 'denied' across the cycle only when a real denial set it", async () => {
    // A real denial survives deactivate/activate: adoption stays refused.
    const denied = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    denied.fetchHistoryThread.mockImplementation(() => new Promise(() => {}))
    denied.fetchHistoryPage.mockResolvedValueOnce({
      ok: false,
      reason: "access",
    })
    denied.session.activate()
    await flush()
    denied.session.deactivate()
    denied.session.activate()
    await flush()
    // No re-hydration (phase is terminal, not rolled back to idle)…
    expect(denied.fetchHistoryPage).toHaveBeenCalledTimes(1)
    expect(denied.session.adoptConversation("srv-unseen")).toBe(false)
    // …while deactivation alone never manufactures a denial.
    const clean = makeSession({ seekerEnabled: true })
    clean.fetchHistoryPage.mockImplementationOnce(() => new Promise(() => {}))
    clean.session.activate()
    clean.session.deactivate()
    clean.session.activate()
    await flush()
    expect(clean.session.adoptConversation("srv-unseen")).toBe(true)
  })

  it("leaves a reachable pane when the adopted replay resolves not_available", async () => {
    const { session, fetchHistoryThread } = makeSession({
      seekerEnabled: true,
      initialConversationId: DEEP_ID,
    })
    fetchHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    session.activate()
    await flush()
    const snap = session.getSnapshot()
    expect(snap.activeId).toBe(DEEP_ID)
    expect(snap.conversations.map((c) => c.id)).toContain(DEEP_ID)
    expect(snap.activeConversation.replay).toBe("not_available")
  })

  it("still seeds exactly one fresh local row without initialConversationId", () => {
    const { session } = makeSession()
    const snap = session.getSnapshot()
    expect(snap.conversations).toHaveLength(1)
    expect(snap.activeId).toBe(snap.conversations[0]!.id)
    expect(snap.conversations[0]).toMatchObject({
      title: "New conversation",
      messages: [],
    })
    expect(snap.conversations[0]!.origin).toBeUndefined()
    expect(snap.conversations[0]!.replay).toBeUndefined()
  })
})
