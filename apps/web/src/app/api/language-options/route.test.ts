/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const languageCatalog = vi.hoisted(() => ({
  getSearchLanguageCatalogOptions: vi.fn(),
  projectGlobalLanguageOptions: vi.fn(),
}))

vi.mock("@/lib/search-language-actions", () => ({
  getSearchLanguageCatalogOptions:
    languageCatalog.getSearchLanguageCatalogOptions,
}))

vi.mock("@/lib/watch-language-switcher", () => ({
  projectGlobalLanguageOptions: languageCatalog.projectGlobalLanguageOptions,
}))

import { GET } from "./route"

describe("GET /watch/api/language-options", () => {
  beforeEach(() => {
    languageCatalog.getSearchLanguageCatalogOptions.mockReset()
    languageCatalog.projectGlobalLanguageOptions.mockReset()
    vi.restoreAllMocks()
  })

  it("returns the compact global language catalog without browser caching", async () => {
    const searchOptions = [{ publicSlug: "english", englishName: "English" }]
    const options = [
      { slug: "english", englishName: "English", nativeName: null },
    ]
    languageCatalog.getSearchLanguageCatalogOptions.mockResolvedValue(
      searchOptions,
    )
    languageCatalog.projectGlobalLanguageOptions.mockReturnValue(options)

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ options })
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(languageCatalog.projectGlobalLanguageOptions).toHaveBeenCalledWith(
      searchOptions,
    )
  })

  it("returns a safe retryable failure when the catalog cannot load", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    languageCatalog.getSearchLanguageCatalogOptions.mockRejectedValue(
      new Error("Admin bearer token leaked here"),
    )

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Language options are temporarily unavailable.",
    })
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(consoleError).toHaveBeenCalledWith(
      "[watch] event=global_language_options.fetch.failed",
    )
  })
})
