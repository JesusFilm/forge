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

function render(languageSlug: string) {
  const markup = renderToStaticMarkup(
    <WatchHomeCategoryRail languageSlug={languageSlug} />,
  )
  const container = document.createElement("div")
  container.innerHTML = markup
  return container
}

describe("WatchHomeCategoryRail", () => {
  it("renders one card per configured category", () => {
    const container = render("english")
    const cards = container.querySelectorAll(
      '[data-testid^="watch-home-category-card-"]',
    )
    expect(cards).toHaveLength(WATCH_HOME_CATEGORIES.length)
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

  it("has an en.json title for every category and no orphan titles", () => {
    const titles = Object.keys(enMessages.WatchHomeCategories.categories)
    const configured = WATCH_HOME_CATEGORIES.map(
      (category) => category.titleKey,
    )
    expect([...configured].sort()).toEqual([...titles].sort())
  })
})
