import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    WEB_REVALIDATE_URL?: string
    WEB_REVALIDATE_TOKEN?: string
  },
}))

const { env } = await import("@/config/env")
const { emitRevalidateWebhook } = await import("@/services/revalidate-webhook")

const envMutable = env as {
  WEB_REVALIDATE_URL?: string
  WEB_REVALIDATE_TOKEN?: string
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

beforeEach(() => {
  envMutable.WEB_REVALIDATE_URL = "https://web.test/api/revalidate"
  envMutable.WEB_REVALIDATE_TOKEN = "test-token"
  fetchSpy.mockReset()
})

afterEach(() => {
  envMutable.WEB_REVALIDATE_URL = undefined
  envMutable.WEB_REVALIDATE_TOKEN = undefined
})

describe("emitRevalidateWebhook", () => {
  it("POSTs the correct shape with bearer header on the happy path", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const result = await emitRevalidateWebhook({
      model: "experience",
      slug: "jesus",
      locale: "en",
    })

    expect(result).toEqual({ status: "sent", httpStatus: 200 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://web.test/api/revalidate")
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer test-token",
    })
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "experience",
      entry: { slug: "jesus", locale: "en" },
    })
  })

  it("forwards null slug/locale as undefined in the entry payload", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await emitRevalidateWebhook({
      model: "watch-route-manifest",
      slug: null,
      locale: null,
    })

    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(String(init?.body)) as {
      model: string
      entry: Record<string, unknown>
    }
    expect(body).toEqual({
      model: "watch-route-manifest",
      entry: {},
    })
  })

  it("additively forwards an exact video language slug", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await emitRevalidateWebhook({
      model: "video",
      slug: "jesus",
      locale: "en",
      languageSlug: "english",
    })

    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "video",
      entry: { slug: "jesus", locale: "en", languageSlug: "english" },
    })
  })

  it("skips silently when WEB_REVALIDATE_URL is unset", async () => {
    envMutable.WEB_REVALIDATE_URL = undefined

    const result = await emitRevalidateWebhook({
      model: "experience",
      slug: "jesus",
      locale: "en",
    })

    expect(result).toEqual({ status: "skipped", reason: "config_missing" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("skips silently when WEB_REVALIDATE_TOKEN is unset", async () => {
    envMutable.WEB_REVALIDATE_TOKEN = undefined

    const result = await emitRevalidateWebhook({
      model: "experience",
      slug: "jesus",
      locale: "en",
    })

    expect(result).toEqual({ status: "skipped", reason: "config_missing" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("swallows a downstream 5xx and reports remote_non_2xx — never throws", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("upstream burning", { status: 502 }),
    )

    const result = await emitRevalidateWebhook({
      model: "experience",
      slug: "jesus",
      locale: "en",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("remote_non_2xx")
      expect(result.detail).toContain("502")
    }
  })

  it("swallows a network error and reports network — never throws", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"))

    const result = await emitRevalidateWebhook({
      model: "experience",
      slug: "jesus",
      locale: "en",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("network")
      expect(result.detail).toContain("fetch failed")
    }
  })

  it("swallows an AbortSignal timeout and reports network — never throws", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout")
    timeoutError.name = "TimeoutError"
    fetchSpy.mockRejectedValueOnce(timeoutError)

    const result = await emitRevalidateWebhook({
      model: "video",
      slug: "jesus",
      locale: "en",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("network")
    }
  })
})
