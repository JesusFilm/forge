import { print } from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock, adminQueryMock, modeRef, envRef } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  adminQueryMock: vi.fn(),
  modeRef: { current: "strapi" as "strapi" | "admin" },
  envRef: { WEB_ADMIN_API_KEYS: "key-1,key-2" as string | undefined },
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

vi.mock("@/env", () => ({
  env: envRef,
}))

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

describe("resolveWatchPage", () => {
  beforeEach(() => {
    modeRef.current = "strapi"
    envRef.WEB_ADMIN_API_KEYS = "key-1,key-2"
  })

  afterEach(() => {
    queryMock.mockReset()
    adminQueryMock.mockReset()
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
// U6 (plan-003 PR-B) — fetchSlugExperience direct cutover branch
//
// The branch table is now 2-case: `strapi` (default, unchanged) and
// `admin` (direct cutover). Admin failures throw a typed
// `WatchPageAdminError("NOT_FOUND" | "UNAVAILABLE")` that the cache
// wrapper re-throws so the segment error boundary can fire.
// ---------------------------------------------------------------------------

describe("fetchSlugExperience (U6 admin cutover)", () => {
  beforeEach(() => {
    modeRef.current = "strapi"
    envRef.WEB_ADMIN_API_KEYS = "key-1,key-2"
  })

  afterEach(() => {
    queryMock.mockReset()
    adminQueryMock.mockReset()
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
          isTemplate: false,
          metaDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      },
    }
  }

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  it("strapi mode: serves Strapi unchanged and never touches admin", async () => {
    modeRef.current = "strapi"
    queryMock.mockResolvedValueOnce(strapiHit())

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(adminQueryMock).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { slug: "christmas" },
    })
  })

  it("admin mode: serves admin response and never touches Strapi", async () => {
    modeRef.current = "admin"
    adminQueryMock.mockResolvedValueOnce(adminHit("admin-1"))

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en", "christmas")

    expect(adminQueryMock).toHaveBeenCalledTimes(1)
    expect(queryMock).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
    // Renderer receives admin-shape WatchExperience (admin's `id` field
    // is the discriminator vs Strapi's `documentId`).
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: { id: "admin-1", slug: "christmas" },
    })
  })

  // -------------------------------------------------------------------------
  // Admin error paths
  // -------------------------------------------------------------------------

  it("admin mode + admin returns null → throws WatchPageAdminError('NOT_FOUND')", async () => {
    modeRef.current = "admin"
    adminQueryMock.mockResolvedValueOnce({
      data: { experienceBySlug: null },
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage, WatchPageAdminError } =
        await import("./content")
      // Cache wrapper re-throws WatchPageAdminError — must reach caller.
      await expect(resolveWatchPage("en", "christmas")).rejects.toBeInstanceOf(
        WatchPageAdminError,
      )

      // Re-run to assert the code field on the thrown instance.
      adminQueryMock.mockResolvedValueOnce({
        data: { experienceBySlug: null },
      })
      try {
        await resolveWatchPage("en", "christmas")
      } catch (err) {
        expect(err).toBeInstanceOf(WatchPageAdminError)
        expect((err as InstanceType<typeof WatchPageAdminError>).code).toBe(
          "NOT_FOUND",
        )
      }

      // forge.parity.admin_null event was logged.
      const adminNullCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" && arg.includes("forge.parity.admin_null")
        )
      })
      expect(adminNullCall).toBeDefined()
    } finally {
      logSpy.mockRestore()
    }
  })

  // Mocked-shape-vs-real-contract discipline (per
  // docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md):
  // typed Apollo error shape — name === "ApolloError" + networkError —
  // not generic Error("...").
  it("admin mode + Apollo error → throws WatchPageAdminError('UNAVAILABLE') with cause", async () => {
    modeRef.current = "admin"
    const apolloError = Object.assign(new Error("admin network error"), {
      name: "ApolloError",
      networkError: new Error("ECONNREFUSED"),
      graphQLErrors: [],
    })
    adminQueryMock.mockRejectedValueOnce(apolloError)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage, WatchPageAdminError } =
        await import("./content")
      let thrown: unknown
      try {
        await resolveWatchPage("en", "christmas")
      } catch (err) {
        thrown = err
      }

      expect(thrown).toBeInstanceOf(WatchPageAdminError)
      const watchErr = thrown as InstanceType<typeof WatchPageAdminError>
      expect(watchErr.code).toBe("UNAVAILABLE")
      // Original Apollo error is preserved as cause.
      expect(watchErr.cause).toBe(apolloError)

      // forge.parity.admin_fetch_error event was logged with original message.
      const fetchErrCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" &&
          arg.includes("forge.parity.admin_fetch_error")
        )
      })
      expect(fetchErrCall).toBeDefined()
      const payload = JSON.parse(fetchErrCall?.[0] as string)
      expect(payload.errorMessage).toBe("admin network error")
    } finally {
      logSpy.mockRestore()
    }
  })

  // F15 (ce-code-review): hostile-admin scenario — error message echoes the
  // bearer (Apollo can carry downstream response body text in `.message`).
  // The scrub MUST redact every occurrence of the bearer's first CSV entry
  // before the message lands in a structured log.
  it("admin mode + Apollo error containing bearer string → log payload has <redacted>, not the bearer", async () => {
    modeRef.current = "admin"
    envRef.WEB_ADMIN_API_KEYS = "secret-bearer-aaa,secret-bearer-bbb"
    const apolloError = Object.assign(
      new Error(
        "Response not successful: Authorization: Bearer secret-bearer-aaa (admin echoed the header in a 500 body) — second occurrence: secret-bearer-aaa",
      ),
      {
        name: "ApolloError",
        networkError: new Error("500"),
        graphQLErrors: [],
      },
    )
    adminQueryMock.mockRejectedValueOnce(apolloError)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage } = await import("./content")
      try {
        await resolveWatchPage("en", "christmas")
      } catch {
        /* expected throw */
      }

      const fetchErrCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" &&
          arg.includes("forge.parity.admin_fetch_error")
        )
      })
      expect(fetchErrCall).toBeDefined()
      const payload = JSON.parse(fetchErrCall?.[0] as string)
      expect(payload.errorMessage).not.toContain("secret-bearer-aaa")
      expect(payload.errorMessage).toContain("<redacted>")
      // Second occurrence redacted too (split/join replaces all).
      expect(
        (payload.errorMessage.match(/<redacted>/g) ?? []).length,
      ).toBeGreaterThanOrEqual(2)
    } finally {
      logSpy.mockRestore()
    }
  })

  it("admin mode + AbortError → throws WatchPageAdminError('UNAVAILABLE') (timeout)", async () => {
    modeRef.current = "admin"
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    })
    adminQueryMock.mockRejectedValueOnce(abortError)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage, WatchPageAdminError } =
        await import("./content")
      let thrown: unknown
      try {
        await resolveWatchPage("en", "christmas")
      } catch (err) {
        thrown = err
      }

      expect(thrown).toBeInstanceOf(WatchPageAdminError)
      expect((thrown as InstanceType<typeof WatchPageAdminError>).code).toBe(
        "UNAVAILABLE",
      )
      // Logged as admin_timeout (NOT admin_fetch_error) — classification
      // is by error.name, not message substring.
      const timeoutCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" && arg.includes("forge.parity.admin_timeout")
        )
      })
      expect(timeoutCall).toBeDefined()
    } finally {
      logSpy.mockRestore()
    }
  })

  // Apollo Client v4 wraps fetch transport errors in networkError. The
  // classifier must walk this shape so a real 3s timeout still classifies
  // as admin_timeout, not admin_fetch_error.
  it("admin mode + timeout via Apollo networkError chain → classified as timeout", async () => {
    modeRef.current = "admin"
    const apolloWithNetworkTimeout = Object.assign(new Error("network error"), {
      name: "ApolloError",
      networkError: Object.assign(new Error("aborted"), {
        name: "AbortError",
      }),
    })
    adminQueryMock.mockRejectedValueOnce(apolloWithNetworkTimeout)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage } = await import("./content")
      await resolveWatchPage("en", "christmas").catch(() => {})

      const timeoutCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" && arg.includes("forge.parity.admin_timeout")
        )
      })
      expect(timeoutCall).toBeDefined()
    } finally {
      logSpy.mockRestore()
    }
  })

  // Apollo result.error (resolved-with-error, not rejected) is a distinct
  // production shape. The fetcher's catch handles rejection; the
  // result.error branch handles in-resolution errors. Both must classify
  // consistently.
  it("admin mode + Apollo result.error AbortError → classified as timeout", async () => {
    modeRef.current = "admin"
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    })
    adminQueryMock.mockResolvedValueOnce({
      data: null,
      error: abortError,
    })
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage } = await import("./content")
      await resolveWatchPage("en", "christmas").catch(() => {})

      const timeoutCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" && arg.includes("forge.parity.admin_timeout")
        )
      })
      expect(timeoutCall).toBeDefined()
    } finally {
      logSpy.mockRestore()
    }
  })

  // -------------------------------------------------------------------------
  // Runtime safety net — WEB_ADMIN_API_KEYS unset
  // -------------------------------------------------------------------------

  it("admin mode + WEB_ADMIN_API_KEYS unset → logs consumer_bearer_missing and falls back to strapi", async () => {
    modeRef.current = "admin"
    envRef.WEB_ADMIN_API_KEYS = undefined
    queryMock.mockResolvedValueOnce(strapiHit("strapi-fallback"))
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const { resolveWatchPage } = await import("./content")
      const result = await resolveWatchPage("en", "christmas")

      // Strapi mock was called, admin mock was not.
      expect(queryMock).toHaveBeenCalledTimes(1)
      expect(adminQueryMock).not.toHaveBeenCalled()

      // User got the Strapi response — fallback is transparent for this request.
      expect(result.error).toBeNull()
      expect(result.data).toMatchObject({
        kind: "experience",
        experience: { documentId: "strapi-fallback" },
      })

      // forge.parity.consumer_bearer_missing event was logged.
      const bearerMissingCall = logSpy.mock.calls.find((call) => {
        const arg = call[0]
        return (
          typeof arg === "string" &&
          arg.includes("forge.parity.consumer_bearer_missing")
        )
      })
      expect(bearerMissingCall).toBeDefined()
    } finally {
      logSpy.mockRestore()
    }
  })

  // -------------------------------------------------------------------------
  // unstable_cache re-throw — load-bearing for UB7 error boundary
  // -------------------------------------------------------------------------

  it("unstable_cache callback re-throws WatchPageAdminError past the cache wrapper", async () => {
    modeRef.current = "admin"
    adminQueryMock.mockResolvedValueOnce({
      data: { experienceBySlug: null },
    })

    const { resolveWatchPage, WatchPageAdminError } = await import("./content")

    // The cache wrapper's catch block must detect WatchPageAdminError
    // and re-throw — NOT convert to the `{ data, error }` sentinel.
    // resolveWatchPage's promise rejects, doesn't resolve.
    await expect(resolveWatchPage("en", "christmas")).rejects.toBeInstanceOf(
      WatchPageAdminError,
    )
  })

  it("unstable_cache callback returns sentinel for generic Errors (strapi-mode path unchanged)", async () => {
    modeRef.current = "strapi"
    queryMock.mockRejectedValueOnce(new Error("strapi 503"))

    const { resolveWatchPage } = await import("./content")
    // Strapi-mode error keeps the sentinel path — resolves with `{ data: null, error }`.
    const result = await resolveWatchPage("en", "christmas")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("strapi 503")
  })

  // -------------------------------------------------------------------------
  // Integration — error propagation chain through the cache wrapper
  // -------------------------------------------------------------------------

  it("integration: admin throw propagates through resolveWatchPage to the caller", async () => {
    modeRef.current = "admin"
    const apolloError = Object.assign(new Error("admin 500"), {
      name: "ApolloError",
      networkError: new Error("server error"),
    })
    adminQueryMock.mockRejectedValueOnce(apolloError)

    const { resolveWatchPage, WatchPageAdminError } = await import("./content")

    let thrown: unknown
    try {
      await resolveWatchPage("en", "christmas")
    } catch (err) {
      thrown = err
    }

    // The full chain: fetchSlugExperience throws → resolveSlugPage
    // re-throws → unstable_cache re-throws (load-bearing) →
    // resolveWatchPage's outer `cache()` re-throws → caller catches.
    expect(thrown).toBeInstanceOf(WatchPageAdminError)
    expect((thrown as InstanceType<typeof WatchPageAdminError>).code).toBe(
      "UNAVAILABLE",
    )
    // Original Apollo error preserved through the chain via `cause`.
    expect((thrown as InstanceType<typeof WatchPageAdminError>).cause).toBe(
      apolloError,
    )
  })
})
