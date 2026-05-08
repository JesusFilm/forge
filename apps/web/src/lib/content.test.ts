import { print } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock, adminQueryMock, modeRef, runDualReadComparisonMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn(),
    adminQueryMock: vi.fn(),
    modeRef: { current: "strapi" as "strapi" | "dual-read" },
    runDualReadComparisonMock: vi.fn(),
  }))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")

  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/client", () => ({
  default: {
    query: queryMock,
  },
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: adminQueryMock,
  },
}))

vi.mock("@/lib/content-api-mode", () => ({
  getContentApiMode: () => modeRef.current,
}))

vi.mock("@/lib/parity-bridge", () => ({
  runDualReadComparison: runDualReadComparisonMock,
}))

describe("resolveWatchPage", () => {
  beforeEach(() => {
    modeRef.current = "strapi"
  })

  afterEach(() => {
    queryMock.mockReset()
    adminQueryMock.mockReset()
    runDualReadComparisonMock.mockReset()
    vi.resetModules()
  })

  it("prefers an explicit experience when the slug matches one", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        experiences: [
          {
            documentId: "exp-1",
            slug: "christmas",
            isTemplate: false,
            title: "Christmas",
          },
        ],
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "christmas",
        isTemplate: false,
      },
    })
  })

  it("falls back to the default template for plain video slugs", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          experiences: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-1",
              slug: "jesus",
              title: "Jesus",
              snippet: "The story of Jesus",
              description: "A full description",
              imageAlt: "Jesus still",
              noIndex: false,
              images: [{ url: "https://cdn.example/jesus.jpg" }],
              primaryLanguage: { coreId: "529" },
              variants: [
                {
                  documentId: "variant-1",
                  hls: "https://cdn.example/jesus.m3u8",
                  published: true,
                  language: { coreId: "529" },
                },
              ],
              children: [
                {
                  documentId: "child-1",
                  slug: "the-beginning",
                  title: "The Beginning",
                  label: "segment",
                  images: [{ url: "https://cdn.example/child.jpg" }],
                },
                {
                  documentId: "video-1",
                  slug: "jesus",
                  title: "Jesus",
                  label: "self",
                  images: [{ url: "https://cdn.example/self.jpg" }],
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              isTemplate: true,
              title: "Single Video Template",
            },
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(print(queryMock.mock.calls[1][0].query)).toMatch(
      /children\(pagination:\s*\{limit:\s*24\}\)/,
    )
    // GET_ROUTE_VIDEO must paginate variants with `limit: -1` for the same
    // reason WatchVideoFragment does (see watch-video.test.ts): the default
    // 10-row return would silently drop the playable variant for any video
    // whose first 10 variants don't include the primary language, sending
    // the watch page to the wrong locale.
    expect(print(queryMock.mock.calls[1][0].query)).toMatch(
      /variants\(pagination:\s*\{\s*limit:\s*-1\s*\}\)/,
    )

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: {
        slug: "single-video",
        isTemplate: true,
      },
      routeVideo: {
        slug: "jesus",
        title: "Jesus",
        streamingUrl: "https://cdn.example/jesus.m3u8",
        relatedItems: [
          {
            title: "The Beginning",
            label: "segment",
            videoSlug: "the-beginning",
          },
        ],
      },
    })
  })

  it("returns a configuration error when the default template is not marked as template", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          experiences: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-1",
              slug: "jesus",
              title: "Jesus",
              snippet: null,
              description: null,
              imageAlt: null,
              noIndex: false,
              images: [],
              primaryLanguage: { coreId: "529" },
              variants: [
                {
                  documentId: "variant-1",
                  hls: "https://cdn.example/jesus.m3u8",
                  published: true,
                  language: { coreId: "529" },
                },
              ],
              children: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            defaultTemplateExperience: {
              documentId: "exp-template-1",
              slug: "single-video",
              isTemplate: false,
            },
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe(
      "Default template experience must be marked as template.",
    )
  })
})

// ---------------------------------------------------------------------------
// U5 — fetchSlugExperience canary mode tests
//
// These exercise the dual-read branching introduced in U3. The canary
// surface is the slug-page Experience fetcher; resolveWatchPage uses it
// for the slug-equality case but NOT for the homepage path.
// ---------------------------------------------------------------------------

