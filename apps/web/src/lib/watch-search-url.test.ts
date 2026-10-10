/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest"

import { readWatchSearchUrl, writeWatchSearchUrl } from "./watch-search-url"

describe("watch search URL state", () => {
  it("reads submitted query and language, ignoring empty drafts", () => {
    expect(readWatchSearchUrl("?q=%20hope%20&lang=spanish")).toEqual({
      query: "hope",
      languageSlug: "spanish",
    })
    expect(readWatchSearchUrl("?q=%20")).toBeNull()
  })

  it("preserves unrelated URL state and removes only search parameters", () => {
    window.history.replaceState(null, "", "/watch?tab=latest#results")
    const push = vi.spyOn(window.history, "pushState")
    writeWatchSearchUrl("push", "hope", "spanish")
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      "/watch?tab=latest&q=hope&lang=spanish#results",
    )
    window.history.replaceState(
      null,
      "",
      "/watch?tab=latest&q=hope&lang=spanish#results",
    )
    writeWatchSearchUrl("replace", "", null)
    expect(window.location.href).toContain("/watch?tab=latest#results")
    push.mockRestore()
  })

  it("writes canonical language slugs with replace semantics and skips duplicates", () => {
    window.history.replaceState(null, "", "/watch?q=hope&lang=spanish")
    const replace = vi.spyOn(window.history, "replaceState")

    writeWatchSearchUrl("replace", "hope", "english")
    expect(replace).toHaveBeenCalledWith(null, "", "/watch?q=hope&lang=english")
    writeWatchSearchUrl("replace", "hope", "english")
    expect(replace).toHaveBeenCalledTimes(1)

    writeWatchSearchUrl("replace", "hope", null)
    expect(window.location.search).toBe("?q=hope")
    writeWatchSearchUrl("replace", "", null)
    expect(window.location.search).toBe("")
  })
})
