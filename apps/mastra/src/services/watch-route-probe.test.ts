import { describe, expect, it, vi } from "vitest"

import { probeWatchRoute } from "./watch-route-probe"

const origin = "https://www.jesusfilm.org"
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }]
const now = () => new Date("2026-09-04T12:15:00.000Z")

function probe(fetchImpl: typeof fetch, path = "/watch/jesus.html") {
  return probeWatchRoute({
    origin,
    path,
    timeoutMs: 1_000,
    fetchImpl,
    resolveHost: publicDns,
    now,
  })
}

describe("probeWatchRoute", () => {
  it.each([
    [404, "missing"],
    [410, "missing"],
    [302, "redirect"],
  ] as const)("classifies HTTP %s as %s", async (status, kind) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    )

    await expect(probe(fetchImpl)).resolves.toMatchObject({
      kind,
      status,
      probedAt: now().toISOString(),
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(`${origin}/watch/jesus.html`),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    )
  })

  it("requires a successful HTML response for a healthy verdict", async () => {
    const html = vi.fn<typeof fetch>(
      async () =>
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    )
    const json = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )

    await expect(probe(html)).resolves.toMatchObject({
      kind: "healthy_html",
      status: 200,
    })
    await expect(probe(json)).resolves.toMatchObject({
      kind: "inconclusive",
      status: 200,
    })
  })

  it("does not fetch off-origin or privately resolved targets", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const offOrigin = await probeWatchRoute({
      origin,
      path: "https://attacker.example/watch/jesus.html",
      timeoutMs: 1_000,
      fetchImpl,
      resolveHost: publicDns,
      now,
    })
    const privateHost = await probeWatchRoute({
      origin,
      path: "/watch/jesus.html",
      timeoutMs: 1_000,
      fetchImpl,
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      now,
    })

    expect(offOrigin.kind).toBe("inconclusive")
    expect(privateHost.kind).toBe("inconclusive")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("treats server errors and network failures as inconclusive", async () => {
    const unavailable = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 503 }),
    )
    const networkError = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network unavailable")
    })

    await expect(probe(unavailable)).resolves.toMatchObject({
      kind: "inconclusive",
      status: 503,
    })
    await expect(probe(networkError)).resolves.toMatchObject({
      kind: "inconclusive",
      status: null,
    })
  })
})
