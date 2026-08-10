import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { queryGoogleSearchConsole } from "./google-search-console-client"

const config = getSeoConfig({
  SEO_GSC_PROPERTY_IDS: "sc-domain:example.com,https://example.com/",
  SEO_MAX_GSC_ROWS: "2",
  SEO_MAX_PROVIDER_ATTEMPTS: "1",
})

describe("queryGoogleSearchConsole", () => {
  it("uses the current web type, preserves zero rows, and reports a configured cap", async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json(
        bodies.length === 1
          ? {
              rows: [
                {
                  keys: ["https://example.com/a", "hope"],
                  clicks: 0,
                  impressions: 10,
                  ctr: 0,
                  position: 8,
                },
                {
                  keys: ["https://example.com/b", "faith"],
                  clicks: 1,
                  impressions: 20,
                  ctr: 0.05,
                  position: 4,
                },
              ],
              responseAggregationType: "byPage",
            }
          : { rows: [] },
      )
    }) as unknown as typeof fetch
    const result = await queryGoogleSearchConsole({
      propertyId: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      dimensions: ["page", "query"],
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl,
      observationId: "gsc-test",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(bodies[0]).toMatchObject({
      type: "web",
      dataState: "final",
      startRow: 0,
    })
    expect(bodies[0]).not.toHaveProperty("searchType")
    expect(result.rows[0]).toMatchObject({ clicks: 0, impressions: 10 })
    expect(result.observation.quality.caveats.join(" ")).toContain(
      "absent row is unobserved",
    )
    expect(result.observation.quality.truncated).toBe(true)
  })

  it("rejects a property that is not an exact allowlist member", async () => {
    await expect(
      queryGoogleSearchConsole({
        propertyId: "https://example.com/evil/",
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        dimensions: ["page"],
        config,
      }),
    ).resolves.toEqual({ ok: false, reason: "not_allowed", retryable: false })
  })
})
