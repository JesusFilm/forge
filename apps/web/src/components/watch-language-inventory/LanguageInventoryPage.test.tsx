// @vitest-environment jsdom

import { act } from "react"
import type { Route } from "next"
import { setRequestLocale } from "next-intl/server"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("@/components/ui/carousel", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Carousel: Pass,
    CarouselContent: Pass,
    CarouselItem: Pass,
    CarouselPrevious: ({
      label,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) => (
      <button aria-label={label} {...props} />
    ),
    CarouselNext: ({
      label,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) => (
      <button aria-label={label} {...props} />
    ),
  }
})
vi.mock("./LanguageCollectionSwitcher", () => ({
  LanguageCollectionSwitcher: () => null,
}))

import {
  WATCH_IMMERSIVE_BACKDROP_CLASS,
  WATCH_IMMERSIVE_BACKGROUND_BRIGHTNESS_CLASS,
  WATCH_IMMERSIVE_BACKGROUND_COLOR,
  WATCH_IMMERSIVE_BACKGROUND_SATURATION_CLASS,
  WATCH_LANGUAGE_TAG_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { LanguageInventoryPage } from "./LanguageInventoryPage"
import {
  isNewRelease,
  NEW_RELEASE_WINDOW_DAYS,
} from "@/lib/watch-language-inventory"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

function card(
  id: string,
  title: string,
  href: WatchLanguageInventoryCard["href"],
  parentSlug: string | null = null,
  options: {
    availability?: WatchLanguageInventoryCard["availability"]
    childCount?: number
  } = {},
): WatchLanguageInventoryCard {
  return {
    id,
    coreId: id,
    slug: id,
    title,
    description: null,
    imageUrl: null,
    imageAlt: title,
    muxPlaybackId: null,
    label: "SHORT_FILM",
    availability: options.availability ?? "AUDIO",
    href,
    watchLanguageSlug: "english",
    parentSlug,
    parentTitle: parentSlug ? "Series" : null,
    durationSeconds: 60,
    childCount: options.childCount ?? 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

describe("LanguageInventoryPage video thumbnails", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setRequestLocale("ru")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setRequestLocale("en")
  })

  it("preserves localized labels and routes while adding native English titles", () => {
    const collection = card(
      "series",
      "Коллекция фильмов",
      "/collection.html" as Route,
      null,
      { childCount: 2 },
    )
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "russian",
      languageName: "Russian",
      languageNativeName: "Русский",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 2,
        subtitleOnlyVideos: 2,
        total: 5,
      },
      promoted: [],
      audioCollections: [collection],
      audioVideos: [
        card(
          "compact-linked",
          "Видео в коллекции",
          "/compact.html" as Route,
          "series",
        ),
        card("compact-static", "Статичное видео в коллекции", null, "series"),
      ],
      subtitleOnlyVideos: [
        card(
          "subtitle-linked",
          "Видео только с субтитрами",
          "/linked.html" as Route,
          null,
          { availability: "SUBTITLE_ONLY" },
        ),
        card("subtitle-static", "Статичное видео", null, null, {
          availability: "SUBTITLE_ONLY",
        }),
      ],
      collectionLanguageCounts: {},
    }

    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const linkedFull = container.querySelector<HTMLElement>(
      '[aria-label="Видео только с субтитрами"]',
    )
    const staticFull = container.querySelector<HTMLElement>(
      '[aria-label="Статичное видео"]',
    )
    expect(linkedFull?.className).toContain("group")
    expect(linkedFull?.className).toContain("focus-visible:outline-none")
    expect(
      linkedFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).not.toBeNull()
    expect(linkedFull?.hasAttribute("data-english-assist")).toBe(false)
    expect(linkedFull?.title).toBe("Open video")
    expect(linkedFull?.getAttribute("aria-label")).toBe(
      "Видео только с субтитрами",
    )
    expect(linkedFull?.getAttribute("href")).toBe("/linked.html")
    expect(
      linkedFull?.querySelector<HTMLElement>(
        '[title="Subtitles are available without dubbed audio"]',
      )?.title,
    ).toBe("Subtitles are available without dubbed audio")
    expect(staticFull?.className).not.toContain("group")
    expect(staticFull?.className).not.toContain("focus-visible:outline-none")
    expect(
      staticFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).toBeNull()
    expect(staticFull?.hasAttribute("title")).toBe(false)

    const compactFrames = container.querySelectorAll(
      '[data-testid="language-inventory-compact-thumbnail-frame"]',
    )
    expect(compactFrames).toHaveLength(1)
    const linkedCompact = compactFrames[0]?.closest("a")
    expect(linkedCompact?.className).toContain("group")
    expect(linkedCompact?.className).toContain("focus-visible:outline-none")
    expect(linkedCompact?.hasAttribute("data-english-assist")).toBe(false)
    expect(linkedCompact?.title).toBe("Open video")
    expect(linkedCompact?.getAttribute("href")).toBe("/compact.html")

    const staticCompactTitle = Array.from(
      container.querySelectorAll("span"),
    ).find((element) => element.textContent === "Статичное видео в коллекции")
    const staticCompact = staticCompactTitle?.parentElement?.parentElement
    expect(staticCompact?.tagName).toBe("DIV")
    expect(staticCompact?.className).not.toContain("group")
    expect(staticCompact?.querySelector("svg")).toBeNull()

    const collectionLink = container.querySelector<HTMLAnchorElement>(
      '[href="/collection.html"]',
    )
    expect(collectionLink?.title).toBe("Open collection")
    // The collection CTA wears the shared watch pill — the same solid-white
    // button the single-video page uses for Download/Share — rather than a
    // bespoke amber outline. Pinned so a hand-rolled className can't creep back.
    expect(collectionLink?.getAttribute("data-slot")).toBe("button")
    for (const pillClass of [
      "rounded-full",
      "bg-white",
      "text-black",
      "uppercase",
      "hover:bg-red-500",
    ]) {
      expect(collectionLink?.className).toContain(pillClass)
    }
    expect(collectionLink?.className).not.toContain("bg-amber-200/10")

    // The section-metric carousel and its anchors were removed; the page
    // carries no in-page section navigation. The end-of-page back-to-top link
    // is the one intentional in-document anchor, so exclude it by test id
    // rather than dropping this guard.
    expect(container.querySelector("nav")).toBeNull()
    expect(
      container.querySelector(
        'a[href^="#"]:not([data-testid="language-inventory-back-to-top"])',
      ),
    ).toBeNull()

    expect(
      container.querySelector('[title="Collections with dubbed videos"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[title="Videos with subtitles and no dubbed audio"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelectorAll('[title="Items in this section"]'),
    ).toHaveLength(2)
    expect(
      container.querySelector('[data-testid="english-assist-guide-trigger"]'),
    ).toBeNull()
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
    expect(container.querySelector("[data-english-assist]")).toBeNull()
  })
})