describe("fetchSlugExperience (U5 canary)", () => {
  beforeEach(() => {
    modeRef.current = "strapi"
  })

  afterEach(() => {
    queryMock.mockReset()
    adminQueryMock.mockReset()
    runDualReadComparisonMock.mockReset()
    vi.resetModules()
  })

  function strapiHit(documentId = "exp-1", title = "Christmas") {
    return {
      data: {
        experiences: [
          {
            documentId,
            slug: "christmas",
            locale: "en",
            isTemplate: false,
            title,
          },
        ],
      },
    }
  }

  function adminHit(id = "admin-1", title = "Christmas") {
    return {
      data: {
        experienceBySlug: {
          id,
          slug: "christmas",
          locale: "en",
          title,
          metaDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Default mode — strapi
  // ---------------------------------------------------------------------------

  it("strapi mode: serves Strapi unchanged and never touches admin", async () => {
    modeRef.current = "strapi"
    queryMock.mockResolvedValueOnce(strapiHit())

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(adminQueryMock).not.toHaveBeenCalled()
    expect(runDualReadComparisonMock).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { slug: "christmas" },
    })
  })

  // ---------------------------------------------------------------------------
  // dual-read happy path
  // ---------------------------------------------------------------------------

  it("dual-read mode: serves Strapi to user and hands both responses to bridge", async () => {
    modeRef.current = "dual-read"
    queryMock.mockResolvedValueOnce(strapiHit("strapi-1"))
    adminQueryMock.mockResolvedValueOnce(adminHit("admin-1"))

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(adminQueryMock).toHaveBeenCalledTimes(1)
    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)

    // User-facing source is Strapi (documentId from the strapiHit fixture).
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { documentId: "strapi-1", slug: "christmas" },
    })

    // Bridge received both outcomes with ok: true.
    const outcome = runDualReadComparisonMock.mock.calls[0][0]
    expect(outcome).toMatchObject({
      slug: "christmas",
      urlLocale: "en",
      strapi: { ok: true },
      admin: { ok: true },
    })
  })

  // ---------------------------------------------------------------------------
  // dual-read: admin fails, Strapi succeeds — user unaffected
  // ---------------------------------------------------------------------------

  it("dual-read mode: admin throws ApolloError → user gets Strapi, bridge sees error outcome", async () => {
    modeRef.current = "dual-read"
    queryMock.mockResolvedValueOnce(strapiHit())
    // Typed Apollo error shape (mocked-shape-vs-real-contract discipline).
    const apolloError = Object.assign(new Error("admin network error"), {
      name: "ApolloError",
      networkError: new Error("ECONNREFUSED"),
      graphQLErrors: [],
    })
    adminQueryMock.mockRejectedValueOnce(apolloError)

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ kind: "experience" })

    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)
    const outcome = runDualReadComparisonMock.mock.calls[0][0]
    expect(outcome.strapi.ok).toBe(true)
    expect(outcome.admin.ok).toBe("error")
  })

  // ---------------------------------------------------------------------------
  // dual-read: admin times out — user unaffected
  // ---------------------------------------------------------------------------

  it("dual-read mode: admin AbortError classified as 'timeout', user gets Strapi", async () => {
    modeRef.current = "dual-read"
    queryMock.mockResolvedValueOnce(strapiHit())
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    })
    adminQueryMock.mockRejectedValueOnce(abortError)

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(result.error).toBeNull()
    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)
    const outcome = runDualReadComparisonMock.mock.calls[0][0]
    expect(outcome.admin.ok).toBe("timeout")
  })

  // ---------------------------------------------------------------------------
  // dual-read: Strapi throws, admin succeeds — gating signal for U5b advance
  // ---------------------------------------------------------------------------

  it("dual-read mode: Strapi throws + admin OK → Strapi error propagates, bridge sees the gating signal", async () => {
    modeRef.current = "dual-read"
    const strapiError = new Error("strapi 503")
    queryMock.mockRejectedValueOnce(strapiError)
    adminQueryMock.mockResolvedValueOnce(adminHit())

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    // User-facing: Strapi error propagates (Strapi is the served source).
    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("strapi 503")

    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)
    const outcome = runDualReadComparisonMock.mock.calls[0][0]
    expect(outcome.strapi.ok).toBe("error")
    expect(outcome.admin.ok).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // dual-read: both fail — Strapi error propagates
  // ---------------------------------------------------------------------------

  it("dual-read mode: both throw → Strapi error propagates, bridge sees both_failed", async () => {
    modeRef.current = "dual-read"
    queryMock.mockRejectedValueOnce(new Error("strapi down"))
    adminQueryMock.mockRejectedValueOnce(new Error("admin down"))

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("strapi down")

    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)
    const outcome = runDualReadComparisonMock.mock.calls[0][0]
    expect(outcome.strapi.ok).toBe("error")
    expect(outcome.admin.ok).toBe("error")
  })

  // ---------------------------------------------------------------------------
  // Integration — resolveSlugPage shape stable across modes
  // ---------------------------------------------------------------------------

  it("resolveSlugPage shape is identical across strapi and dual-read for the same fixture", async () => {
    // Run once in strapi mode, once in dual-read mode, with identical
    // Strapi mocks. The user-facing return value should match.
    modeRef.current = "strapi"
    queryMock.mockResolvedValueOnce(strapiHit("shared-1", "Shared"))
    let mod = await import("./content")
    const strapiResult = await mod.resolveWatchPage("en", "christmas")

    vi.resetModules()
    queryMock.mockReset()
    adminQueryMock.mockReset()

    modeRef.current = "dual-read"
    queryMock.mockResolvedValueOnce(strapiHit("shared-1", "Shared"))
    adminQueryMock.mockResolvedValueOnce(adminHit("shared-1", "Shared"))
    mod = await import("./content")
    const dualReadResult = await mod.resolveWatchPage("en", "christmas")

    expect(dualReadResult).toEqual(strapiResult)
  })
})

