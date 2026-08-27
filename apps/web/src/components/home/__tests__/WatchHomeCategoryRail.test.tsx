/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

import enMessages from "../../../../messages/en.json"
import { WATCH_HOME_CATEGORIES } from "@/lib/watch-home-categories"

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ children }: { children: ReactNode }) => (
    <div data-testid="carousel">{children}</div>
  ),
  CarouselContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CarouselItem: ({
    children,
    ...props
  }: {
    children?: ReactNode
    [key: string]: unknown
  }) => <div {...props}>{children}</div>,
  CarouselNext: () => <button type="button">next</button>,
  CarouselPrevious: () => <button type="button">previous</button>,
}))

const { WatchHomeCategoryRail } =
  await import("@/components/home/WatchHomeCategoryRail")

type RailTileInput = Parameters<
  typeof WatchHomeCategoryRail
>[0]["tiles"] extends readonly (infer T)[] | null | undefined
  ? T
  : never

function render(
  languageSlug: string,
  categoryIds?: readonly string[] | null,
  tiles?: readonly RailTileInput[] | null,
) {
  const markup = renderToStaticMarkup(
    <WatchHomeCategoryRail
      languageSlug={languageSlug}
      categoryIds={categoryIds}
      tiles={tiles}
    />,
  )
  const container = document.createElement("div")
  container.innerHTML = markup
  return container
}

function card(container: HTMLElement, key: string) {
  return container.querySelector(
    `[data-testid="watch-home-category-card-${key}"]`,
  )
}

