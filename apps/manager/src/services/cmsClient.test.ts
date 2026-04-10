import { afterEach, describe, expect, it, vi } from "vitest"

describe("cmsClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it("fails before the request when override scope has no internal token", async () => {
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("STRAPI_INTERNAL_API_TOKEN", "")

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { cmsPost, CmsConfigurationError } = await import("./cmsClient")

    await expect(
      cmsPost(
        "/embedding/index",
        { mode: "override" },
        {
          tokenScope: "embedding_override",
        },
      ),
    ).rejects.toBeInstanceOf(CmsConfigurationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails before the request when sync scope has neither sync nor internal token", async () => {
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("STRAPI_INTERNAL_API_TOKEN", "")

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { cmsPost, CmsConfigurationError } = await import("./cmsClient")

    await expect(
      cmsPost(
        "/embedding/index",
        { mode: "if_missing" },
        {
          tokenScope: "embedding_sync",
        },
      ),
    ).rejects.toBeInstanceOf(CmsConfigurationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
