import { afterEach, expect, it, vi } from "vitest"
import { readAutomationJson } from "./automation-dry-run-http"
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it("rejects invalid JSON and non-JSON content types", async () => {
  expect(
    await readAutomationJson(
      new Response("broken secret", {
        headers: { "content-type": "application/json" },
      }),
    ),
  ).toBeUndefined()
  expect(
    await readAutomationJson(
      new Response("{}", { headers: { "content-type": "text/html" } }),
    ),
  ).toBeUndefined()
})
it("cancels slow request bodies at the configured deadline", async () => {
  const controller = new AbortController(),
    cancel = vi.fn()
  const request = new Request("https://manager.test", {
    method: "POST",
    body: new ReadableStream({ cancel }),
    headers: { "content-type": "application/json" },
    duplex: "half",
  } as RequestInit)
  const pending = readAutomationJson(request, 8192, controller.signal)
  controller.abort()
  expect(await pending).toBeUndefined()
  expect(cancel).toHaveBeenCalled()
})
