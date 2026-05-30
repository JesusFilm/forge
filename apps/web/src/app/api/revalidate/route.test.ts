import { afterEach, describe, expect, it, vi } from "vitest"

const { clearWatchRouteManifestCacheMock, revalidatePathMock } = vi.hoisted(
  () => ({
    clearWatchRouteManifestCacheMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
)

vi.mock("@/lib/watch-route-manifest", () => ({
  clearWatchRouteManifestCache: clearWatchRouteManifestCacheMock,
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

describe("POST /api/revalidate", () => {
  afterEach(() => {
    clearWatchRouteManifestCacheMock.mockReset()
    revalidatePathMock.mockReset()
    vi.resetModules()
  })

  it("revalidates the full watch app when watch settings change (Bearer)", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "watch-setting",
          entry: {
            locale: "en",
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      paths: [
        "/[locale]/[htmlLang] (layout)",
        "/ (layout)",
        "/",
        "/en/en",
        "/german.html",
        "/de/de/german.html",
        "/german",
        "/english.html",
        "/en/en/english.html",
        "/english",
        "/spanish-castilian.html",
        "/es/es-ES/spanish-castilian.html",
        "/spanish-castilian",
        "/french.html",
        "/fr/fr/french.html",
        "/french",
        "/portuguese-brazil.html",
        "/pt/pt/portuguese-brazil.html",
        "/portuguese-brazil",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en")
    expect(revalidatePathMock).toHaveBeenCalledWith("/english.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en/english.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/english")
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/en.html")
  })

  it("revalidates slug and localized variants for experience updates (Bearer)", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "experience",
          entry: {
            slug: "jesus",
            locale: "en",
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      paths: [
        "/jesus.html/english.html",
        "/en/en/jesus.html/english.html",
        "/jesus/english",
        "/jesus.html",
        "/en/en/jesus.html",
        "/jesus",
        "/[locale]/[htmlLang] (layout)",
        "/ (layout)",
        "/",
        "/en/en",
        "/german.html",
        "/de/de/german.html",
        "/german",
        "/english.html",
        "/en/en/english.html",
        "/english",
        "/spanish-castilian.html",
        "/es/es-ES/spanish-castilian.html",
        "/spanish-castilian",
        "/french.html",
        "/fr/fr/french.html",
        "/french",
        "/portuguese-brazil.html",
        "/pt/pt/portuguese-brazil.html",
        "/portuguese-brazil",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html/english.html")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/en/en/jesus.html/english.html",
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus/english")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en/jesus.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
    )
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/jesus.html/en.html")
    expect(revalidatePathMock).not.toHaveBeenCalledWith(
      "/en/en/jesus.html/en.html",
    )
  })

  it("uses the canonical public audio slug for non-English localized content", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "video",
          entry: {
            slug: "jesus",
            locale: "de",
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      paths: [
        "/jesus.html/german-standard.html",
        "/de/de/jesus.html/german-standard.html",
        "/jesus/german-standard",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/jesus.html/german-standard.html",
    )
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/jesus.html/de.html")
    expect(revalidatePathMock).not.toHaveBeenCalledWith(
      "/jesus.html/german.html",
    )
  })

  it("still accepts the legacy x-revalidation-secret header (fallback)", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revalidation-secret": "test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "experience",
          entry: { slug: "jesus", locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(200)
  })

  it("clears the cached watch route manifest when admin refreshes it", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "watch-route-manifest",
          entry: {},
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      manifestCacheCleared: true,
      paths: [],
    })
    expect(clearWatchRouteManifestCacheMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("rejects requests with no auth header", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "experience",
          entry: { slug: "jesus", locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("rejects requests with a wrong Bearer token", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({
          model: "experience",
          entry: { slug: "jesus", locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON with 400", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: "{ not json",
      }),
    )

    expect(response.status).toBe(400)
  })

  it("rejects malformed slug with 400", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "experience",
          entry: { slug: "../etc/passwd", locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(400)
  })
})