// ---------------------------------------------------------------------------
// U5 — Regression snapshot: default behavior unchanged
//
// First-line-of-defense test that asserts every accepted mode value
// produces a Strapi-equivalent return for the slug-page Experience fetch.
// The "garbage" / null / undefined / empty-string cases all flow through
// the strapi default branch (normalizeContentApiMode falls back). The
// "dual-read" case asserts the user-facing return is still Strapi-driven
// and that adminQueryMock was called (proving the canary is active).
// ---------------------------------------------------------------------------

describe("U5 regression — default behavior across mode values", () => {
  beforeEach(() => {
    modeRef.current = "strapi"
  })

  afterEach(() => {
    queryMock.mockReset()
    adminQueryMock.mockReset()
    runDualReadComparisonMock.mockReset()
    vi.resetModules()
  })

  function fixture() {
    return {
      data: {
        experiences: [
          {
            documentId: "regression-1",
            slug: "christmas",
            locale: "en",
            isTemplate: false,
            title: "Regression Fixture",
          },
        ],
      },
    }
  }

  // The undefined/null/empty-string/garbage cases fall back to "strapi"
  // via env.ts's z.enum.default before reaching content-api-mode, so the
  // mocked getContentApiMode only ever receives the typed union values.
  // The "strapi" branch is the regression-protected default; "dual-read"
  // is exercised in the canary tests above.
  it("mode='strapi' returns Strapi-equivalent value and never touches admin", async () => {
    modeRef.current = "strapi"
    queryMock.mockResolvedValueOnce(fixture())

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { documentId: "regression-1", slug: "christmas" },
    })
    expect(adminQueryMock).not.toHaveBeenCalled()
    expect(runDualReadComparisonMock).not.toHaveBeenCalled()
  })

  it("mode='dual-read' still returns Strapi value to the user (admin runs in shadow)", async () => {
    modeRef.current = "dual-read"
    queryMock.mockResolvedValueOnce(fixture())
    adminQueryMock.mockResolvedValueOnce({
      data: {
        experienceBySlug: {
          id: "admin-shadow",
          slug: "christmas",
          locale: "en",
          title: "Regression Fixture",
          metaDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      },
    })

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(result.error).toBeNull()
    // Strapi documentId is what reaches the user, NOT admin's id.
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { documentId: "regression-1" },
    })
    expect(adminQueryMock).toHaveBeenCalledTimes(1)
    expect(runDualReadComparisonMock).toHaveBeenCalledTimes(1)
  })

  // print() round-trip — the GET_WATCH_EXPERIENCE query is unchanged
  // shape across U5; if a future refactor inadvertently rewrites it,
  // this catches the drift.
  it("GET_WATCH_EXPERIENCE selects WatchExperience (with locale field)", async () => {
    modeRef.current = "strapi"
    queryMock.mockResolvedValueOnce(fixture())
    const { resolveWatchPage } = await import("./content")
    await resolveWatchPage("en", "christmas")
    const sentQuery = print(queryMock.mock.calls[0][0].query)
    // U5 added `locale` to the WatchExperience fragment so normalizeStrapi
    // can validate without the bridge's synth fallback. This pins it.
    expect(sentQuery).toMatch(
      /fragment WatchExperience on Experience[\s\S]*locale/,
    )
  })
})
