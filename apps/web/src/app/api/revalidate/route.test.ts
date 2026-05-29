import { afterEach, describe, expect, it, vi } from "vitest"

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

describe("POST /api/revalidate", () => {
  afterEach(() => {
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
        "/de.html",
        "/de/de/de.html",
        "/de",
        "/en.html",
        "/en/en/en.html",
        "/en",
        "/es.html",
        "/es/es/es.html",
        "/es",
        "/fr.html",
        "/fr/fr/fr.html",
        "/fr",
        "/pt.html",
        "/pt/pt/pt.html",
        "/pt",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en/en.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en")
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
        "/jesus.html/en.html",
        "/en/en/jesus.html/en.html",
        "/jesus/en",
        "/jesus.html",
        "/en/en/jesus.html",
        "/jesus",
        "/[locale]/[htmlLang] (layout)",
        "/ (layout)",
        "/",
        "/en/en",
        "/de.html",
        "/de/de/de.html",
        "/de",
        "/en.html",
        "/en/en/en.html",
        "/en",
        "/es.html",
        "/es/es/es.html",
        "/es",
        "/fr.html",
        "/fr/fr/fr.html",
        "/fr",
        "/pt.html",
        "/pt/pt/pt.html",
        "/pt",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html/en.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en/jesus.html/en.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus/en")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/en/jesus.html")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
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
