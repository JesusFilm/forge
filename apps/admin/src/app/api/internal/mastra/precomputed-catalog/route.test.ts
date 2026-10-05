import { describe, expect, it } from "vitest"
import { POST } from "./route"

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
  })
})
