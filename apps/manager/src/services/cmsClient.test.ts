import { afterEach, describe, expect, it, vi } from "vitest"

describe("cmsClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it("fails before the request now that the CMS client is removed", async () => {
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
})
