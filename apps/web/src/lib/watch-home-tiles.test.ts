import { describe, expect, it } from "vitest"

import { tryAsLocaleSlug } from "@/lib/routes"
import { WATCH_HOME_CATEGORIES } from "@/lib/watch-home-categories"
import {
  resolveWatchHomeTiles,
  type WatchHomeRailTileInput,
} from "@/lib/watch-home-tiles"

const english = tryAsLocaleSlug("english")!
const spanish = tryAsLocaleSlug("spanish")!

function resolve(
  tiles: readonly WatchHomeRailTileInput[] | null | undefined,
  categoryIds?: readonly string[] | null,
  locale = english,
) {
  return resolveWatchHomeTiles({ tiles, categoryIds, locale })
}

const JESUS = WATCH_HOME_CATEGORIES.find((c) => c.id === "jesus")!

describe("resolveWatchHomeTiles — legacy categoryIds path", () => {
  it("reads categoryIds when tiles is absent", () => {
    expect(resolve(null, ["jesus", "family"]).map((c) => c.key)).toEqual([
      "jesus",
      "family",
    ])
  })

  it("reads categoryIds when tiles is present but empty", () => {
    // An empty array is what a serializer produces for "no tiles", not an
    // instruction to render nothing.
    expect(resolve([], ["jesus"]).map((c) => c.key)).toEqual(["jesus"])
  })

  it("drops duplicates and unknown ids, preserving authored order", () => {
    expect(
      resolve(null, ["family", "jesus", "family", "not-a-category"]).map(
        (c) => c.key,
      ),
    ).toEqual(["family", "jesus"])
  })

  it("keeps every category on its localized title and catalog gradient", () => {
    const [card] = resolve(null, ["jesus"])
    expect(card.titleKey).toBe(JESUS.titleKey)
    expect(card.title).toBeNull()
    expect(card.gradient).toBe(JESUS.gradient)
    expect(card.iconKey).toBe("film")
    expect(card.external).toBe(false)
  })

  it("builds the default destination from the request locale", () => {
    expect(resolve(null, ["jesus"], english)[0].href).not.toBe(
      resolve(null, ["jesus"], spanish)[0].href,
    )
    expect(resolve(null, ["jesus"], spanish)[0].href).toContain("spanish")
  })
})

describe("resolveWatchHomeTiles — authored tiles", () => {
  it("prefers tiles over categoryIds when both are present", () => {
    expect(
      resolve(
        [{ id: "custom-1", title: "Give", href: "/give" }],
        ["jesus", "family"],
      ).map((c) => c.key),
    ).toEqual(["custom-1"])
  })

  it("renders a predefined tile unchanged when it carries no overrides", () => {
    const [card] = resolve([{ id: "t1", categoryId: "jesus" }])
    expect(card).toMatchObject({
      key: "t1",
      titleKey: JESUS.titleKey,
      title: null,
      gradient: JESUS.gradient,
      iconKey: "film",
      external: false,
    })
  })

  it("an authored title opts the tile out of localization", () => {
    const [card] = resolve([
      { id: "t1", categoryId: "jesus", title: "Meet Jesus" },
    ])
    expect(card.title).toBe("Meet Jesus")
    expect(card.titleKey).toBeNull()
  })

  it("applies icon and style overrides on a predefined tile", () => {
    const [card] = resolve([
      { id: "t1", categoryId: "jesus", icon: "star", style: "forest" },
    ])
    expect(card.iconKey).toBe("star")
    expect(card.gradient).toBe(
      "linear-gradient(135deg, #16a34a 0%, #14532d 100%)",
    )
  })

  it("uses an authored href verbatim instead of the locale-aware default", () => {
    // Admin has no locale context when the operator types a destination, so
    // rewriting it would be guessing.
    expect(
      resolve(
        [{ id: "t1", categoryId: "jesus", href: "/watch/other.html" }],
        null,
        spanish,
      )[0].href,
    ).toBe("/watch/other.html")
  })

  it("marks an https destination external and a path internal", () => {
    expect(
      resolve([
        { id: "t1", title: "Give", href: "https://example.org/give" },
      ])[0].external,
    ).toBe(true)
    expect(
      resolve([{ id: "t1", title: "Give", href: "/give" }])[0].external,
    ).toBe(false)
  })

  it("gives a fully custom tile the default icon and style", () => {
    const [card] = resolve([{ id: "t1", title: "Give", href: "/give" }])
    expect(card.iconKey).toBe("sparkles")
    expect(card.gradient).toBe(
      "linear-gradient(135deg, #64748b 0%, #334155 100%)",
    )
  })
})

describe("resolveWatchHomeTiles — defensive drops", () => {
  it("drops a custom tile with no title, which has no catalog copy to fall back on", () => {
    expect(resolve([{ id: "t1", href: "/give" }])).toEqual([])
  })

  it("drops a custom tile with no destination", () => {
    expect(resolve([{ id: "t1", title: "Give" }])).toEqual([])
  })

  // Re-checked at render even though admin validated on write: persisted
  // block JSON outlives any one validator and this value lands in an href.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/watch",
    "http://example.org",
    "not-a-url",
  ])("drops a tile whose authored destination is %j", (href) => {
    expect(resolve([{ id: "t1", title: "Give", href }])).toEqual([])
  })

  it("drops the tile rather than falling back to the category default when the override is unsafe", () => {
    // Silently substituting the catalog destination would send viewers
    // somewhere the operator never chose.
    expect(
      resolve([{ id: "t1", categoryId: "jesus", href: "javascript:alert(1)" }]),
    ).toEqual([])
  })

  it("demotes an unknown category reference to a custom tile, keeping it only if it stands alone", () => {
    expect(
      resolve([
        { id: "t1", categoryId: "retired", title: "Legacy", href: "/x" },
      ]).length,
    ).toBe(1)
    expect(resolve([{ id: "t1", categoryId: "retired" }])).toEqual([])
  })

  it("falls back to a known icon key rather than rendering no glyph", () => {
    expect(
      resolve([{ id: "t1", categoryId: "jesus", icon: "rocket" }])[0].iconKey,
    ).toBe("film")
    expect(
      resolve([{ id: "t1", title: "Give", href: "/give", icon: "rocket" }])[0]
        .iconKey,
    ).toBe("sparkles")
  })

  it("falls back to the default gradient for an unknown style key", () => {
    expect(
      resolve([
        { id: "t1", title: "Give", href: "/give", style: "chartreuse" },
      ])[0].gradient,
    ).toBe("linear-gradient(135deg, #64748b 0%, #334155 100%)")
  })

  it("drops duplicate tile keys", () => {
    expect(
      resolve([
        { id: "t1", title: "A", href: "/a" },
        { id: "t1", title: "B", href: "/b" },
      ]).map((c) => c.title),
    ).toEqual(["A"])
  })

  it("keys unidentified tiles by position so two of them do not collapse", () => {
    expect(
      resolve([
        { title: "A", href: "/a" },
        { title: "B", href: "/b" },
      ]).map((c) => c.key),
    ).toEqual(["tile-0", "tile-1"])
  })

  it("treats blank strings as absent overrides", () => {
    const [card] = resolve([
      { id: "t1", categoryId: "jesus", title: "  ", href: "", icon: " " },
    ])
    expect(card.titleKey).toBe(JESUS.titleKey)
    expect(card.href).toContain("jesus")
    expect(card.iconKey).toBe("film")
  })

  it("returns nothing when neither shape is present", () => {
    expect(resolve(null, null)).toEqual([])
  })
})
