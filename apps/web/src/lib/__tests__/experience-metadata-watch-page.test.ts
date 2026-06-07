import { describe, expect, it, vi } from "vitest"

const { resolveWatchPageMock } = vi.hoisted(() => ({
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/content", () => ({
  experienceToMetadata: vi.fn(() => null),
  resolveWatchPage: resolveWatchPageMock,
}))

import { getWatchPageMetadata } from "@/lib/experience-metadata"

describe("getWatchPageMetadata", () => {
  it("uses the public www host for the watch home canonical and OG URL", async () => {
    resolveWatchPageMock.mockResolvedValueOnce({ data: null, error: null })

    const meta = await getWatchPageMetadata("en")

    expect(meta.alternates?.canonical).toBe("https://www.jesusfilm.org/watch")
    expect(meta.openGraph?.url).toBe("https://www.jesusfilm.org/watch")
  })

  it("uses the public www host for inner watch page canonical and OG URL", async () => {
    resolveWatchPageMock.mockResolvedValueOnce({ data: null, error: null })

    const meta = await getWatchPageMetadata("en", {
      slug: "jesus",
      pathLocale: "english",
    })

    expect(meta.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus.html/english.html",
    )
    expect(meta.openGraph?.url).toBe(
      "https://www.jesusfilm.org/watch/jesus.html/english.html",
    )
  })
})
