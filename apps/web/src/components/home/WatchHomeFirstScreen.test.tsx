import { describe, expect, it } from "vitest"

import { watchHomeLanguageName } from "./WatchHomeFirstScreen"

describe("watchHomeLanguageName", () => {
  it("names the root English home in its chrome language", () => {
    expect(watchHomeLanguageName("english", "en")).toBe("English")
  })

  it("names the content language when the chrome falls back to English", () => {
    // `arabic-najdi` ships no UI catalog, so its chrome renders English while
    // its videos are Najdi Arabic. The heading must follow the videos.
    expect(watchHomeLanguageName("arabic-najdi", "en")).toBe("Najdi Arabic")
  })

  it("localizes the content language name into a translated chrome", () => {
    expect(watchHomeLanguageName("spanish-latin-american", "es")).toBe(
      "español latinoamericano",
    )
  })

  it("falls back to the title-cased slug for a tag that is not BCP-47", () => {
    // The generated map carries `hainanese` → `nan-CN-46`, which
    // `Intl.Locale` rejects; announcing the English chrome would be wrong.
    expect(watchHomeLanguageName("hainanese", "en")).toBe("Hainanese")
  })

  it("never announces the chrome language for an unmapped slug", () => {
    expect(watchHomeLanguageName("newly-published-language", "es")).toBe(
      "Newly Published Language",
    )
  })
})