// The language inventory is a synthetic Watch surface, so it owes the same
// typography roles as the single-video page: the shared section-eyebrow rule,
// `font-media-card-title` for card titles, and `tracking-media-label` for card
// labels (docs/solutions/design-patterns/watch-semantic-tailwind-typography-role-tokens.md).
// These pin which semantic utility each role uses — a local `font-bold` /
// `font-black` / arbitrary-tracking regression fails here rather than shipping
// visually-equivalent content with drifted typography.
describe("LanguageInventoryPage typography roles", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderInventory() {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 1,
        total: 3,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [
        card("subtitled", "Subtitled", "/subtitled.html" as Route, null, {
          availability: "SUBTITLE_ONLY",
        }),
      ],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
  }

  it("uses the shared Watch section-eyebrow rule for every section eyebrow", () => {
    renderInventory()

    const eyebrows = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="language-inventory-section-eyebrow"]',
      ),
    )
    expect(eyebrows.length).toBe(2)
    for (const eyebrow of eyebrows) {
      for (const utility of WATCH_SECTION_EYEBROW_CLASS.split(" ")) {
        expect(eyebrow.className).toContain(utility)
      }
      // The amber chip the eyebrow used to wear is gone — the single-video
      // page renders eyebrows as bare text.
      expect(eyebrow.className).not.toContain("bg-white/[0.06]")
      expect(eyebrow.className).not.toContain("text-amber-200")
    }
  })

  it("names the media-card typography roles on titles and labels", () => {
    renderInventory()

    const cardTitles = Array.from(container.querySelectorAll("h3"))
    expect(cardTitles.length).toBeGreaterThan(0)
    for (const title of cardTitles) {
      expect(title.className).toContain("font-media-card-title")
    }

    const compactTitle = container.querySelector<HTMLElement>(
      '[href="/episode.html"] [class*="line-clamp-"]',
    )
    expect(compactTitle?.className).toContain("font-media-card-title")
    // The compact row gets two lines on phones so the 16px phone tier does not
    // clamp a title that fitted on one line at 14px; one line from `sm:` up.
    expect(compactTitle?.className).toContain("line-clamp-2")
    expect(compactTitle?.className).toContain("sm:line-clamp-1")

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[class*="tracking-media-label"]',
      ),
    )
    // Grid-card label, collection-overview label, compact-row metadata.
    expect(labels.length).toBeGreaterThanOrEqual(3)
    for (const label of labels) {
      expect(label.className).toContain("font-medium")
      expect(label.className).toContain("uppercase")
    }
  })

  it("matches the single-video page ramp on the hero title and body copy", () => {
    renderInventory()

    // Mirrors HeroPlayer's <h1> ramp.
    const heading = container.querySelector<HTMLElement>("h1")
    for (const utility of [
      "text-2xl",
      "leading-[1.08]",
      "font-bold",
      "sm:text-4xl",
      "md:text-6xl",
      "xl:text-7xl",
    ]) {
      expect(heading?.className).toContain(utility)
    }

    // Mirrors WatchBody's description rule.
    const heroDescription = heading?.parentElement?.querySelector("p")
    for (const utility of [
      "text-base",
      "leading-relaxed",
      "font-normal",
      "text-stone-200/80",
      "md:text-lg",
    ]) {
      expect(heroDescription?.className).toContain(utility)
    }

    // Mirrors WatchBody's title rule. Scoped to CONTENT-section headings: the
    // filter bar contributes its own <h2> ("Filters") that is an eyebrow, not a
    // section title, so a bare `querySelectorAll("h2")` would sweep it in.
    const sectionHeadings = Array.from(
      container.querySelectorAll("[data-inv-section] h2"),
    )
    expect(sectionHeadings.length).toBeGreaterThan(0)
    for (const sectionHeading of sectionHeadings) {
      for (const utility of [
        "text-lg",
        "leading-[1.08]",
        "font-semibold",
        "text-stone-100",
        "md:text-4xl",
        "xl:text-5xl",
      ]) {
        expect(sectionHeading.className).toContain(utility)
      }
    }
  })

  it("carries no legacy weight or arbitrary-tracking utilities", () => {
    renderInventory()

    expect(container.querySelector('[class*="font-black"]')).toBeNull()
    // `font-bold` survives only where the video page also uses it: the hero
    // <h1>, and the shared pill button (the `pill` cva variant owns that
    // weight, so it is not inventory-local drift).
    const bold = Array.from(
      container.querySelectorAll<HTMLElement>('[class*="font-bold"]'),
    )
    expect(bold.length).toBeGreaterThan(0)
    for (const element of bold) {
      expect(
        element.tagName === "H1" || element.dataset.slot === "button",
      ).toBe(true)
    }
    expect(bold.some((element) => element.tagName === "H1")).toBe(true)
    expect(container.querySelector('[class*="tracking-["]')).toBeNull()
  })
})

