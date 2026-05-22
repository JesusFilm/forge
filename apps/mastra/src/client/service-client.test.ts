import { describe, expect, it, vi } from "vitest"

import { callMastraSmoke } from "./service-client"

describe("Mastra service client", () => {
  it("returns config_missing without base URL or bearer", async () => {
    await expect(callMastraSmoke({ input: "hello" })).resolves.toEqual({
      ok: false,
      reason: "config_missing",
    })
  })

  it("sends bearer and parses a smoke response", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, agentId: "smokeAgent", echo: "hello" }),
    )

    await expect(
      callMastraSmoke({
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        input: "hello",
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: true,
      agentId: "smokeAgent",
      echo: "hello",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-smoke"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
  })

  it("classifies upstream auth failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }))

    await expect(
      callMastraSmoke({
        baseUrl: "https://mastra.internal",
        bearer: "bad",
        input: "hello",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed" })
  })
})
