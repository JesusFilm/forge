// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"
import { requestApologist } from "./client"
const messages = [{ role: "user" as const, content: "Q" }]
afterEach(() => vi.unstubAllGlobals())
it("retains partial tokens but refuses a missing terminal frame", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          'event: meta\ndata: {"source":"fallback"}\n\nevent: token\ndata: {"text":"partial"}\n\n',
        ),
      ),
  )
  const token = vi.fn()
  await expect(
    requestApologist(messages, new AbortController().signal, vi.fn(), token),
  ).rejects.toThrow("generation_failed")
  expect(token).toHaveBeenCalledWith("partial")
})
it("maps pre-stream history limits to the pane's closed vocabulary", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { reason: "history_limit", private: "ignored" },
          { status: 413 },
        ),
      ),
  )
  await expect(
    requestApologist(messages, new AbortController().signal, vi.fn(), vi.fn()),
  ).rejects.toThrow("history_limit")
})
