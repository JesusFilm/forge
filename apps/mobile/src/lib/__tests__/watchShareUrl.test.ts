import { buildWatchShareUrl } from "../watchShareUrl"

describe("buildWatchShareUrl", () => {
  it("builds the language-qualified watch URL", () => {
    expect(buildWatchShareUrl("birth-of-jesus", "korean")).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html/korean.html",
    )
  })

  it("falls back to the bare watch URL without a language", () => {
    expect(buildWatchShareUrl("birth-of-jesus", null)).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
    expect(buildWatchShareUrl("birth-of-jesus", undefined)).toBe(
      "https://www.jesusfilm.org/watch/birth-of-jesus.html",
    )
  })
})