// The exact wire shape admin returns for `publishedAt` — a Postgres timestamp
// with a SPACE separator and a bare two-digit offset, sampled from
// admin.jesusfilm.org on 2026-08-27. This is the primary fixture on purpose:
// a clean `2026-07-31T00:00:00Z` fixture passes even when the parser is broken
// for every value production actually sends.
const ADMIN_DATE_ONLY = "2026-07-31 00:00:00+00"
const ADMIN_FULL_PRECISION = "2026-08-03 11:00:41.576+00"

describe("isNewRelease", () => {
  const now = new Date("2026-08-27T12:00:00Z")

  it("parses the timestamp shapes admin actually returns", () => {
    expect(isNewRelease(ADMIN_DATE_ONLY, now)).toBe(true)
    expect(isNewRelease(ADMIN_FULL_PRECISION, now)).toBe(true)
    // Same instants, expressed the ways a future admin change might send them.
    expect(isNewRelease("2026-07-31T00:00:00Z", now)).toBe(true)
    expect(isNewRelease("2026-07-31T00:00:00+00:00", now)).toBe(true)
    // A bare date must survive offset normalization: it ends in `-31`, which a
    // loose offset regex corrupts into `2026-07-31:00` (NaN -> no badge).
    expect(isNewRelease("2026-07-31", now)).toBe(true)
    // Non-UTC offsets are the other shape a Postgres column can emit.
    expect(isNewRelease("2026-07-31 00:00:00-05", now)).toBe(true)
  })

  it("uses a 60-day window", () => {
    // Pinned as a literal: deriving the fixtures below from the constant would
    // make them tautological — they would stay green for any window value.
    expect(NEW_RELEASE_WINDOW_DAYS).toBe(60)
  })

  it("badges inside the window and stops at the boundary", () => {
    // Absolute dates against now = 2026-08-27T12:00Z, so a widened or narrowed
    // window fails here.
    expect(isNewRelease("2026-07-01 00:00:00+00", now)).toBe(true) // 57 days
    expect(isNewRelease("2026-06-20 00:00:00+00", now)).toBe(false) // 68 days
    // Exact boundary, still by absolute date: 60 days before 2026-08-27.
    expect(isNewRelease("2026-06-28T12:00:00Z", now)).toBe(true)
    expect(isNewRelease("2026-06-28T11:59:59Z", now)).toBe(false)
  })

  it("badges a future publish date and fails closed on unusable input", () => {
    // `publishedAt` is date-only at midnight UTC, so a series dated tomorrow is
    // the newest thing in the catalog for a render behind that boundary.
    expect(isNewRelease("2026-08-28 00:00:00+00", now)).toBe(true)
    expect(isNewRelease(null, now)).toBe(false)
    expect(isNewRelease(undefined, now)).toBe(false)
    expect(isNewRelease("", now)).toBe(false)
    expect(isNewRelease("not a date", now)).toBe(false)
  })
})

