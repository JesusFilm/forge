import { describe, expect, it } from "vitest"

import {
  WATCH_RUM_PATH_SHAPES,
  watchRumPathShape,
} from "./watch-rum-path-shape"

describe("watchRumPathShape", () => {
  it.each([
    ["https://www.jesusfilm.org/watch", "root"],
    ["https://www.jesusfilm.org/watch/", "root"],
    ["https://www.jesusfilm.org/watch/jesus.html", "one-segment"],
    ["https://www.jesusfilm.org/watch/french.html", "one-segment"],
    [
      "https://www.jesusfilm.org/watch/jesus.html/romanian.html",
      "video-language",
    ],
    [
      "https://www.jesusfilm.org/watch/lumo-john.html/wedding-in-cana.html",
      "episode-implicit-english",
    ],
    [
      "https://www.jesusfilm.org/watch/lumo-john.html/wedding-in-cana/russian.html",
      "episode-language",
    ],
    ["https://www.jesusfilm.org/watch/languages", "languages"],
    [
      "https://www.jesusfilm.org/watch/french.html/languages",
      "localized-languages",
    ],
    ["https://www.jesusfilm.org/watch/history", "history"],
    [
      "https://www.jesusfilm.org/watch/russian.html/history",
      "localized-history",
    ],
    ["https://www.jesusfilm.org/watch/russian.html/videos", "language-videos"],
    ["https://www.jesusfilm.org/watch/search", "search"],
    ["https://www.jesusfilm.org/watch/whats-new", "reserved"],
    ["https://www.jesusfilm.org/watch/api/example", "reserved"],
    ["https://www.jesusfilm.org/watch/jesus/a/b/c", "unknown"],
  ] as const)("maps %s to the closed path shape %s", (url, shape) => {
    expect(watchRumPathShape(url)).toBe(shape)
    expect(WATCH_RUM_PATH_SHAPES).toContain(shape)
  })

  it.each([
    "https://www.jesusfilm.org/watchout/jesus.html",
    "https://www.jesusfilm.org/resources",
    "not an absolute URL",
  ])("ignores non-Watch or invalid URLs: %s", (url) => {
    expect(watchRumPathShape(url)).toBeNull()
  })

  it("does not include slug, locale, query, or fragment values in its result", () => {
    const first = watchRumPathShape(
      "https://www.jesusfilm.org/watch/private-slug.html/french.html?campaign=secret#section",
    )
    const second = watchRumPathShape(
      "https://www.jesusfilm.org/watch/another-film.html/romanian.html?campaign=other",
    )

    expect(first).toBe("video-language")
    expect(second).toBe(first)
    expect(first).not.toContain("private-slug")
    expect(first).not.toContain("french")
  })
})
