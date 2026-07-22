// StrictMode-rendered adapter coverage (feat-281): pins the re-arm cycle on
// ONE session + the cached-getSnapshot contract. Needs RTL reactStrictMode,
// NOT a <StrictMode> wrapper — see apps/chat/CLAUDE.md's renderHook gotcha.
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildStubReply, STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"

import { useConversations } from "./use-conversations"

const strict = { reactStrictMode: true } as const

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useConversations under dev StrictMode", () => {
  it("renders without getSnapshot-cache or update-depth errors and keeps snapshot identity across rerenders", () => {
    const errorSpy = vi.spyOn(console, "error")
    const view = renderHook(() => useConversations(false), strict)
    const before = view.result.current.conversations
    view.rerender()
    // No commit between renders → the cached snapshot arrays keep identity.
    expect(view.result.current.conversations).toBe(before)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("streams a stub reply end to end after the mount cycle (the session survives it)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const view = renderHook(() => useConversations(false), strict)
    act(() => {
      view.result.current.send("hello")
    })
    expect(view.result.current.pending).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    })
    expect(view.result.current.pending).toBe(false)
    expect(
      view.result.current.activeConversation.messages.map((m) => m.content),
    ).toEqual(["hello", buildStubReply("hello")])
  })

  it("hydrates history through the cycle: an aborted first fetch re-arms exactly one refetch", async () => {
    // The FIRST list fetch hangs, so it is deterministically still in flight
    // when StrictMode's cleanup aborts it — the wedge case the re-arm
    // discipline exists for. Later calls resolve normally.
    const listCalls: RequestInit[] = []
    const fetchMock = vi.fn().mockImplementation((url, init?: RequestInit) => {
      if (String(url) === "/api/history/list") {
        listCalls.push(init ?? {})
        if (listCalls.length === 1) return new Promise<Response>(() => {})
        return Promise.resolve(
          jsonRes(200, {
            threads: [
              {
                id: "thread-alpha",
                title: "Alpha thread",
                updatedAt: "2026-07-12T08:00:00.000Z",
              },
            ],
            page: 0,
            perPage: 20,
            total: 1,
            hasMore: false,
          }),
        )
      }
      return Promise.reject(new Error("unexpected fetch"))
    })
    vi.stubGlobal("fetch", fetchMock)

    const view = renderHook(() => useConversations(true), strict)
    await waitFor(() =>
      expect(view.result.current.conversations.map((c) => c.title)).toContain(
        "Alpha thread",
      ),
    )
    expect(view.result.current.history.loading).toBe(false)
    // The aborted first fetch re-armed exactly one refetch on the SAME
    // session — neither wedged at loading (1 call) nor ran away (3+).
    expect(listCalls).toHaveLength(2)
    expect((listCalls[0]!.signal as AbortSignal).aborted).toBe(true)
    expect((listCalls[1]!.signal as AbortSignal).aborted).toBe(false)
  })

  it("keeps working after the cycle on the hydrated path: select, draft, new conversation", async () => {
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (String(url) === "/api/history/list") {
        return Promise.resolve(
          jsonRes(200, {
            threads: [
              {
                id: "thread-alpha",
                title: "Alpha thread",
                updatedAt: "2026-07-12T08:00:00.000Z",
              },
            ],
            page: 0,
            perPage: 20,
            total: 1,
            hasMore: false,
          }),
        )
      }
      if (String(url) === "/api/history/thread") {
        return Promise.resolve(
          jsonRes(200, {
            messages: [
              { id: "m1", role: "user", text: "old q", createdAt: "" },
              { id: "m2", role: "assistant", text: "old a", createdAt: "" },
            ],
          }),
        )
      }
      return Promise.reject(new Error("unexpected fetch"))
    })
    vi.stubGlobal("fetch", fetchMock)

    const view = renderHook(() => useConversations(true), strict)
    await waitFor(() =>
      expect(view.result.current.conversations.map((c) => c.title)).toContain(
        "Alpha thread",
      ),
    )
    act(() => {
      view.result.current.selectConversation("thread-alpha")
    })
    await waitFor(() =>
      expect(
        view.result.current.activeConversation.messages.map((m) => m.content),
      ).toEqual(["old q", "old a"]),
    )
    act(() => {
      view.result.current.setDraft("still alive")
    })
    expect(view.result.current.draft).toBe("still alive")
    act(() => {
      view.result.current.newConversation()
    })
    expect(view.result.current.activeConversation.messages).toHaveLength(0)
    expect(view.result.current.draft).toBe("")
  })
})