describe("LanguageInventoryPage new-release badge", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function renderWithCollectionPublishedAt(publishedAt: string | null) {
    const collection = {
      ...card("series", "Series", "/collection.html" as Route, null, {
        childCount: 1,
      }),
      publishedAt,
    }
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [collection],
      audioVideos: [
        {
          ...card("episode", "Episode", "/episode.html" as Route, "series"),
          // Episode dates must NOT drive the badge — the decision is the
          // collection's own publish date.
          publishedAt: "2026-08-26 00:00:00+00",
        },
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    return container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-new-release-badge"]',
    )
  }

  it("shows the badge in the series side panel for a recent collection", () => {
    const badge = renderWithCollectionPublishedAt(ADMIN_DATE_ONLY)
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe("New")
    expect(badge?.title).toBe("Recently added in this language")
    // Lives in the side panel next to the collection label, not on the grid.
    expect(
      badge?.closest('[data-testid="language-inventory-collection-overview"]'),
    ).not.toBeNull()
    // Wears the badge typography role, not a legacy weight.
    expect(badge?.className).toContain("tracking-media-label")
    expect(badge?.className).toContain("font-medium")
    expect(badge?.className).toContain("bg-brand-red")
  })

  it("hides the badge once the collection falls outside the window", () => {
    expect(renderWithCollectionPublishedAt("2026-05-01 00:00:00+00")).toBeNull()
  })

  it("hides the badge when the collection has no publish date", () => {
    expect(renderWithCollectionPublishedAt(null)).toBeNull()
  })
})

describe("LanguageInventoryPage collection ordering", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  type CollectionSpec = { slug: string; publishedAt: string | null }

  // Renders one group per spec, in the order given, and returns the group
  // titles as they end up in the DOM.
  function renderedGroupOrder(
    specs: CollectionSpec[],
    { includeStandalone = false }: { includeStandalone?: boolean } = {},
  ): (string | null)[] {
    const collections = specs.map((spec) => ({
      ...card(spec.slug, spec.slug, "/c.html" as Route, null, {
        childCount: 1,
      }),
      publishedAt: spec.publishedAt,
    }))
    const audioVideos: WatchLanguageInventoryCard[] = specs.map((spec) => ({
      ...card(
        `${spec.slug}-episode`,
        `${spec.slug} episode`,
        "/e.html" as Route,
        spec.slug,
      ),
      parentTitle: spec.slug,
    }))
    if (includeStandalone) {
      audioVideos.push(card("loose", "Loose video", "/loose.html" as Route))
    }
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: collections.length,
        audioVideos: audioVideos.length,
        subtitleOnlyVideos: 0,
        total: collections.length + audioVideos.length,
      },
      promoted: [],
      audioCollections: collections,
      audioVideos,
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="language-inventory-collection-group"]',
      ),
    ).map((group) => group.getAttribute("aria-label"))
  }

  it("orders collections newest release first", () => {
    // Deliberately supplied oldest-first so input order cannot produce a
    // passing result on its own.
    expect(
      renderedGroupOrder([
        { slug: "oldest", publishedAt: "2024-01-15 00:00:00+00" },
        { slug: "middle", publishedAt: "2026-04-23 00:00:00+00" },
        { slug: "newest", publishedAt: "2026-07-31 00:00:00+00" },
      ]),
    ).toEqual(["newest", "middle", "oldest"])
  })

  it("sorts on the production timestamp shape, not just clean ISO", () => {
    // If the sort used raw `Date.parse` on a `T`-normalized string it would see
    // NaN for every value and leave input order untouched.
    expect(
      renderedGroupOrder([
        { slug: "b-older", publishedAt: "2026-01-02 03:04:05.678+00" },
        { slug: "a-newer", publishedAt: "2026-06-02 03:04:05.678+00" },
      ]),
    ).toEqual(["a-newer", "b-older"])
  })

  it("keeps admin's order within one release date", () => {
    const order = renderedGroupOrder([
      { slug: "second-in-admin", publishedAt: "2026-04-23 00:00:00+00" },
      { slug: "first-in-admin", publishedAt: "2026-04-23 00:00:00+00" },
      { slug: "third-in-admin", publishedAt: "2026-04-23 00:00:00+00" },
    ])
    expect(order).toEqual([
      "second-in-admin",
      "first-in-admin",
      "third-in-admin",
    ])
  })

  it("sinks undated collections and the standalone bucket below dated ones", () => {
    const order = renderedGroupOrder(
      [
        { slug: "undated", publishedAt: null },
        { slug: "unparseable", publishedAt: "not a date" },
        { slug: "dated", publishedAt: "2026-07-31 00:00:00+00" },
      ],
      { includeStandalone: true },
    )
    expect(order[0]).toBe("dated")
    expect(order.slice(1)).toHaveLength(3)
    expect(order.slice(1)).toContain("undated")
    expect(order.slice(1)).toContain("unparseable")
  })

  it("leaves an all-undated catalog in admin's order", () => {
    // Deliberately NOT alphabetical: an accidental title tiebreak would
    // reorder this, whereas an alphabetical fixture would hide it.
    const specs: CollectionSpec[] = [
      { slug: "gamma", publishedAt: null },
      { slug: "alpha", publishedAt: "not a date" },
      { slug: "beta", publishedAt: null },
    ]
    expect(renderedGroupOrder(specs)).toEqual(["gamma", "alpha", "beta"])
  })
})

