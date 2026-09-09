import { expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prepare: vi.fn(),
  call: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  authenticateInteractiveManagerRequest: mocks.authenticate,
}))
vi.mock("@/config/env", () => ({
  env: { MANAGER_BASE_URL: "https://manager.test" },
}))
vi.mock("@/backend/studio-interactive", () => ({
  createStudioInteractiveClient: () => mocks.call,
  StudioTransportError: class extends Error {
    status = 400
    code = "INVALID"
  },
}))
vi.mock("@/services/studio-publication", () => ({
  prepareInteractiveStudioPublication: mocks.prepare,
}))
import { POST } from "./route"
it("rejects an unauthenticated or cross-origin preparation before provider work", async () => {
  mocks.prepare.mockClear()
  mocks.authenticate.mockResolvedValue(new NextResponse(null, { status: 401 }))
  expect(
    (
      await POST(
        new Request("https://manager.test/api/shorts/publication", {
          method: "POST",
          headers: { origin: "https://other.test" },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await POST(
        new Request("https://manager.test/api/shorts/publication", {
          method: "POST",
          headers: { origin: "https://manager.test" },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(401)
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it("cancels an interrupted request body without beginning provider preparation", async () => {
  mocks.prepare.mockClear()
  mocks.authenticate.mockResolvedValue({ approvedByUserId: "human" })
  const stop = new AbortController(),
    cancel = vi.fn()
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { origin: "https://manager.test" },
    body: new ReadableStream({ cancel }),
    signal: stop.signal,
    duplex: "half",
  }
  const request = new Request(
    "https://manager.test/api/shorts/publication",
    init,
  )
  const response = POST(request)
  await new Promise((resolve) => setTimeout(resolve, 0))
  stop.abort()
  expect((await response).status).toBe(400)
  expect(cancel).toHaveBeenCalledOnce()
  expect(mocks.prepare).not.toHaveBeenCalled()
})