describe("WatchHomeCategoryRail", () => {
  it("renders one card per configured category", () => {
    const container = render("english")
    const cards = container.querySelectorAll(
      '[data-testid^="watch-home-category-card-"]',
    )
    expect(cards).toHaveLength(WATCH_HOME_CATEGORIES.length)
  })

  it("renders an authored subset once in its authored order", () => {
    const container = render("english", [
      "family",
      "jesus",
      "family",
      "not-a-category",
      "easter",
    ])

    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid^="watch-home-category-card-"]',
        ),
      ).map((card) => card.getAttribute("data-testid")),
    ).toEqual([
      "watch-home-category-card-family",
      "watch-home-category-card-jesus",
      "watch-home-category-card-easter",
    ])
  })

  it("renders no section when an authored selection has no valid ids", () => {
    expect(render("english", ["unknown", "still-unknown"]).innerHTML).toBe("")
    expect(render("english", []).innerHTML).toBe("")
    expect(render("english", null).innerHTML).toBe("")
  })

  it("links each card to its collection page on the language-less English route", () => {
    const container = render("english")
    for (const category of WATCH_HOME_CATEGORIES) {
      const card = container.querySelector(
        `[data-testid="watch-home-category-card-${category.id}"]`,
      )
      expect(card, category.id).not.toBeNull()
      expect(card?.getAttribute("href"), category.id).toBe(
        `/${category.slug}.html`,
      )
    }
  })

  it("carries the audio language into hrefs for non-English visitors", () => {
    const container = render("spanish-latin-american")
    const card = container.querySelector(
      '[data-testid="watch-home-category-card-easter"]',
    )
    expect(card?.getAttribute("href")).toBe(
      "/easter.html/spanish-latin-american.html",
    )
  })

  it("renders the localized category title on every card", () => {
    const container = render("english")
    const titles = enMessages.WatchHomeCategories.categories as Record<
      string,
      string
    >
    for (const category of WATCH_HOME_CATEGORIES) {
      const card = container.querySelector(
        `[data-testid="watch-home-category-card-${category.id}"]`,
      )
      expect(card?.textContent, category.id).toContain(
        titles[category.titleKey],
      )
    }
  })

  it("renders nothing when the audio language slug is unusable", () => {
    // A slug that fails the LocaleSlug shape can reach the homepage only
    // through a malformed route param; an empty rail beats broken hrefs.
    expect(render("Not A Slug").innerHTML).toBe("")
  })

  it("links the heading CTA to the full collection inventory for the visitor's language", () => {
    expect(
      render("english")
        .querySelector('[data-testid="watch-home-category-see-all"]')
        ?.getAttribute("href"),
    ).toBe("/english.html/videos")
    expect(
      render("spanish-latin-american")
        .querySelector('[data-testid="watch-home-category-see-all"]')
        ?.getAttribute("href"),
    ).toBe("/spanish-latin-american.html/videos")
  })

  it("stacks the header copy and CTA on mobile without changing the desktop arrangement", () => {
    const container = render("english")
    const heading = container.querySelector("#watch-home-category-rail-title")
    const header = heading?.parentElement
    const description = Array.from(header?.querySelectorAll("p") ?? []).find(
      (paragraph) =>
        paragraph.textContent === enMessages.WatchHomeCategories.description,
    )
    const cta = container.querySelector(
      '[data-testid="watch-home-category-see-all"]',
    )

    expect(header?.className).toContain("grid-cols-1")
    expect(header?.className).toContain("md:grid-cols-[minmax(0,1fr)_auto]")
    expect(description?.className).toContain("row-start-3")
    expect(cta?.className).toContain("col-start-1")
    expect(cta?.className).toContain("row-start-4")
    expect(cta?.className).toContain("md:col-start-2")
    expect(cta?.className).toContain("md:row-start-1")
    expect(cta?.className).toContain("md:row-end-3")
  })

  it("fades every card icon as one layer so crossing strokes stay solid", () => {
    const container = render("english")
    for (const category of WATCH_HOME_CATEGORIES) {
      const icon = container
        .querySelector(
          `[data-testid="watch-home-category-card-${category.id}"]`,
        )
        ?.querySelector("svg")
      // A per-stroke alpha (text-white/25) doubles up where two lucide paths
      // cross and the overlap shows through; element opacity over a
      // full-strength stroke composites the icon once.
      expect(icon?.getAttribute("class"), category.id).toContain("opacity-25")
      expect(icon?.getAttribute("class"), category.id).not.toContain(
        "text-white/",
      )
    }
  })

  it("puts a grain layer on every tile, behind the card's own title", () => {
    const container = render("english")
    const grains = container.querySelectorAll(
      '[data-testid="watch-home-category-grain"]',
    )
    expect(grains).toHaveLength(WATCH_HOME_CATEGORIES.length)
    for (const grain of grains) {
      // Grain is decorative and must never intercept the card's click.
      expect(grain.className).toContain("pointer-events-none")
    }
  })

  it("labels the rail with its own heading for assistive tech", () => {
    const container = render("english")
    const section = container.querySelector(
      '[data-testid="watch-home-category-rail"]',
    )
    const headingId = section?.getAttribute("aria-labelledby")
    expect(headingId).toBe("watch-home-category-rail-title")
    expect(container.querySelector(`#${headingId}`)?.textContent).toBe(
      enMessages.WatchHomeCategories.title,
    )
  })
})