describe("LanguageInventoryPage collection language availability", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(
    collectionLanguageCounts: WatchLanguageInventoryModel["collectionLanguageCounts"],
  ) {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts,
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    const row = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-languages"]',
    )
    return {
      row,
      audio: container.querySelector<HTMLElement>(
        '[data-testid="language-inventory-collection-audio-languages"]',
      ),
      subtitles: container.querySelector<HTMLElement>(
        '[data-testid="language-inventory-collection-subtitle-languages"]',
      ),
    }
  }

  it("shows both counts in the series side panel", () => {
    const { row, audio, subtitles } = render({
      series: { audioLanguageCount: 2267, subtitleLanguageCount: 57 },
    })

    expect(audio?.textContent).toBe("2,267 audio translations")
    expect(subtitles?.textContent).toBe("57 subtitles")
    // Lives in the sidebar, not on the grid cards.
    expect(
      row?.closest('[data-testid="language-inventory-collection-overview"]'),
    ).not.toBeNull()
    // Both icons come through (audio bars + captions glyph).
    expect(audio?.querySelector("svg")).not.toBeNull()
    expect(subtitles?.querySelector("svg")).not.toBeNull()
  })

  it("wears the single-video page's meta-row tag class, not a copy", () => {
    const { audio, subtitles } = render({
      series: { audioLanguageCount: 12, subtitleLanguageCount: 3 },
    })

    // Asserting against the shared constant is the point: a divergent copy of
    // the class string fails here even if it happens to look identical today.
    for (const utility of WATCH_LANGUAGE_TAG_CLASS.split(" ")) {
      expect(audio?.className).toContain(utility)
      expect(subtitles?.className).toContain(utility)
    }
  })

  it("pluralizes a single language", () => {
    const { audio, subtitles } = render({
      series: { audioLanguageCount: 1, subtitleLanguageCount: 1 },
    })

    expect(audio?.textContent).toBe("1 audio translation")
    expect(subtitles?.textContent).toBe("1 subtitle")
  })

  it("drops the half that is zero rather than printing a 0", () => {
    const audioOnly = render({
      series: { audioLanguageCount: 9, subtitleLanguageCount: 0 },
    })
    expect(audioOnly.audio?.textContent).toBe("9 audio translations")
    expect(audioOnly.subtitles).toBeNull()

    const subtitlesOnly = render({
      series: { audioLanguageCount: 0, subtitleLanguageCount: 4 },
    })
    expect(subtitlesOnly.audio).toBeNull()
    expect(subtitlesOnly.subtitles?.textContent).toBe("4 subtitles")
  })

  it("renders nothing when counts are unknown or both zero", () => {
    // Unknown (the degraded path: the counts query failed) must look the same
    // as "no languages" — an absent row, never a 0.
    expect(render({}).row).toBeNull()
    expect(
      render({
        "other-series": { audioLanguageCount: 5, subtitleLanguageCount: 5 },
      }).row,
    ).toBeNull()
    expect(
      render({ series: { audioLanguageCount: 0, subtitleLanguageCount: 0 } })
        .row,
    ).toBeNull()
  })
})

