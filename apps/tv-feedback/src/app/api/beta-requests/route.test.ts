import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  limit: vi.fn(),
  verify: vi.fn(),
  set: vi.fn(),
}))
vi.mock("@/server/betaRequests", () => ({ appendBetaRequest: mocks.append }))
vi.mock("@/server/redis", () => ({
  key: (kind: string, id: string) => `${kind}:${id}`,
  rateLimit: mocks.limit,
  redis: () => ({ set: mocks.set }),
}))
vi.mock("@/server/turnstile", () => ({ verifyTurnstile: mocks.verify }))
vi.mock("@/server/request", () => ({
  readJsonLimited: (request: Request) => request.json(),
}))
import { POST } from "./route"

beforeEach(() => {
  vi.stubEnv("BETA_REQUESTS_SPREADSHEET_ID", "sheet")
  vi.stubEnv("BETA_REQUESTS_GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
  mocks.limit.mockResolvedValue(true)
  mocks.verify.mockResolvedValue(true)
  mocks.set.mockResolvedValue("OK")
  mocks.append.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})
const request = () =>
  new Request("https://signup.example/api/beta-requests", {
    method: "POST",
    body: JSON.stringify({
      email: "tester@example.com",
      turnstileToken: "token",
    }),
  })

it("does not write when verification fails", async () => {
  mocks.verify.mockResolvedValue(false)
  expect((await POST(request())).status).toBe(403)
  expect(mocks.append).not.toHaveBeenCalled()
  expect(mocks.set).not.toHaveBeenCalled()
})
it("does not write duplicate requests", async () => {
  mocks.set.mockResolvedValue(null)
  expect((await POST(request())).status).toBe(409)
  expect(mocks.append).not.toHaveBeenCalled()
})
it("confirms success only after Sheets accepts the row", async () => {
  const response = await POST(request())
  expect(await response.json()).toEqual({ saved: true })
  expect(mocks.verify).toHaveBeenCalledWith("token", "tv_beta_signup", true)
  expect(mocks.append).toHaveBeenCalledWith("tester@example.com")
})
it("keeps an uncertain write locked and does not show success", async () => {
  mocks.append.mockRejectedValue(new Error("timeout"))
  const response = await POST(request())
  expect(response.status).toBe(503)
  expect(mocks.set).toHaveBeenCalledTimes(1)
})
