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

  it("revalidates the full watch app when watch settings change", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revalidation-secret": "test-revalidation-secret",
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
      paths: ["/ (layout)", "/", "/en", "/es", "/fr", "/pt", "/de"],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
    expect(revalidatePathMock).toHaveBeenCalledWith("/")
    expect(revalidatePathMock).toHaveBeenCalledWith("/en")
  })

  it("revalidates slug and localized variants for experience updates", async () => {
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
        "/en",
        "/es",
        "/fr",
        "/pt",
        "/de",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus/en")
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus")
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
  })
})
