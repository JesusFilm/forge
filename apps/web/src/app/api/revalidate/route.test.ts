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
      paths: ["/ (layout)", "/", "/de", "/en", "/es", "/fr", "/pt"],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
    expect(revalidatePathMock).toHaveBeenCalledWith("/")
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
        "/jesus/en",
        "/jesus",
        "/ (layout)",
        "/",
        "/de",
        "/en",
        "/es",
        "/fr",
        "/pt",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus/en")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus")
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
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
