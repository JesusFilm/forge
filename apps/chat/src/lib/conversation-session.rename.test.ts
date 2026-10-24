// Direct unit coverage for the rename action (feat-450, KTD6 + KTD7): the
// pessimistic commit, the per-id slot released on every settlement path, the
// stale-page fence, and the lifecycle rollback. Split to stay under 1k lines.
import { describe, expect, it, vi } from "vitest"

import { mergeServerThreads } from "./conversation-session"
import {
  deferred,
  flush,
  makeSession,
  ROW,
} from "./conversation-session-test-harness"
import {
  type FetchHistoryPageResult,
  type RenameHistoryThreadResult,
} from "./history-client"

const SECOND = {
  id: "thread-2",
  title: "Second thread",
  updatedAt: "2026-07-11T08:00:00.000Z",
}

/** A session hydrated with ROW + SECOND (both server-persisted), active on
 * the fresh local row so both server rows are BACKGROUND rows. */
async function hydrated(over: Parameters<typeof makeSession>[0] = {}) {
  const setup = makeSession({ seekerEnabled: true, ...over })
  setup.fetchHistoryPage.mockResolvedValueOnce({
    ok: true,
    threads: [ROW, SECOND],
    hasMore: false,
  })
  setup.session.activate()
  await flush()
  return setup
}

function titleOf(
  session: ReturnType<typeof makeSession>["session"],
  id: string,
): string | undefined {
  return session.getSnapshot().conversations.find((c) => c.id === id)?.title
}

function idsOf(session: ReturnType<typeof makeSession>["session"]): string[] {
  return session.getSnapshot().conversations.map((c) => c.id)
}

describe("renameConversation — pessimistic commit (KD5, R9)", () => {
  it("renames a persisted background row: one fetch with the normalized title, title applied only after the result, position unchanged, slot released", async () => {
    const { session, renameHistoryThread } = await hydrated()
    const gate = deferred<RenameHistoryThreadResult>()
    renameHistoryThread.mockImplementationOnce(() => gate.promise)
    const before = idsOf(session)

    const pending = session.renameConversation(ROW.id, "  My   own\ttitle ")
    // Pessimistic: nothing changes until the server confirms.
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
    expect(session.getSnapshot().renamingIds).toEqual(new Set([ROW.id]))
    expect(renameHistoryThread).toHaveBeenCalledTimes(1)
    expect(renameHistoryThread).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: ROW.id,
        title: "My own title",
      }),
    )

    gate.resolve({ ok: true, title: "My own title" })
    expect(await pending).toEqual({ ok: true })
    expect(titleOf(session, ROW.id)).toBe("My own title")
    expect(idsOf(session)).toEqual(before)
    expect(session.getSnapshot().renamingIds.size).toBe(0)
  })

  it("leaves the title unchanged when the fetch fails", async () => {
    const { session, renameHistoryThread } = await hydrated()
    renameHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "unavailable",
    })
    const result = await session.renameConversation(ROW.id, "Nope")
    expect(result).toEqual({ ok: false, reason: "unavailable" })
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
  })

  it("adopts the ECHOED title when the server's clamp differs from the draft", async () => {
    const { session, renameHistoryThread } = await hydrated()
    renameHistoryThread.mockResolvedValueOnce({ ok: true, title: "Clamped" })
    await session.renameConversation(ROW.id, "Clamped and then some more")
    expect(titleOf(session, ROW.id)).toBe("Clamped")
  })

  it("commits a row that is NOT server-persisted locally, with zero fetches", async () => {
    const { session, renameHistoryThread } = makeSession()
    session.send("first question")
    await flush()
    const localId = session.getSnapshot().activeId
    expect(session.getSnapshot().activeConversation.serverPersisted).not.toBe(
      true,
    )
    const result = await session.renameConversation(localId, "Local name")
    expect(result).toEqual({ ok: true })
    expect(titleOf(session, localId)).toBe("Local name")
    expect(renameHistoryThread).not.toHaveBeenCalled()
  })

  it("does not commit a title into a torn-down tree (result lands after deactivate)", async () => {
    const { session, renameHistoryThread } = await hydrated()
    const gate = deferred<RenameHistoryThreadResult>()
    renameHistoryThread.mockImplementationOnce(() => gate.promise)
    const pending = session.renameConversation(ROW.id, "Late")
    session.deactivate()
    gate.resolve({ ok: true, title: "Late" })
    await pending
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
  })
})