// jsdom has no layout engine, so it cannot reproduce the overflow itself — it
// reports every width as 0. These pin the CLASS CONTRACT that the browser
// measurement proved fixes it (2026-08-27, 1280px viewport and a forced 260px
// column, the narrowest the `minmax(260px,340px)` sidebar track produces):
//   - the sidebar text column must NOT set `items-start`, which gave every
//     child `align-self: flex-start` and let the description resolve to 383px
//     inside a 299px column, spilling over the episode list;
//   - authored multi-line copy must carry `break-words`, because production
//     descriptions hold a 127-character DAM download URL that otherwise lays
//     out one line wider than the column;
//   - the CTA pill inherits `whitespace-nowrap` from `buttonVariants`, so it
//     needs `max-w-full` + wrapping or the longest catalog label spills.
describe("LanguageInventoryPage collection group layout", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("gives the sidebar the shared immersive blurred backdrop", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [
        {
          ...card("series", "Series", "/collection.html" as Route, null, {
            childCount: 1,
          }),
          imageUrl: "https://cdn.test/collection-art.jpg",
        },
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const sidebar = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-sidebar"]',
    )
    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-backdrop"]',
    )

    // Asserting against the SHARED constants is the point: `MediaCollection`
    // reads the same ones, so an authored Experience section and this sidebar
    // cannot drift on blur radius, brightness, saturation, or base colour.
    for (const utility of WATCH_IMMERSIVE_BACKDROP_CLASS.split(" ")) {
      expect(backdrop?.className).toContain(utility)
    }
    expect(backdrop?.className).toContain(
      WATCH_IMMERSIVE_BACKGROUND_BRIGHTNESS_CLASS,
    )
    expect(backdrop?.className).toContain(
      WATCH_IMMERSIVE_BACKGROUND_SATURATION_CLASS,
    )
    // jsdom normalizes an inline hex to `rgb()`, so round-trip the constant
    // through a probe rather than hardcoding the converted value — the
    // assertion still fails if the shared colour changes.
    const probe = document.createElement("div")
    probe.style.backgroundColor = WATCH_IMMERSIVE_BACKGROUND_COLOR
    expect(sidebar?.style.backgroundColor).toBe(probe.style.backgroundColor)
    // Backdrop art must be the collection's own, matching the panel thumbnail.
    expect(backdrop?.style.backgroundImage).toBe(
      'url("https://cdn.test/collection-art.jpg")',
    )
    // The sidebar has to clip and position the absolute layer, and the panel
    // content has to sit above it.
    expect(sidebar?.className).toContain("relative")
    expect(sidebar?.className).toContain("overflow-clip")
    expect(
      container.querySelector(
        '[data-testid="language-inventory-collection-overview"]',
      )?.className,
    ).toContain("z-[1]")
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true")
  })

  it("omits the backdrop when the collection has no artwork", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    // No artwork and no playback id — a backdrop with an empty url() would
    // paint nothing but still stack a filtered layer over the sidebar.
    expect(
      container.querySelector(
        '[data-testid="language-inventory-collection-backdrop"]',
      ),
    ).toBeNull()
  })

  it("gives the sidebar a wider track from xl up", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const group = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-group"]',
    )

    // Browser-measured at a 1280px viewport (2026-08-27): 340px -> 440px, so
    // the collection panel goes from 28% to 37% of the group and its content
    // box from 299px to 399px.
    expect(group?.className).toContain(
      "lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]",
    )
    expect(group?.className).toContain(
      "xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]",
    )
    // The sidebar deliberately holds its 440px maximum while the shared Watch
    // rail gives the episode list any additional wide-screen space.
    expect(group?.className).not.toContain("2xl:grid-cols-")

    const sectionRail = group?.closest("[data-inv-section]")?.firstElementChild
    for (const className of WATCH_PAGE_CONTENT_CLASSES.split(" ")) {
      expect(sectionRail?.className).toContain(className)
    }

    const filterRail = container.querySelector(
      '[data-testid="language-inventory-filters"] > div',
    )
    for (const className of WATCH_PAGE_CONTENT_CLASSES.split(" ")) {
      expect(filterRail?.className).toContain(className)
    }
  })
})

