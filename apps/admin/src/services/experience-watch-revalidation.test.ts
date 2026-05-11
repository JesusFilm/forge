import { afterEach, describe, expect, it, vi } from "vitest"
import { postWatchExperienceRevalidation } from "./experience-watch-revalidation"

describe("postWatchExperienceRevalidation", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("skips when the endpoint or secret is not configured", async () => {
    const result = await postWatchExperienceRevalidation(
      { slug: "obey", locale: "en" },
      { endpoint: undefined, secret: undefined },
    )

    expect(result).toEqual({ status: "skipped", reason: "not_configured" })
  })

  it("posts the experience payload to the watch revalidation endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          revalidated: true,
          paths: ["/obey/en", "/obey"],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await postWatchExperienceRevalidation(
      { slug: " obey ", locale: " en ", isTemplate: false },
      {
        endpoint: "https://web.example/watch/api/revalidate",
        secret: "secret",
        timeoutMs: 100,
      },
    )

    expect(result).toEqual({
      status: "revalidated",
      paths: ["/obey/en", "/obey"],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example/watch/api/revalidate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-revalidation-secret": "secret",
        }),
        body: JSON.stringify({
          model: "experience",
          entry: {
            slug: "obey",
            locale: "en",
            isTemplate: false,
          },
        }),
      }),
    )
  })

  it("returns a retryable remote failure for web 5xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "temporary" }), {
          status: 503,
        }),
      ),
    )

    const result = await postWatchExperienceRevalidation(
      { slug: "obey", locale: "en" },
      {
        endpoint: "https://web.example/watch/api/revalidate",
        secret: "secret",
      },
    )

    expect(result).toMatchObject({
      status: "failed",
      reason: "remote_error",
      httpStatus: 503,
      retryable: true,
      message: "temporary",
    })
  })

  it("returns a retryable network failure when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))

    const result = await postWatchExperienceRevalidation(
      { slug: "obey", locale: "en" },
      {
        endpoint: "https://web.example/watch/api/revalidate",
        secret: "secret",
      },
    )

    expect(result).toMatchObject({
      status: "failed",
      reason: "network_error",
      retryable: true,
      message: "timeout",
    })
  })
})
