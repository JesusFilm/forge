import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const dbRead = vi.hoisted(() => vi.fn())
vi.mock("@/db/client", () => ({ prisma: { $transaction: dbRead } }))

let POST: (typeof import("./route"))["POST"]

beforeAll(async () => {
  vi.stubEnv("MASTRA_RECOMMENDATION_INGEST_API_KEYS", "preview-test-key")
  vi.resetModules()
  POST = (await import("./route")).POST
})

beforeEach(() => dbRead.mockClear())
afterAll(() => vi.unstubAllEnvs())

describe("private precomputed catalog", () => {
  it("rejects unauthenticated reads before querying catalog content", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/mastra/precomputed-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "catalog",
          cutoff: new Date().toISOString(),
        }),
      }),
    )
    expect(response.status).toBe(401)
    expect(dbRead).not.toHaveBeenCalled()
  })

  it("rejects malformed authenticated requests without a database read", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/mastra/precomputed-catalog", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer preview-test-key",
        },
        body: JSON.stringify({ action: "catalog", limit: 0 }),
      }),
    )
    expect(response.status).toBe(400)
    expect(dbRead).not.toHaveBeenCalled()
  })
})
