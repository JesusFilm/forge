import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({
  env: {
    ADMIN_MASTRA_RECOMMENDATION_API_KEY: "fixture-key",
    ADMIN_RECOMMENDATION_CATALOG_URL: "http://localhost/catalog",
    ADMIN_RECOMMENDATION_INGEST_URL: "http://localhost/ingest",
    PRECOMPUTED_GA4_PROPERTY_ID: undefined,
  },
}))

import { createAdminSourceDependencies } from "./source-generation"

afterEach(() => vi.unstubAllGlobals())

describe("Admin producer transport", () => {
  it("preserves only the exact live foreign source claim conflict", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: "Source has a live claim", reason: "conflict" },
        { status: 409 },
      ),
    )
    vi.stubGlobal("fetch", fetchImpl)
    await expect(
      createAdminSourceDependencies().ingest({
        action: "claim",
        generationId: "generation",
        sourceVideoId: "source",
        claimId: "claim",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Source has a live claim",
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    for (const [action, error] of [
      ["claim", "A different conflict"],
      ["complete", "Source has a live claim"],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error, reason: "conflict" }, { status: 409 }),
        ),
      )
      await expect(
        createAdminSourceDependencies().ingest({ action }),
      ).rejects.toMatchObject({ code: "contract_rejected" })
    }
  })
})