describe("renameConversation — quiet no-ops (KD4: AE2, R6, R7)", () => {
  it.each([
    ["empty", ""],
    ["whitespace-only", "   \n\t "],
    ["invisible-format-only", "\u200b\u200d\ufeff\u00ad"],
    ["control-only", "\u0007\u001f"],
  ])("returns ok without a fetch for a %s draft", async (_label, draft) => {
    const { session, renameHistoryThread } = await hydrated()
    expect(await session.renameConversation(ROW.id, draft)).toEqual({
      ok: true,
    })
    expect(renameHistoryThread).not.toHaveBeenCalled()
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
    expect(session.getSnapshot().renamingIds.size).toBe(0)
  })

  it("returns ok without a fetch when the normalized draft equals the current title", async () => {
    const { session, renameHistoryThread } = await hydrated()
    await session.renameConversation(ROW.id, `  ${ROW.title}  `)
    expect(renameHistoryThread).not.toHaveBeenCalled()
  })

  it("returns ok without a fetch for an unknown id", async () => {
    const { session, renameHistoryThread } = await hydrated()
    expect(await session.renameConversation("nope", "Title")).toEqual({
      ok: true,
    })
    expect(renameHistoryThread).not.toHaveBeenCalled()
  })

  it("is a no-op for a second call while the same id is in flight (one fetch)", async () => {
    const { session, renameHistoryThread } = await hydrated()
    const gate = deferred<RenameHistoryThreadResult>()
    renameHistoryThread.mockImplementationOnce(() => gate.promise)
    const first = session.renameConversation(ROW.id, "One")
    const second = session.renameConversation(ROW.id, "Two")
    expect(renameHistoryThread).toHaveBeenCalledTimes(1)
    gate.resolve({ ok: true, title: "One" })
    await Promise.all([first, second])
    expect(titleOf(session, ROW.id)).toBe("One")
  })

  it("renames two different rows in parallel — the slot is per id", async () => {
    const { session, renameHistoryThread } = await hydrated()
    renameHistoryThread.mockImplementation(async ({ title }) => ({
      ok: true,
      title,
    }))
    await Promise.all([
      session.renameConversation(ROW.id, "A"),
      session.renameConversation(SECOND.id, "B"),
    ])
    expect(renameHistoryThread).toHaveBeenCalledTimes(2)
    expect(titleOf(session, ROW.id)).toBe("A")
    expect(titleOf(session, SECOND.id)).toBe("B")
  })
})

