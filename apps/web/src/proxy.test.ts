import { describe, expect, it } from "vitest"

import { proxy } from "./proxy"

type CookieMap = Record<string, string>

function makeRequest(
  pathname: string,
  options: { cookies?: CookieMap; acceptLanguage?: string } = {},
) {
  // Minimal NextRequest stand-in. proxy() only touches:
  //   - request.nextUrl.pathname
  //   - request.nextUrl.clone()
  //   - request.cookies.get()
  //   - request.headers.get()
  const url = new URL(`https://www.jesusfilm.org${pathname}`)
  const cookies = {
    get: (name: string) =>
      options.cookies?.[name] != null
        ? { name, value: options.cookies[name] }
        : undefined,
  }
  const headers = {
    get: (name: string) =>
      name.toLowerCase() === "accept-language"
        ? (options.acceptLanguage ?? null)
        : null,
  }
  return {
    nextUrl: Object.assign(url, {
      clone: () => new URL(url.toString()),
    }),
    cookies,
    headers,
  } as unknown as Parameters<typeof proxy>[0]
}

describe("proxy — language preference cookie", () => {
  it("redirects /<slug>/<locale> to /<slug>/<preferredSlug> when cookie disagrees", () => {
    const request = makeRequest("/jesus/english", {
      cookies: { forge_watch_lang: "spanish" },
    })
    const response = proxy(request)
    expect(response.status).toBe(307)
    const location = response.headers.get("location")
    expect(location).toContain("/jesus/spanish")
  })

  it("does not redirect when cookie matches the URL locale", () => {
    const request = makeRequest("/jesus/spanish", {
      cookies: { forge_watch_lang: "spanish" },
    })
    const response = proxy(request)
    expect(response.status).not.toBe(307)
  })

  it("does not redirect when no cookie is set", () => {
    const request = makeRequest("/jesus/english")
    const response = proxy(request)
    expect(response.status).not.toBe(307)
  })

  it("URL-decodes the cookie value before comparing", () => {
    const request = makeRequest("/jesus/english", {
      cookies: { forge_watch_lang: encodeURIComponent("chinese-simplified") },
    })
    const response = proxy(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain(
      "/jesus/chinese-simplified",
    )
  })

  it("ignores a malformed cookie value rather than crashing", () => {
    const request = makeRequest("/jesus/english", {
      cookies: { forge_watch_lang: "%E0%A4%A" }, // truncated percent-escape
    })
    const response = proxy(request)
    expect(response.status).not.toBe(307)
  })

  it("ignores an empty cookie value", () => {
    const request = makeRequest("/jesus/english", {
      cookies: { forge_watch_lang: "" },
    })
    const response = proxy(request)
    expect(response.status).not.toBe(307)
  })
})

describe("proxy — non-watch routes are unaffected by the cookie", () => {
  it("does not redirect a single-segment path even with a cookie", () => {
    const request = makeRequest("/jesus", {
      cookies: { forge_watch_lang: "spanish" },
    })
    const response = proxy(request)
    // /jesus is not a watch route shape (only 1 segment); cookie ignored.
    expect(response.status).not.toBe(307)
  })
})
