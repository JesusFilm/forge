// @vitest-environment jsdom
import { runInNewContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({ env: {} }))
import { GET } from "./route"

afterEach(() => vi.useRealTimers())

describe("tester activation bridge", () => {
  it.each(["success", "rejected", "timeout", "empty"])(
    "clears fragment history and redirects after %s activation",
    async (outcome) => {
      vi.useFakeTimers()
      const history = { replaceState: vi.fn() }
      const location = {
        hash: outcome === "empty" ? "" : "#local-fixture-token",
        pathname: "/watch/api/recommendations/tester",
        replace: vi.fn(),
      }
      const fetch = vi.fn((_url: string, options: RequestInit) => {
        expect(history.replaceState).toHaveBeenCalledWith(
          null,
          "",
          location.pathname,
        )
        if (outcome === "success") return Promise.resolve({ status: 204 })
        if (outcome === "rejected")
          return Promise.reject(new TypeError("offline"))
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new TypeError("timeout")),
          )
        })
      })
      const html = await GET().text()
      const document = new DOMParser().parseFromString(html, "text/html")
      const script = document.querySelector("script")?.textContent
      expect(script).toBeTruthy()
      const finished = runInNewContext(script!, {
        history,
        location,
        fetch,
        AbortController,
        setTimeout,
        clearTimeout,
      })
      if (outcome === "timeout") await vi.advanceTimersByTimeAsync(5000)
      await finished
      if (outcome === "empty") expect(fetch).not.toHaveBeenCalled()
      else
        expect(fetch).toHaveBeenCalledWith(
          location.pathname,
          expect.objectContaining({
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({ token: "local-fixture-token" }),
          }),
        )
      expect(location.replace).toHaveBeenCalledExactlyOnceWith("/watch")
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it("serves a blank, isolated, non-cacheable fragment bridge with a fresh CSP nonce", async () => {
    const response = GET()
    const html = await response.text()
    const document = new DOMParser().parseFromString(html, "text/html")
    expect(response.headers.get("cache-control")).toContain("private, no-store")
    expect(response.headers.get("cache-control")).toContain("no-transform")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
    const nonce = document.querySelector("script")?.getAttribute("nonce")
    expect(nonce).toBeTruthy()
    expect(response.headers.get("content-security-policy")).toContain(
      `script-src 'nonce-${nonce}'`,
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    )
    expect(html.indexOf("history.replaceState")).toBeLessThan(
      html.indexOf("fetch("),
    )
    expect(html).toContain('location.replace("/watch")')
    expect(document.querySelectorAll("script").length).toBe(1)
    expect(
      document.querySelectorAll("script[src],button,form,input").length,
    ).toBe(0)
    expect(html).not.toMatch(/datadog|gtag/i)
    expect(GET().headers.get("content-security-policy")).not.toBe(
      response.headers.get("content-security-policy"),
    )
  })
})
