import { describe, expect, it, vi } from "vitest"

import { validateWatchReport } from "./watch-validator"

const config = {
  allowedWatchHosts: ["www.jesusfilm.org"],
  timeoutMs: 5_000,
  maxResponseBytes: 10_000,
}

describe("validateWatchReport", () => {
  it("confirms only a deterministic HTTP failure on the exact URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    )

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/missing.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "confirmed",
      status: 404,
      incomingUrl: "https://www.jesusfilm.org/watch/missing.html",
      evidence: ["HTTP 404 was returned for the exact reported URL."],
    })
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET")
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("manual")
  })

  it("does not treat a successful HTML request as playback proof", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html><body>Watch</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    )

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "unverified",
      status: 200,
      missingProof: expect.stringContaining("cannot prove interactive"),
    })
  })

  it("does not request or confirm interactive behavior", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "interactive_or_other",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "unverified",
      errorCode: "validation_target_not_supported",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("keeps access and throttling responses unverified", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "unverified",
      status: 429,
      errorCode: "http_status_unverified",
    })
  })

  it("rejects lookalike hosts before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org.evil.test/watch/jesus.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "blocked",
      errorCode: "url_not_allowed",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("does not follow or trust off-host redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/collect" },
      }),
    )

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "unverified",
      status: 302,
      errorCode: "redirect_target_not_allowed",
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("does not throw on a malformed redirect target", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://%" },
      }),
    )

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "url_availability",
        config,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "unverified",
      errorCode: "redirect_target_not_allowed",
    })
  })

  it("blocks an oversized response without buffering it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("x".repeat(100), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )

    await expect(
      validateWatchReport({
        urls: ["https://www.jesusfilm.org/watch/jesus.html"],
        target: "url_availability",
        config: { ...config, maxResponseBytes: 10 },
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      state: "blocked",
      errorCode: "response_too_large",
    })
  })
})
