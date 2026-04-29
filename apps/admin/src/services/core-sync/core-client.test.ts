import { afterEach, describe, expect, it, vi } from "vitest"
import { coreQuery, CoreGraphQLError } from "./core-client"

describe("coreQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("throws when Core returns GraphQL errors in a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: null,
          errors: [{ message: "Cannot query field videos" }],
        }),
      }),
    )

    await expect(coreQuery("query { videos { id } }")).rejects.toThrow(
      CoreGraphQLError,
    )
  })
})
