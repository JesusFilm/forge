import { describe, expect, it } from "vitest"

import { searchLanguageOptionsCacheKey } from "./search-language-cache"

describe("searchLanguageOptionsCacheKey", () => {
  it("keeps response caches separate for each UI locale", () => {
    expect(searchLanguageOptionsCacheKey(undefined, "en")).not.toBe(
      searchLanguageOptionsCacheKey(undefined, "ar"),
    )
    expect(searchLanguageOptionsCacheKey({ English: 3 }, "en")).not.toBe(
      searchLanguageOptionsCacheKey({ English: 3 }, "ar"),
    )
  })
})
