import { beforeEach, describe, expect, it, vi } from "vitest"

const requireSession = vi.fn()
const revalidatePath = vi.fn()
const save = vi.fn()
const searchVideoSearchSocialLocales = vi.fn()
const loadVideoSearchSocialLocale = vi.fn()
const loadVideoSearchSocialMediaLibrary = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))
vi.mock("@/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSession(...args),
}))
vi.mock("@/services", () => ({
  createServices: () => ({ videoSearchSocial: { save } }),
}))
vi.mock("./video-search-social-data", () => ({
  searchVideoSearchSocialLocales: (...args: unknown[]) =>
    searchVideoSearchSocialLocales(...args),
  loadVideoSearchSocialLocale: (...args: unknown[]) =>
    loadVideoSearchSocialLocale(...args),
  loadVideoSearchSocialMediaLibrary: (...args: unknown[]) =>
    loadVideoSearchSocialMediaLibrary(...args),
}))

import {
  loadVideoSearchSocialLocaleAction,
  loadVideoSearchSocialMediaLibraryAction,
  saveVideoSearchSocialAction,
  searchVideoSearchSocialLocalesAction,
} from "./video-search-social-actions"

describe("video Search and Social actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSession.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
  })

  it("passes only override copy and managed asset identity to the service", async () => {
    save.mockResolvedValue({
      videoLocaleId: "locale-1",
      videoId: "video-1",
      slug: "jesus",
      locale: "en",
      languageSlug: "english",
      status: "PUBLISHED",
      sourceTitle: "JESUS",
      sourceDescription: "Visible copy",
      searchTitle: "Search copy",
      searchDescription: null,
      socialImageAssetId: "asset-1",
    })

    const result = await saveVideoSearchSocialAction({
      videoLocaleId: "locale-1",
      searchTitle: "Search copy",
      searchDescription: null,
      socialImageAssetId: "asset-1",
    })

    expect(result.ok).toBe(true)
    expect(save).toHaveBeenCalledWith({
      user: { id: "admin-1", role: "ADMIN" },
      input: {
        videoLocaleId: "locale-1",
        searchTitle: "Search copy",
        searchDescription: null,
        socialImageAssetId: "asset-1",
      },
    })
    expect(JSON.stringify(save.mock.calls[0])).not.toContain("previewUrl")
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/videos")
  })

  it("returns an allowlisted error instead of a raw service failure", async () => {
    save.mockRejectedValue(new Error("postgres secret detail"))

    const result = await saveVideoSearchSocialAction({
      videoLocaleId: "locale-1",
      searchTitle: null,
      searchDescription: null,
      socialImageAssetId: null,
    })

    expect(result).toEqual({
      ok: false,
      code: "SAVE_FAILED",
      message: "Search metadata could not be saved. Please try again.",
    })
    expect(JSON.stringify(result)).not.toContain("postgres")
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("projects search and load failures through stable public envelopes", async () => {
    searchVideoSearchSocialLocales.mockRejectedValueOnce(new Error("db"))
    loadVideoSearchSocialLocale.mockRejectedValueOnce(new Error("db"))

    await expect(
      searchVideoSearchSocialLocalesAction({ videoId: "video-1", query: "en" }),
    ).resolves.toMatchObject({ ok: false, code: "LOAD_FAILED" })
    await expect(
      loadVideoSearchSocialLocaleAction({ videoLocaleId: "locale-1" }),
    ).resolves.toMatchObject({ ok: false, code: "LOAD_FAILED" })
  })

  it("loads the managed Media Library only through an authenticated action", async () => {
    loadVideoSearchSocialMediaLibrary.mockResolvedValue({
      rootLabel: "Library",
      folders: [],
      images: [],
    })

    await expect(loadVideoSearchSocialMediaLibraryAction()).resolves.toEqual({
      ok: true,
      data: { rootLabel: "Library", folders: [], images: [] },
    })
    expect(loadVideoSearchSocialMediaLibrary).toHaveBeenCalledWith({
      user: { id: "admin-1", role: "ADMIN" },
    })
  })
})
