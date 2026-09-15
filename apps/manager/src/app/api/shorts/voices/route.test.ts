import { beforeEach, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { POST } from "./route"
const f = vi.hoisted(() => ({
  authenticate: vi.fn(),
  search: vi.fn(),
  importVoice: vi.fn(),
  call: vi.fn(),
}))
vi.mock("@/lib/studio-request", async (original) => ({
  ...(await original<typeof import("@/lib/studio-request")>()),
  authenticateStudioRequest: f.authenticate,
}))
vi.mock("@/backend/studio-interactive", () => ({
  createStudioInteractiveClient: () => f.call,
  StudioTransportError: class extends Error {},
}))
vi.mock("@/services/studio-production/existing-voices", async (original) => ({
  ...(await original<
    typeof import("@/services/studio-production/existing-voices")
  >()),
  searchExistingVoices: f.search,
  importExistingVoice: f.importVoice,
}))
beforeEach(() => {
  vi.resetAllMocks()
  f.authenticate.mockResolvedValue({ approvedByUserId: "operator" })
})
const request = (body: unknown) =>
  new Request("https://manager.example/api/shorts/voices", {
    method: "POST",
    body: JSON.stringify(body),
  })
it("requires interactive authentication before reading provider voices", async () => {
  f.authenticate.mockResolvedValue(
    NextResponse.json({ error: "Sign in" }, { status: 401 }),
  )
  expect((await POST(request({ kind: "search", query: "Bella" }))).status).toBe(
    401,
  )
  expect(f.search).not.toHaveBeenCalled()
  expect(f.importVoice).not.toHaveBeenCalled()
})
it("returns only the requested search result and disables caching", async () => {
  f.search.mockResolvedValue([{ id: "bella", name: "Bella" }])
  const response = await POST(request({ kind: "search", query: "Bella" }))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({
    result: [{ id: "bella", name: "Bella" }],
  })
  expect(f.importVoice).not.toHaveBeenCalled()
})
it("passes explicit author and provider languages through authenticated import", async () => {
  const input = { voiceId: "bella", language: "english", languageCode: "en" }
  f.importVoice.mockResolvedValue({ retained: true })
  expect((await POST(request({ kind: "import", input }))).status).toBe(200)
  expect(f.importVoice.mock.calls[0]?.slice(0, 2)).toEqual([input, f.call])
})
it("rejects oversized input and arbitrary action/provider fields before dispatch", async () => {
  expect(
    (await POST(request({ kind: "search", query: "x".repeat(5000) }))).status,
  ).toBe(413)
  expect(
    (
      await POST(
        request({
          kind: "search",
          query: "Bella",
          providerUrl: "https://evil.example",
        }),
      )
    ).status,
  ).toBe(400)
  expect(f.search).not.toHaveBeenCalled()
})
