import { afterEach, describe, expect, it, vi } from "vitest"

const {
  clearWatchRouteManifestCacheMock,
  clearWatchSeoManifestCacheMock,
  revalidatePathMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  clearWatchRouteManifestCacheMock: vi.fn(),
  clearWatchSeoManifestCacheMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}))

vi.mock("@/lib/watch-route-manifest", () => ({
  clearWatchRouteManifestCache: clearWatchRouteManifestCacheMock,
}))

vi.mock("@/lib/watch-seo-manifest", () => ({
  clearWatchSeoManifestCache: clearWatchSeoManifestCacheMock,
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}))

describe("POST /api/revalidate", () => {
  afterEach(() => {
    clearWatchRouteManifestCacheMock.mockReset()
    clearWatchSeoManifestCacheMock.mockReset()
    revalidatePathMock.mockReset()
    revalidateTagMock.mockReset()
    vi.doUnmock("@/i18n/generated-ui-locales")
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
    const body = await response.json()
    expect(body).toMatchObject({ revalidated: true })
    expect(body.tags).toEqual([
      "watch:home",
      "watch:settings",
      "watch:experience",
      "watch:video",
      "watch:series",
      "watch:child-dub-languages",
    ])
    expect(body.paths).toEqual(
      expect.arrayContaining([
        "/[locale]/[htmlLang] (layout)",
        "/ (layout)",
        "/",
        "/en/en",
        "/russian.html",
        "/ru/ru/russian.html",
        "/russian",
        "/german-standard.html",
        "/de/de/german-standard.html",
        "/german-standard",
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
      ]),
    )
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
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:home", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:settings", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:experience", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:video", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:series", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "watch:child-dub-languages",
      { expire: 0 },
    )
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
    const body = await response.json()
    expect(body).toMatchObject({ revalidated: true })
    expect(body.tags).toEqual(["watch:experience", "watch:home"])
    expect(body.paths).toEqual(
      expect.arrayContaining([
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
        "/german-standard.html",
        "/de/de/german-standard.html",
        "/german-standard",
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
        "/russian.html",
        "/ru/ru/russian.html",
        "/russian",
      ]),
    )
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
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:experience", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:home", {
      expire: 0,
    })
  })

  it("keeps path invalidation working when tag invalidation fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    revalidateTagMock
      .mockImplementationOnce(() => {
        throw new Error("tag cache unavailable")
      })
      .mockImplementation(() => undefined)

    try {
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
      const body = await response.json()
      expect(body).toMatchObject({
        revalidated: true,
        tags: ["watch:home"],
        tagErrors: ["watch:experience"],
      })
      expect(body.paths).toEqual(
        expect.arrayContaining([
          "/jesus.html/english.html",
          "/en/en/jesus.html/english.html",
          "/jesus/english",
        ]),
      )
      expect(revalidatePathMock).toHaveBeenCalledWith(
        "/jesus.html/english.html",
      )
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
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
      tags: [
        "watch:video",
        "watch:series",
        "watch:child-dub-languages",
        "watch:home",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/jesus.html/german-standard.html",
    )
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/jesus.html/de.html")
    expect(revalidatePathMock).not.toHaveBeenCalledWith(
      "/jesus.html/german.html",
    )
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:video", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:series", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "watch:child-dub-languages",
      { expire: 0 },
    )
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:home", {
      expire: 0,
    })
  })

  it("supports broad video data invalidation without a slug", async () => {
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
          entry: {},
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      paths: ["/[locale]/[htmlLang] (layout)", "/ (layout)"],
      tags: [
        "watch:video",
        "watch:series",
        "watch:child-dub-languages",
        "watch:home",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:video", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:series", {
      expire: 0,
    })
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "watch:child-dub-languages",
      { expire: 0 },
    )
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:home", {
      expire: 0,
    })
  })

  it("infers public audio slugs for generated catalog locales outside the original core set", async () => {
    vi.doMock("@/i18n/generated-ui-locales", () => {
      const locales = ["en", "ru"] as const
      return {
        DEFAULT_LOCALE: "en",
        AVAILABLE_UI_LOCALES: locales,
        hasUiLocale: (candidate: string) =>
          (locales as readonly string[]).includes(candidate),
      }
    })
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
            locale: "ru",
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      paths: [
        "/jesus.html/russian.html",
        "/ru/ru/jesus.html/russian.html",
        "/jesus/russian",
      ],
      tags: [
        "watch:video",
        "watch:series",
        "watch:child-dub-languages",
        "watch:home",
      ],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html/russian.html")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/ru/ru/jesus.html/russian.html",
    )
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/jesus.html/ru.html")
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
      paths: ["/[locale]/[htmlLang] (layout)", "/ (layout)"],
      tags: ["watch:route-manifest"],
    })
    expect(clearWatchRouteManifestCacheMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/[locale]/[htmlLang]",
      "layout",
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout")
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:route-manifest", {
      expire: 0,
    })
  })

  it("clears the cached watch seo manifest and revalidates sitemap routes", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: JSON.stringify({
          model: "watch-seo-manifest",
          entry: {},
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revalidated: true,
      seoManifestCacheCleared: true,
      paths: ["/sitemap.xml", "/sitemap/[id] (page)", "/sitemap (layout)"],
      tags: ["watch:seo-manifest"],
    })
    expect(clearWatchSeoManifestCacheMock).toHaveBeenCalledTimes(1)
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalledWith("/sitemap.xml")
    expect(revalidatePathMock).toHaveBeenCalledWith("/sitemap/[id]", "page")
    expect(revalidatePathMock).toHaveBeenCalledWith("/sitemap", "layout")
    expect(revalidateTagMock).toHaveBeenCalledWith("watch:seo-manifest", {
      expire: 0,
    })
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
    expect(revalidateTagMock).not.toHaveBeenCalled()
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
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it("rejects wrong non-ASCII bearer tokens without throwing", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer tést-revalidation-secret",
        },
        body: JSON.stringify({
          model: "experience",
          entry: { slug: "jesus", locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
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
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
  })

  it("rejects non-object JSON payloads with 400 and no cache side effects", async () => {
    const { POST } = await import("./route")

    const response = await POST(
      new Request("http://example.test/api/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-revalidation-secret",
        },
        body: "null",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_payload",
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
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
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
  })

  it("rejects non-string slug payloads with 400", async () => {
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
          entry: { slug: 123, locale: "en" },
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_payload",
    })
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
  })

  it("rejects invalid locale payloads with 400 and no cache side effects", async () => {
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
          entry: { slug: "jesus", locale: "not-a-locale" },
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(clearWatchRouteManifestCacheMock).not.toHaveBeenCalled()
  })
})