describe("LanguageInventoryPage text overflow contract", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  // A production-shaped description: prose wrapped around the real 127-char
  // DAM collection URL that exposed this.
  const AUTHORED_DESCRIPTION =
    "This series explores the human desire to be known. Download it here: " +
    "https://dam.jesusfilm.org/shared/collections/68d3e085-6a5b-4648-a7d7-d34900316e41/download " +
    "and share it widely."

  function renderInventory() {
    const collection = {
      ...card("series", "Known", "/collection.html" as Route, null, {
        childCount: 1,
      }),
      description: AUTHORED_DESCRIPTION,
    }
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 1,
        total: 3,
      },
      promoted: [],
      audioCollections: [collection],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [
        {
          ...card("subtitled", "Subtitled", "/subtitled.html" as Route, null, {
            availability: "SUBTITLE_ONLY",
          }),
          description: AUTHORED_DESCRIPTION,
        },
      ],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    const overview = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-collection-overview"]',
    )
    return {
      textColumn: overview?.querySelector<HTMLElement>("h3")?.parentElement,
      overviewTitle: overview?.querySelector<HTMLElement>("h3"),
      overviewDescription: overview?.querySelector<HTMLElement>("p"),
      cta: overview?.querySelector<HTMLElement>('a[data-slot="button"]'),
      cardTitle: container.querySelector<HTMLElement>(
        '[data-testid="language-inventory-subtitle-only"] h3',
      ),
      cardDescription: container.querySelector<HTMLElement>(
        '[data-testid="language-inventory-subtitle-only"] h3 + p',
      ),
    }
  }

  it("does not shrink-to-fit the sidebar text column's children", () => {
    const { textColumn } = renderInventory()

    expect(textColumn?.className).toContain("flex-col")
    // The whole bug: `items-start` here let the description size to 383px
    // inside a 299px column.
    expect(textColumn?.className).not.toContain("items-start")
  })

  it("wraps unbreakable tokens in every authored multi-line node", () => {
    const { overviewTitle, overviewDescription, cardTitle, cardDescription } =
      renderInventory()

    for (const node of [
      overviewTitle,
      overviewDescription,
      cardTitle,
      cardDescription,
    ]) {
      expect(node).not.toBeNull()
      expect(node?.className).toContain("break-words")
    }
  })

  it("bounds the CTA pill so a long localized label cannot spill", () => {
    const { cta } = renderInventory()

    // `buttonVariants` sets `whitespace-nowrap`; these three undo it safely.
    expect(cta?.className).toContain("max-w-full")
    expect(cta?.className).toContain("whitespace-normal")
    expect(cta?.className).toContain("break-words")
    // Still hugs its label rather than stretching the column.
    expect(cta?.className).toContain("self-start")
  })
})

describe("LanguageInventoryPage empty sections", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render({
    withDubbed,
    withSubtitles,
  }: {
    withDubbed: boolean
    withSubtitles: boolean
  }) {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: withDubbed ? 1 : 0,
        audioVideos: withDubbed ? 1 : 0,
        subtitleOnlyVideos: withSubtitles ? 1 : 0,
        total: (withDubbed ? 2 : 0) + (withSubtitles ? 1 : 0),
      },
      promoted: [],
      audioCollections: withDubbed
        ? [
            card("series", "Series", "/collection.html" as Route, null, {
              childCount: 1,
            }),
          ]
        : [],
      audioVideos: withDubbed
        ? [card("episode", "Episode", "/episode.html" as Route, "series")]
        : [],
      subtitleOnlyVideos: withSubtitles
        ? [
            card("subtitled", "Subtitled", "/subtitled.html" as Route, null, {
              availability: "SUBTITLE_ONLY",
            }),
          ]
        : [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    const has = (testId: string) =>
      container.querySelector(`[data-testid="${testId}"]`) != null
    return {
      dubbed: has("language-inventory-audio-collections"),
      subtitles: has("language-inventory-subtitle-only"),
      pageEmpty: has("language-inventory-empty"),
      html: container.innerHTML,
    }
  }

  it("drops the subtitles-only section entirely when it has no videos", () => {
    const result = render({ withDubbed: true, withSubtitles: false })

    expect(result.subtitles).toBe(false)
    // Heading, eyebrow, count, and the old "none yet" box all go with it.
    expect(result.html).not.toContain("Subtitles available")
    expect(result.html).not.toContain(
      "No subtitle-only videos are available for this language yet.",
    )
    expect(result.html).not.toContain('href="#subtitles-only"')
    // The populated section is untouched.
    expect(result.dubbed).toBe(true)
    expect(result.pageEmpty).toBe(false)
  })

  it("drops the dubbed catalog when it has no groups", () => {
    const result = render({ withDubbed: false, withSubtitles: true })

    expect(result.dubbed).toBe(false)
    expect(result.html).not.toContain(
      "No fully dubbed videos are available for this language yet.",
    )
    expect(result.subtitles).toBe(true)
    expect(result.pageEmpty).toBe(false)
  })

  it("keeps both sections when both have content", () => {
    const result = render({ withDubbed: true, withSubtitles: true })

    expect(result.dubbed).toBe(true)
    expect(result.subtitles).toBe(true)
    expect(result.pageEmpty).toBe(false)
  })

  it("falls back to one page-level message when everything is empty", () => {
    // Hiding both sections would otherwise leave a bare hero. The route only
    // 404s on an unrecognized language slug, so this state is reachable.
    const result = render({ withDubbed: false, withSubtitles: false })

    expect(result.dubbed).toBe(false)
    expect(result.subtitles).toBe(false)
    expect(result.pageEmpty).toBe(true)
    expect(result.html).toContain(
      "No published videos were found for this language yet.",
    )
  })
})

