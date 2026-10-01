import { describe, expect, it } from "vitest"
import {
  selectWatchHomeHeroManifest,
  type WatchHomeHeroManifestCatalog,
} from "./watch-home-hero-manifest"

const catalog: WatchHomeHeroManifestCatalog = {
  manifest: {
    surface: "watch-home",
    block: "hero",
    presentation: "hero-card",
    placement: "home-hero",
    policyVersion: "watch-exposure-v2",
    sourceVersion: "0".repeat(64),
    expiresAt: "2026-10-01T00:00:00.000Z",
  },
  items: [
    ["/watch/jesus.html", "x".repeat(43)],
    ["/watch/birth.html", "y".repeat(43)],
  ],
}

describe("pure active hero authority selection", () => {
  it("selects only the active known path as slot zero, retaining the shared origin header", () => {
    const before = JSON.stringify(catalog)
    const selected = selectWatchHomeHeroManifest(
      catalog,
      "/birth.html?t=12&autoplay=1#details",
    )
    expect(selected).toEqual({
      manifest: {
        ...catalog.manifest,
        items: [{ position: 0, itemPath: "/watch/birth.html" }],
      },
      signature: catalog.items[1][1],
    })
    expect(
      selectWatchHomeHeroManifest(
        catalog,
        "https://www.jesusfilm.org/watch/birth.html?autoplay=1",
      ),
    ).toEqual(selected)
    expect(JSON.stringify(catalog)).toBe(before)
  })
  it("does not invent authority for missing, foreign, invalid or navigation-relative paths", () => {
    for (const href of [
      null,
      undefined,
      "",
      "/other.html",
      "https://other.example/watch/birth.html",
      "watch/birth.html",
      "https:watch/birth.html",
      "/videos",
    ])
      expect(selectWatchHomeHeroManifest(catalog, href)).toBeNull()
    expect(selectWatchHomeHeroManifest(null, "/birth.html")).toBeNull()
    expect(selectWatchHomeHeroManifest(undefined, "/birth.html")).toBeNull()
  })
  it("selects a late entry from a catalogue larger than the delivery slate", () => {
    const large = {
      ...catalog,
      items: Array.from(
        { length: 1000 },
        (_, index) =>
          [`/watch/synthetic-${index}.html`, "x".repeat(43)] as const,
      ),
    }
    expect(
      selectWatchHomeHeroManifest(large, "/synthetic-999.html")?.manifest.items,
    ).toEqual([{ position: 0, itemPath: "/watch/synthetic-999.html" }])
  })
})
