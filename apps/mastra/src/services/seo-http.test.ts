import { describe, expect, it, vi } from "vitest"

import {
  boundedSeoProviderPageSize,
  fetchSeoUrl,
  readSeoBody,
  validateSeoUrl,
} from "./seo-http"

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }]

describe("SEO URL safety", () => {
  it("bounds provider pages by total, provider, and response limits", () => {
    expect(
      boundedSeoProviderPageSize({
        maxRows: 25_000,
        maxResponseBytes: 2_097_152,
        providerMaxRows: 10_000,
      }),
    ).toBe(2_044)
    expect(
      boundedSeoProviderPageSize({
        maxRows: 7,
        maxResponseBytes: 16_384,
        providerMaxRows: 10_000,
      }),
    ).toBe(7)
    expect(
      boundedSeoProviderPageSize({
        maxRows: 25_000,
        maxResponseBytes: 8_388_608,
        providerMaxRows: 1_000,
      }),
    ).toBe(1_000)
  })

  it.each([
    "https://127.0.0.1/path",
    "https://2130706433/path",
    "https://[::1]/path",
    "https://[::ffff:127.0.0.1]/path",
  ])("rejects private address form %s", async (url) => {
    const result = await validateSeoUrl(url, {
      allowedHosts: [new URL(url).hostname],
      resolveHost: publicDns,
    })
    expect(result).toEqual({ ok: false, reason: "private_address" })
  })

  it("revalidates redirects and blocks a private DNS destination", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://metadata.example/latest" },
        }),
    ) as unknown as typeof fetch
    const result = await fetchSeoUrl("https://public.example/start", {
      allowedHosts: ["public.example", "metadata.example"],
      timeoutMs: 1_000,
      maxBytes: 1_024,
      fetchImpl,
      resolveHost: async (host) => [
        {
          address:
            host === "metadata.example" ? "169.254.169.254" : "93.184.216.34",
        },
      ],
    })
    expect(result).toEqual({ ok: false, reason: "private_address" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("fails closed when a response exceeds the byte cap", async () => {
    const result = await fetchSeoUrl("https://public.example/large", {
      allowedHosts: ["public.example"],
      timeoutMs: 1_000,
      maxBytes: 3,
      resolveHost: publicDns,
      fetchImpl: vi.fn(
        async () => new Response("oversized"),
      ) as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, reason: "body_too_large" })
  })

  it("cancels an oversized response stream", async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("oversized"))
        },
        cancel() {
          cancelled = true
        },
      }),
    )

    await expect(readSeoBody(response, 3)).resolves.toEqual({
      ok: false,
      reason: "body_too_large",
    })
    expect(cancelled).toBe(true)
  })
})