describe("renameConversation — slot release on every settlement path (the slot-leak law)", () => {
  it.each(["access", "invalid_title", "unavailable"] as const)(
    "after a %s failure the id leaves renamingIds and a retry issues a new fetch",
    async (reason) => {
      const { session, renameHistoryThread } = await hydrated()
      renameHistoryThread
        .mockResolvedValueOnce({ ok: false, reason })
        .mockResolvedValueOnce({ ok: true, title: "Retry" })
      expect(await session.renameConversation(ROW.id, "First")).toEqual({
        ok: false,
        reason,
      })
      expect(session.getSnapshot().renamingIds.size).toBe(0)
      expect(await session.renameConversation(ROW.id, "Retry")).toEqual({
        ok: true,
      })
      expect(renameHistoryThread).toHaveBeenCalledTimes(2)
      expect(titleOf(session, ROW.id)).toBe("Retry")
    },
  )

  it("releases the slot on a synchronous throw before the await, and a retry fetches again", async () => {
    const { session, renameHistoryThread } = await hydrated()
    renameHistoryThread
      .mockImplementationOnce(() => {
        throw new Error("sync throw")
      })
      .mockResolvedValueOnce({ ok: true, title: "Retry" })
    const first = await session
      .renameConversation(ROW.id, "First")
      .catch(() => "threw")
    // The action never rejects into the caller: a throw is an outage.
    expect(first).toEqual({ ok: false, reason: "unavailable" })
    expect(session.getSnapshot().renamingIds.size).toBe(0)
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
    expect(await session.renameConversation(ROW.id, "Retry")).toEqual({
      ok: true,
    })
    expect(renameHistoryThread).toHaveBeenCalledTimes(2)
  })

  it.each(["success", "rejection"] as const)(
    "keeps a replacement rename active when the aborted request settles with %s after reactivation",
    async (settlement) => {
      const { session, renameHistoryThread } = await hydrated()
      const old = deferred<RenameHistoryThreadResult>()
      const replacement = deferred<RenameHistoryThreadResult>()
      renameHistoryThread
        .mockImplementationOnce(async () => {
          const result = await old.promise
          if (settlement === "rejection") throw new Error("aborted request")
          return result
        })
        .mockImplementationOnce(() => replacement.promise)

      const first = session.renameConversation(ROW.id, "Old draft")
      const oldSignal = renameHistoryThread.mock.calls[0]![0].signal
      session.deactivate()
      expect(oldSignal?.aborted).toBe(true)
      expect(session.getSnapshot().renamingIds.size).toBe(0)
      session.activate()
      expect(titleOf(session, ROW.id)).toBe(ROW.title)

      const retry = session.renameConversation(ROW.id, "New draft")
      expect(renameHistoryThread).toHaveBeenCalledTimes(2)
      const newSignal = renameHistoryThread.mock.calls[1]![0].signal
      expect(newSignal).not.toBe(oldSignal)
      expect(newSignal?.aborted).toBe(false)

      old.resolve({ ok: true, title: "Stale server echo" })
      await expect(first).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      })
      expect(titleOf(session, ROW.id)).toBe(ROW.title)
      expect(session.getSnapshot().renamingIds).toEqual(new Set([ROW.id]))
      // The old finally must not free the replacement's slot for a third write.
      await session.renameConversation(ROW.id, "Duplicate draft")
      expect(renameHistoryThread).toHaveBeenCalledTimes(2)

      replacement.resolve({ ok: true, title: "New server echo" })
      await expect(retry).resolves.toEqual({ ok: true })
      expect(titleOf(session, ROW.id)).toBe("New server echo")
      expect(session.getSnapshot().renamingIds.size).toBe(0)
      session.deactivate()
    },
  )

  it("releases the slot on an aborted fetch (deactivate mid-flight) with no title change", async () => {
    const { session, renameHistoryThread } = await hydrated()
    let signal: AbortSignal | undefined
    renameHistoryThread.mockImplementationOnce(
      (input) =>
        new Promise<RenameHistoryThreadResult>((resolve) => {
          signal = input.signal
          input.signal?.addEventListener("abort", () =>
            resolve({ ok: false, reason: "unavailable" }),
          )
        }),
    )
    const pending = session.renameConversation(ROW.id, "Aborted")
    expect(session.getSnapshot().renamingIds).toEqual(new Set([ROW.id]))
    session.deactivate()
    expect(signal?.aborted).toBe(true)
    // KTD7: deactivate() clears the slot synchronously (state only an aborted
    // fetch could complete), like the history/replay rollbacks.
    expect(session.getSnapshot().renamingIds.size).toBe(0)
    await pending
    expect(titleOf(session, ROW.id)).toBe(ROW.title)
  })
})

