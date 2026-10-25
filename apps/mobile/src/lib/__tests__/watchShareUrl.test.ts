import { buildWatchShareUrl } from "../watchShareUrl"

describe("buildWatchShareUrl", () => {
  it("builds the language-qualified watch URL", () => {
    expect(buildWatchShareUrl("birth-of-jesus", "korean")).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html/korean.html",
    )
  })

  it("omits eligible English and preserves collision-owned explicit English", () => {
    expect(buildWatchShareUrl("birth-of-jesus", "english")).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildWatchShareUrl("russian", "english")).toBe(
      "https://www.jesusfilm.org/watch/russian.html/english.html",
    )
  })

  it("defaults a missing language to the canonical English URL", () => {
    expect(buildWatchShareUrl("birth-of-jesus", null)).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildWatchShareUrl("birth-of-jesus", undefined)).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildWatchShareUrl("russian", null)).toBe(
      "https://www.jesusfilm.org/watch/russian.html/english.html",
    )
  })
})
