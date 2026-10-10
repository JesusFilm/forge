import { act, renderHook, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { useConversations } from "@/lib/use-conversations"
import { useComparison } from "./use-comparison"
import type { requestApologist } from "./client"

vi.mock("@/lib/chat-stub", () => ({
  streamReply: vi.fn(async () => ({
    ok: true,
    text: "Forge only",
    engine: "seeker",
    grounded: false,
    sources: [],
  })),
}))
vi.mock("@/lib/history-client", () => ({
  fetchHistoryPage: vi.fn(async () => ({
    ok: true,
    threads: [],
    hasMore: false,
  })),
  fetchHistoryThread: vi.fn(),
  renameHistoryThread: vi.fn(),
}))

it("rejects oversized text without touching either history or the draft, then sends to both", async () => {
  const request = vi.fn<typeof requestApologist>().mockResolvedValue()
  const { result } = renderHook(
    () => {
      const forge = useConversations(false)
      return { forge, comparison: useComparison(forge, request) }
    },
    { reactStrictMode: true },
  )
  act(() => result.current.forge.setDraft("x".repeat(4001)))
  act(() => result.current.comparison.send(result.current.forge.draft))
  expect(result.current.forge.draft).toHaveLength(4001)
  expect(result.current.forge.activeConversation.messages).toHaveLength(0)
  expect(request).not.toHaveBeenCalled()
  act(() => result.current.comparison.send("Why hope?"))
  await waitFor(() => expect(result.current.comparison.busy).toBe(false))
  expect(request).toHaveBeenCalledTimes(1)
  expect(
    result.current.forge.activeConversation.messages.map((m) => m.content),
  ).toEqual(["Why hope?", "Forge only"])
})
it("holds the shared slot until the slower provider settles and sends only Apologist context", async () => {
  let finish: (() => void) | undefined
  const request = vi
    .fn<typeof requestApologist>()
    .mockImplementation(async (_messages, _signal, meta, token) => {
      meta({ source: "fallback" })
      token("Apologist only")
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
  const { result } = renderHook(() => {
    const forge = useConversations(false)
    return { forge, comparison: useComparison(forge, request) }
  })
  act(() => {
    result.current.comparison.send("First")
    result.current.comparison.send("Duplicate")
  })
  await waitFor(() => expect(result.current.forge.pending).toBe(false))
  expect(result.current.comparison.busy).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => finish?.())
  act(() => result.current.comparison.send("Follow-up", "follow_up"))
  expect(request.mock.calls[1]?.[0]).toEqual([
    { role: "user", content: "First" },
    { role: "assistant", content: "Apologist only" },
    { role: "user", content: "Follow-up" },
  ])
  await act(async () => finish?.())
})
it("aborts on unmount and ignores late tokens", async () => {
  let signal: AbortSignal | undefined
  const request = vi
    .fn<typeof requestApologist>()
    .mockImplementation(async (_messages, next) => {
      signal = next
      await new Promise<void>((resolve) =>
        next.addEventListener("abort", () => resolve(), { once: true }),
      )
    })
  const { result, unmount } = renderHook(() => {
    const forge = useConversations(false)
    return useComparison(forge, request)
  })
  act(() => result.current.send("Q"))
  unmount()
  expect(signal?.aborted).toBe(true)
})
it("keeps the pair reserved when Apologist finishes first and records Forge Stop separately", async () => {
  const { streamReply } = await import("@/lib/chat-stub")
  vi.mocked(streamReply).mockImplementationOnce(async ({ signal, onToken }) => {
    onToken?.("Partial Forge")
    await new Promise<void>((resolve) =>
      signal?.addEventListener("abort", () => resolve(), { once: true }),
    )
    return { ok: false, reason: "cancelled", partialText: "Partial Forge" }
  })
  const request = vi.fn<typeof requestApologist>().mockResolvedValue()
  const { result } = renderHook(() => {
    const forge = useConversations(false)
    return { forge, comparison: useComparison(forge, request) }
  })
  act(() => result.current.comparison.send("Question"))
  await waitFor(() =>
    expect(result.current.comparison.turns.at(-1)?.status).toBe("complete"),
  )
  expect(result.current.comparison.busy).toBe(true)
  act(() => result.current.comparison.stop())
  await waitFor(() => expect(result.current.comparison.busy).toBe(false))
  expect(result.current.comparison.forgeStopped).toBe(true)
  expect(result.current.forge.activeConversation.messages.at(-1)?.content).toBe(
    "Partial Forge",
  )
  expect(
    result.current.forge.activeConversation.messages.at(-1)?.error,
  ).toBeUndefined()
})
it("releases a synchronous Forge refusal without dispatching Apologist", () => {
  const request = vi.fn<typeof requestApologist>()
  const { result } = renderHook(() => {
    const forge = useConversations(false)
    return useComparison({ ...forge, send: () => {} }, request)
  })
  act(() => result.current.send("Question"))
  expect(result.current.busy).toBe(false)
  expect(result.current.turns).toHaveLength(0)
  expect(request).not.toHaveBeenCalled()
})
it("preserves consecutive user context after a textless failure and releases the pair", async () => {
  const request = vi
    .fn<typeof requestApologist>()
    .mockRejectedValueOnce(new Error("failed"))
    .mockResolvedValueOnce()
  const { result } = renderHook(() => {
    const forge = useConversations(false)
    return useComparison(forge, request)
  })
  act(() => result.current.send("First"))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(result.current.turns.at(-1)?.status).toBe("failed")
  act(() => result.current.send("Second"))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(request.mock.calls[1]?.[0]).toEqual([
    { role: "user", content: "First" },
    { role: "user", content: "Second" },
  ])
})