describe("renameConversation — failure routing (AE7, R10)", () => {
  it("not_available marks the row's replay not_available (the affordance leaves) and clears the slot", async () => {
    const { session, renameHistoryThread } = await hydrated()
    renameHistoryThread.mockResolvedValueOnce({
      ok: false,
      reason: "not_available",
    })
    expect(await session.renameConversation(ROW.id, "Gone")).toEqual({
      ok: false,
      reason: "not_available",
    })
    const row = session.getSnapshot().conversations.find((c) => c.id === ROW.id)
    expect(row?.replay).toBe("not_available")
    expect(row?.title).toBe(ROW.title)
    expect(session.getSnapshot().renamingIds.size).toBe(0)
  })

  it.each(["access", "invalid_title", "unavailable"] as const)(
    "%s returns the reason with the row unchanged and NEVER reverts to client-only",
    async (reason) => {
      const { session, renameHistoryThread } = await hydrated()
      renameHistoryThread.mockResolvedValueOnce({ ok: false, reason })
      const listener = vi.fn()
      session.subscribe(listener)
      expect(await session.renameConversation(ROW.id, "Kept")).toEqual({
        ok: false,
        reason,
      })
      // revertToClientOnly() would have removed BOTH message-less server rows
      // and parked history in the terminal "denied" phase, which refuses new
      // adoptions. Neither happened: the rows stay and adoption still works.
      expect(idsOf(session)).toEqual(
        expect.arrayContaining([ROW.id, SECOND.id]),
      )
      expect(
        session.getSnapshot().conversations.find((c) => c.id === ROW.id)
          ?.replay,
      ).toBe("idle")
      expect(session.adoptConversation("adopt-after-rename-failure")).toBe(true)
    },
  )

  // Positive companion: the READ path's access failure DOES revert — so the
  // assertion above discriminates the write path's deliberate divergence.
  it("(companion) an access failure on the READ path still reverts to client-only", async () => {
    const { session, fetchHistoryThread } = await hydrated()
    fetchHistoryThread.mockResolvedValueOnce({ ok: false, reason: "access" })
    session.selectConversation(ROW.id)
    await flush()
    expect(idsOf(session)).not.toContain(SECOND.id)
    expect(session.adoptConversation("adopt-after-read-denial")).toBe(false)
  })
})

