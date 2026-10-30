import { afterEach, describe, expect, it, vi } from "vitest"
import { readGaWatchStartAggregatePage } from "./ga-watch-history"

const auth = vi.hoisted(() => ({ options: vi.fn(), impersonate: vi.fn() }))
const config = vi.hoisted(() => ({
  PRECOMPUTED_GA4_CREDENTIALS_JSON: undefined as string | undefined,
}))
vi.mock("../../config/env", () => ({ env: config }))
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(options: unknown) {
      auth.options(options)
    }
    getAccessToken() {
      return Promise.resolve("scoped-test-token")
    }
    getClient() {
      return Promise.resolve({})
    }
  },
  Impersonated: class {
    constructor() {
      auth.impersonate()
    }
    getAccessToken() {
      return Promise.resolve({ token: "scoped-test-token" })
    }
  },
}))

const email = "watch-reader@watch-project.iam.gserviceaccount.com"
const credentials = {
  type: "service_account",
  project_id: "watch-project",
  client_email: email,
  private_key:
    "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n",
  token_uri: "https://untrusted.example/token",
}
const fetchImpl = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        dimensionHeaders: [
          { name: "pagePath" },
          { name: "customEvent:mediacomponentid" },
        ],
        metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
        rowCount: 0,
        rows: [],
        metadata: { timeZone: "America/New_York" },
      }),
    ),
)

afterEach(() => {
  config.PRECOMPUTED_GA4_CREDENTIALS_JSON = undefined
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("GA history with a deployed service account", () => {
  it("reads Watch history with the pinned identity and Analytics-only scope", async () => {
    config.PRECOMPUTED_GA4_CREDENTIALS_JSON = JSON.stringify(credentials)
    await readGaWatchStartAggregatePage({
      propertyId: "320198532",
      serviceAccountEmail: email,
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-04",
      offset: 0,
      limit: 1,
      fetchImpl,
    })
    expect(auth.options).toHaveBeenCalledWith({
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      credentials: {
        type: "service_account",
        project_id: "watch-project",
        client_email: email,
        private_key: credentials.private_key,
      },
    })
    expect(auth.impersonate).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["malformed credentials", "not-json"],
    [
      "a different principal",
      JSON.stringify({
        ...credentials,
        client_email: "other@watch-project.iam.gserviceaccount.com",
      }),
    ],
    [
      "a different project",
      JSON.stringify({ ...credentials, project_id: "other-project" }),
    ],
    [
      "a non-service-account identity",
      JSON.stringify({ ...credentials, type: "authorized_user" }),
    ],
  ])(
    "refuses %s without falling back to another identity",
    async (_label, value) => {
      config.PRECOMPUTED_GA4_CREDENTIALS_JSON = value
      await expect(
        readGaWatchStartAggregatePage({
          propertyId: "320198532",
          serviceAccountEmail: email,
          rangeStart: "2026-10-01",
          rangeEnd: "2026-10-04",
          offset: 0,
          limit: 1,
          fetchImpl,
        }),
      ).rejects.toThrow()
      expect(auth.options).not.toHaveBeenCalled()
      expect(auth.impersonate).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it("retains ADC impersonation when no deployed credential is configured", async () => {
    await readGaWatchStartAggregatePage({
      propertyId: "320198532",
      serviceAccountEmail: email,
      rangeStart: "2026-10-01",
      rangeEnd: "2026-10-04",
      offset: 0,
      limit: 1,
      fetchImpl,
    })
    expect(auth.impersonate).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
