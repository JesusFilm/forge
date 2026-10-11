import { afterEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { request }
    }
  },
}))
import { appendBetaRequest } from "./betaRequests"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it("refuses to save without configured Sheets credentials", async () => {
  vi.stubEnv("BETA_REQUESTS_SPREADSHEET_ID", undefined)
  await expect(appendBetaRequest("tester@example.com")).rejects.toThrow(
    "signup_not_configured",
  )
  expect(request).not.toHaveBeenCalled()
})

it("appends a Pending row as raw values without automatic retries", async () => {
  vi.stubEnv("BETA_REQUESTS_SPREADSHEET_ID", "sheet")
  vi.stubEnv("BETA_REQUESTS_GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
  await appendBetaRequest("tester@example.com")
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: expect.stringContaining("valueInputOption=RAW"),
      retry: false,
      data: {
        values: [
          [expect.any(String), "tester@example.com", "Android TV", "Pending"],
        ],
      },
    }),
  )
})