describe("rename fence — committed titles survive stale page merges (KTD7, AE5, R16)", () => {
  it("a page fetch started BEFORE the rename, landing after with the old title, does not replace the renamed title", async () => {
    // Reach an in-flight page-0 fetch through the error → retry path, with
    // the row already present (adopted) so the rename has something to hit.
    const setup = makeSession({ seekerEnabled: true })
    const page = deferred<FetchHistoryPageResult>()
    setup.fetchHistoryPage
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockImplementationOnce(() => page.promise)
    setup.fetchHistoryThread.mockResolvedValue({ ok: true, messages: [] })
    setup.renameHistoryThread.mockResolvedValueOnce({
      ok: true,
      title: "Renamed",
    })
    setup.session.activate()
    await flush()
    expect(setup.session.getSnapshot().history.error).toBe(true)
    setup.session.adoptConversation(ROW.id)
    await flush()
    setup.session.retryHistory() // the page fetch STARTS here, before the rename
    await setup.session.renameConversation(ROW.id, "Renamed")
    expect(titleOf(setup.session, ROW.id)).toBe("Renamed")
    page.resolve({ ok: true, threads: [ROW, SECOND], hasMore: false })
    await flush()
    // The stale page carried ROW.title; the fence kept the rename.
    expect(titleOf(setup.session, ROW.id)).toBe("Renamed")
    // Other rows from the same page merged normally.
    expect(titleOf(setup.session, SECOND.id)).toBe(SECOND.title)
  })

  it("a Load-more page started before the rename does not replace it; one started AFTER applies the server title (discriminating pair)", async () => {
    const setup = makeSession({ seekerEnabled: true })
    const stale = deferred<FetchHistoryPageResult>()
    setup.fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({
        ok: true,
        threads: [{ ...ROW, title: "Server title after" }],
        hasMore: false,
      })
    setup.renameHistoryThread.mockResolvedValue({ ok: true, title: "Renamed" })
    setup.session.activate()
    await flush()

    setup.session.loadMoreHistory() // stale page fetch starts (page 1)
    await setup.session.renameConversation(ROW.id, "Renamed")
    stale.resolve({
      ok: true,
      threads: [{ ...ROW, title: "Server title before" }],
      hasMore: true,
    })
    await flush()
    expect(titleOf(setup.session, ROW.id)).toBe("Renamed")

    // A fetch started AFTER the rename committed is newer than the fence.
    setup.session.loadMoreHistory()
    await flush()
    expect(titleOf(setup.session, ROW.id)).toBe("Server title after")
  })

  it("a page-0 hydration in flight across a rename behaves like Load-more", async () => {
    const setup = makeSession({
      seekerEnabled: true,
      initialConversationId: ROW.id,
    })
    const page0 = deferred<FetchHistoryPageResult>()
    setup.fetchHistoryPage.mockImplementationOnce(() => page0.promise)
    setup.fetchHistoryThread.mockResolvedValue({ ok: true, messages: [] })
    setup.renameHistoryThread.mockResolvedValueOnce({
      ok: true,
      title: "Renamed",
    })
    setup.session.activate() // page-0 hydration starts; the adopted row exists
    await flush()
    await setup.session.renameConversation(ROW.id, "Renamed")
    page0.resolve({ ok: true, threads: [ROW], hasMore: false })
    await flush()
    expect(titleOf(setup.session, ROW.id)).toBe("Renamed")
  })

  it("the fence survives deactivate(): a stale page landing on the re-armed instance still cannot revert the title", async () => {
    const setup = makeSession({ seekerEnabled: true })
    const stale = deferred<FetchHistoryPageResult>()
    setup.fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
    setup.renameHistoryThread.mockResolvedValue({ ok: true, title: "Renamed" })
    setup.session.activate()
    await flush()
    await setup.session.renameConversation(ROW.id, "Renamed")
    setup.session.loadMoreHistory()
    setup.session.deactivate()
    setup.session.activate()
    stale.resolve({ ok: true, threads: [ROW], hasMore: true })
    await flush()
    expect(titleOf(setup.session, ROW.id)).toBe("Renamed")
    // Later, a fresh Load-more (started after the rename) applies normally.
    setup.session.loadMoreHistory()
    await flush()
    expect(titleOf(setup.session, ROW.id)).toBe(ROW.title)
  })

  it("R17 at the session boundary: a server title landing mid-rename does not change the submitted value, and the echo wins", async () => {
    const setup = makeSession({ seekerEnabled: true })
    const page = deferred<FetchHistoryPageResult>()
    const rename = deferred<RenameHistoryThreadResult>()
    setup.fetchHistoryPage
      .mockResolvedValueOnce({ ok: true, threads: [ROW], hasMore: true })
      .mockImplementationOnce(() => page.promise)
    setup.renameHistoryThread.mockImplementationOnce(() => rename.promise)
    setup.session.activate()
    await flush()
    setup.session.loadMoreHistory()
    const pending = setup.session.renameConversation(ROW.id, "Mine")
    page.resolve({
      ok: true,
      threads: [{ ...ROW, title: "LLM title" }],
      hasMore: false,
    })
    await flush()
    // The rename is still pending: the page applied (it started before any
    // commit), but the submitted value is untouched.
    expect(titleOf(setup.session, ROW.id)).toBe("LLM title")
    expect(setup.renameHistoryThread).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Mine" }),
    )
    rename.resolve({ ok: true, title: "Mine" })
    await pending
    expect(titleOf(setup.session, ROW.id)).toBe("Mine")
  })
})

describe("mergeServerThreads — fenced ids keep their client title (pure)", () => {
  const existing = {
    id: ROW.id,
    title: "Renamed",
    messages: [],
    origin: "server" as const,
    serverPersisted: true,
    lastActivityAt: ROW.updatedAt,
    replay: "idle" as const,
  }

  it("keeps the existing title for a fenced id and applies the server title otherwise", () => {
    const fenced = mergeServerThreads([existing], [ROW], new Set([ROW.id]))
    expect(fenced[0]!.title).toBe("Renamed")
    const open = mergeServerThreads([existing], [ROW], new Set())
    expect(open[0]!.title).toBe(ROW.title)
    const absent = mergeServerThreads([existing], [ROW])
    expect(absent[0]!.title).toBe(ROW.title)
  })

  it("still stamps persistence and activity on a fenced row", () => {
    const [merged] = mergeServerThreads(
      [{ ...existing, serverPersisted: undefined, lastActivityAt: undefined }],
      [ROW],
      new Set([ROW.id]),
    )
    expect(merged!.serverPersisted).toBe(true)
    expect(merged!.lastActivityAt).toBe(ROW.updatedAt)
  })
})