describe("WATCH_HOME_CATEGORIES config", () => {
  it("covers the shared catalog exactly once in its shared order", () => {
    expect(WATCH_HOME_CATEGORIES.map(({ id }) => id)).toEqual(
      WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id),
    )
  })

  it("uses unique ids and unique collection slugs", () => {
    const ids = WATCH_HOME_CATEGORIES.map((category) => category.id)
    const slugs = WATCH_HOME_CATEGORIES.map((category) => category.slug)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("uses slugs that satisfy the watch content-slug shape", () => {
    for (const category of WATCH_HOME_CATEGORIES) {
      expect(category.slug, category.id).toMatch(/^[a-z0-9_-]+$/)
    }
  })

  it("opens with the evergreen cards and ends with the seasonal ones", () => {
    const ids = WATCH_HOME_CATEGORIES.map((category) => category.id)
    expect(ids.slice(0, 3)).toEqual(["jesus", "gospels", "short-videos"])
    expect(ids.slice(-2)).toEqual(["easter", "christmas"])
  })

  describe("authored tiles", () => {
    it("renders tiles instead of categoryIds when both are supplied", () => {
      const container = render(
        "english",
        ["jesus", "family"],
        [{ id: "t1", categoryId: "easter" }],
      )

      expect(
        Array.from(
          container.querySelectorAll(
            '[data-testid^="watch-home-category-card-"]',
          ),
        ).map((element) => element.getAttribute("data-testid")),
      ).toEqual(["watch-home-category-card-t1"])
    })

    it("renders an authored title literally and skips the message catalog", () => {
      const container = render("english", null, [
        { id: "t1", categoryId: "jesus", title: "Meet Jesus" },
      ])
      const titles = enMessages.WatchHomeCategories.categories as Record<
        string,
        string
      >

      expect(card(container, "t1")?.textContent).toContain("Meet Jesus")
      expect(card(container, "t1")?.textContent).not.toContain(titles.jesus)
    })

    it("keeps the localized title on a tile that overrides only its colours", () => {
      const container = render("english", null, [
        { id: "t1", categoryId: "jesus", style: "forest", icon: "star" },
      ])
      const titles = enMessages.WatchHomeCategories.categories as Record<
        string,
        string
      >

      expect(card(container, "t1")?.textContent).toContain(titles.jesus)
      expect(card(container, "t1")?.getAttribute("style")).toContain("#16a34a")
    })

    it("renders an external destination as a plain anchor with noopener noreferrer", () => {
      // A `next/link` would try to client-route off-site, and a new tab
      // without `noopener` hands the opener reference to a third party.
      const container = render("english", null, [
        { id: "t1", title: "Give", href: "https://example.org/give" },
      ])
      const element = card(container, "t1")

      expect(element?.getAttribute("href")).toBe("https://example.org/give")
      expect(element?.getAttribute("target")).toBe("_blank")
      expect(element?.getAttribute("rel")).toBe("noopener noreferrer")
    })

    it("renders an internal destination without target or rel", () => {
      const element = card(
        render("english", null, [
          { id: "t1", title: "Partners", href: "/partners" },
        ]),
        "t1",
      )

      expect(element?.getAttribute("href")).toBe("/partners")
      expect(element?.getAttribute("target")).toBeNull()
      expect(element?.getAttribute("rel")).toBeNull()
    })

    it("never emits an unsafe destination into an href", () => {
      for (const href of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//evil.example/watch",
        "http://example.org",
      ]) {
        const container = render(
          "english",
          ["jesus"],
          [{ id: "t1", title: "Bad", href }],
        )
        expect(container.innerHTML, href).toBe("")
      }
    })

    it("mixes predefined and custom tiles in authored order", () => {
      const container = render("english", null, [
        { id: "c1", title: "Give", href: "/give" },
        { id: "t-jesus", categoryId: "jesus" },
        { id: "c2", title: "Pray", href: "https://example.org/pray" },
      ])

      expect(
        Array.from(
          container.querySelectorAll(
            '[data-testid^="watch-home-category-card-"]',
          ),
        ).map((element) => element.getAttribute("data-testid")),
      ).toEqual([
        "watch-home-category-card-c1",
        "watch-home-category-card-t-jesus",
        "watch-home-category-card-c2",
      ])
    })

    it("renders no section when every authored tile is unrenderable", () => {
      expect(
        render("english", null, [{ id: "t1", href: "/no-title" }]).innerHTML,
      ).toBe("")
    })
  })

  it("has an en.json title for every category and no orphan titles", () => {
    const titles = Object.keys(enMessages.WatchHomeCategories.categories)
    const configured = WATCH_HOME_CATEGORIES.map(
      (category) => category.titleKey,
    )
    expect([...configured].sort()).toEqual([...titles].sort())
  })
})