describe("LanguageInventoryPage episode row index", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderRow() {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    return Array.from(container.querySelectorAll("span")).find(
      (element) =>
        element.textContent === "1" &&
        element.className.includes("tabular-nums"),
    )
  }

  it("sizes the index above body copy and spaces it off the thumbnail", () => {
    const index = renderRow()
    expect(index).toBeDefined()

    // Larger than the 12px it used to be. Browser-measured at 18px on
    // desktop / 16px mobile (2026-08-27).
    expect(index?.className).toContain("text-base")
    expect(index?.className).toContain("sm:text-lg")
    expect(index?.className).not.toContain("text-xs")

    // Its own trailing margin, so the number/thumbnail gap grows without also
    // spreading thumbnail-to-title (the row's `gap-3` is shared by all three).
    expect(index?.className).toContain("mr-1")
    expect(index?.className).toContain("sm:mr-2")

    // `w-10` keeps three digits on one line at the larger size — measured
    // 38px of glyph in a 40px box for "999".
    expect(index?.className).toContain("w-10")
    expect(index?.className).toContain("tabular-nums")
  })
})

describe("LanguageInventoryPage back-to-top", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render({ withSubtitles = true }: { withSubtitles?: boolean } = {}) {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: "English",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: withSubtitles ? 1 : 0,
        total: withSubtitles ? 3 : 2,
      },
      promoted: [],
      audioCollections: [
        card("series", "Series", "/collection.html" as Route, null, {
          childCount: 1,
        }),
      ],
      audioVideos: [
        card("episode", "Episode", "/episode.html" as Route, "series"),
      ],
      subtitleOnlyVideos: withSubtitles
        ? [
            card("subtitled", "Subtitled", "/subtitled.html" as Route, null, {
              availability: "SUBTITLE_ONLY",
            }),
          ]
        : [],
      collectionLanguageCounts: {},
    }
    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })
    return container.querySelector<HTMLAnchorElement>(
      '[data-testid="language-inventory-back-to-top"]',
    )
  }

  it("links to a target that actually exists on the page", () => {
    const link = render()

    expect(link).not.toBeNull()
    const href = link?.getAttribute("href") ?? ""
    expect(href.startsWith("#")).toBe(true)
    // A dangling fragment would leave the link inert, which no style assertion
    // would catch. Browser-verified: from 101,586px down, one click returns
    // scrollY to 0 (2026-08-27).
    const target = container.querySelector(`[id="${href.slice(1)}"]`)
    expect(target).not.toBeNull()
    expect(target?.tagName).toBe("SECTION")
    // It is the FIRST section, i.e. the hero — not some mid-page anchor.
    expect(target).toBe(container.querySelector("section"))
  })

  it("sits after every content section, as the last thing in the page", () => {
    const link = render()
    const main = container.querySelector(
      '[data-testid="language-inventory-page"]',
    )
    const lastSection = container.querySelector(
      '[data-testid="language-inventory-subtitle-only"]',
    )

    expect(main?.contains(link ?? null)).toBe(true)
    expect(main?.lastElementChild?.contains(link ?? null)).toBe(true)
    expect(
      lastSection &&
        link &&
        !!(
          lastSection.compareDocumentPosition(link) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ).toBe(true)
  })

  it("still appears when the trailing section is hidden as empty", () => {
    // The subtitles-only section removes itself when empty; the back-to-top
    // control must not vanish with it.
    expect(render({ withSubtitles: false })).not.toBeNull()
  })

  it("carries localized copy and the shared pill styling", () => {
    const link = render()

    expect(link?.textContent?.trim()).toBe("Back to top")
    expect(link?.getAttribute("data-slot")).toBe("button")
    expect(link?.querySelector("svg")).not.toBeNull()
    for (const utility of [
      "rounded-full",
      "bg-white",
      "text-black",
      "uppercase",
    ]) {
      expect(link?.className).toContain(utility)
    }
  })
})
