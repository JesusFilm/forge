/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

import enMessages from "../../../../messages/en.json"
import { WATCH_HOME_CATEGORIES } from "@/lib/watch-home-categories"

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
  copy?: Partial<
    Pick<
      Parameters<typeof WatchHomeCategoryRail>[0],
      "eyebrow" | "title" | "description" | "ctaLabel"
    >
  >,
) {
  const markup = renderToStaticMarkup(
    <WatchHomeCategoryRail
      languageSlug={languageSlug}
      categoryIds={categoryIds}
      tiles={tiles}
      {...copy}
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
  it("renders trimmed authored copy and reuses the resolved title as the carousel name", () => {
    const container = render("spanish-latin-american", ["family"], null, {
      eyebrow: "  Explora  ",
      title: "  Historias para ti  ",
      description: "  Encuentra algo para hoy.  ",
      ctaLabel: "  Ver todos  ",
    })

    expect(container.textContent).toContain("Explora")
    expect(container.textContent).toContain("Historias para ti")
    expect(container.textContent).toContain("Encuentra algo para hoy.")
    expect(container.textContent).toContain("Ver todos")
    expect(
      container
        .querySelector('[data-testid="watch-home-category-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Historias para ti")
    expect(
      container
        .querySelector('[data-testid="watch-home-category-see-all"]')
        ?.getAttribute("href"),
    ).toBe("/spanish-latin-american.html/videos")
  })

  it.each([null, "", "   "])(
    "falls back only the blank field while preserving authored siblings (%j)",
    (title) => {
      const container = render("english", ["family"], null, {
        eyebrow: "Custom eyebrow",
        title,
        description: "Custom description",
        ctaLabel: "Custom CTA",
      })
      expect(container.textContent).toContain("Custom eyebrow")
      expect(container.textContent).toContain(
        enMessages.WatchHomeCategories.title,
      )
      expect(container.textContent).toContain("Custom description")
      expect(container.textContent).toContain("Custom CTA")
    },
  )

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

  it("leads the CTA with the library glyph at the larger size", () => {
    const cta = render("english").querySelector(
      '[data-testid="watch-home-category-see-all"]',
    )
    const icons = Array.from(cta?.querySelectorAll("svg") ?? [])

    // Library glyph first, chevron last.
    expect(icons).toHaveLength(2)
    expect(cta?.firstElementChild).toBe(icons[0])
    // Must be the SAME glyph the floating header uses for the video library —
    // both controls open the language video index. They share
    // `WatchLibraryIcon`, so this pins the rendered result of that sharing.
    // lucide stamps its own name into the class list.
    expect(icons[0]?.getAttribute("class")).toContain("lucide-list-video")
    expect(icons.every((icon) => icon.classList.contains("size-5"))).toBe(true)
    expect(cta?.textContent?.trim()).toBe(enMessages.WatchHomeCategories.seeAll)

    // Larger than the 12px / 32px-tall pill it replaced. Browser-measured
    // 2026-08-27: 32px -> 48px tall, 12px -> 14px text at 1280px.
    expect(cta?.className).toContain("text-sm")
    expect(cta?.className).not.toContain("text-xs")
    expect(cta?.className).toContain("px-5")
    expect(cta?.className).toContain("py-3")
    expect(cta?.className).toContain("md:px-6")
    expect(cta?.className).toContain("md:py-3.5")
    // Wraps rather than overflowing on a very narrow viewport; `max-w-full`
    // caps it and `text-center` keeps a wrapped label readable.
    expect(cta?.className).toContain("max-w-full")
    expect(cta?.className).toContain("text-center")
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

  it("keeps category cards natively scrollable before hydration and wraps on wide screens", () => {
    const container = render("english")
    const scroller = container.querySelector(
      '[data-testid="watch-home-category-scroller"]',
    )

    expect(scroller?.className).toContain("overflow-x-auto")
    expect(scroller?.className).toContain("snap-x")
    expect(scroller?.className).toContain("min-[1440px]:grid-cols-7")
    expect(
      container.querySelectorAll('[data-testid^="watch-home-category-slide-"]'),
    ).toHaveLength(WATCH_HOME_CATEGORIES.length)
  })

  it("adds no tab stop for the scroller, which only contains links", () => {
    const container = render("english")
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0)
  })

  it("renders no arrow buttons in the server HTML, only the end-edge cue", () => {
    // Arrows are a hydrated enhancement; before the scroller is measured they
    // would be dead controls. The fade is CSS-only, so it ships in the HTML.
    const container = render("english")
    expect(container.querySelectorAll("button")).toHaveLength(0)
    expect(
      container.querySelector('[data-testid="watch-home-category-fade-end"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-home-category-fade-start"]'),
    ).toBeNull()
  })

  // Real layout is not available in jsdom, so these pin the CLASS CONTRACT
  // that was measured to fail in a real Next build at PR head 660ca4866:
  // the list-item wrapper had `min-w-0` and no `shrink-0`, so it collapsed to
  // ~12px while the 190px link overflowed it. All 13 cards painted on top of
  // each other and the scroller's scrollWidth fell to 548px (about 2,700
  // expected). The browser evidence lives in the PR / progress report.
  it("lets the list-item wrapper own the card width and refuse to shrink", () => {
    const container = render("english")
    for (const category of WATCH_HOME_CATEGORIES) {
      const slide = container.querySelector(
        `[data-testid="watch-home-category-slide-${category.id}"]`,
      )
      const link = card(container, category.id)
      const slideClasses = slide?.className.split(/\s+/) ?? []

      expect(slideClasses, category.id).toContain("shrink-0")
      expect(slideClasses, category.id).toContain("w-[190px]")
      expect(slideClasses, category.id).toContain("snap-start")
      // Back to a content-sized grid track at the two-row breakpoint.
      expect(slideClasses, category.id).toContain("min-[1440px]:w-auto")
      expect(slideClasses, category.id).not.toContain("min-w-0")
      // The link fills its wrapper instead of carrying its own fixed width.
      expect(link?.className.split(/\s+/), category.id).toContain("w-full")
      expect(link?.className, category.id).not.toContain("w-[190px]")
    }
  })

  it("mirrors the scroller padding with scroll padding at every tier", () => {
    // Without scroll-padding, mandatory snapping pulls scrollLeft past the
    // padding on load and the first card sits flush with the viewport edge
    // (measured: rest scrollLeft 20/64/25 at 390/768/1280).
    const classes =
      render("english")
        .querySelector('[data-testid="watch-home-category-scroller"]')
        ?.className.split(/\s+/) ?? []

    for (const [padding, scrollPadding] of [
      ["px-5", "scroll-px-5"],
      ["md:px-16", "md:scroll-px-16"],
      ["xl:px-24", "xl:scroll-px-24"],
    ]) {
      expect(classes).toContain(padding)
      expect(classes).toContain(scrollPadding)
    }
    // The grid does not scroll, so it must not keep snapping.
    expect(classes).toContain("min-[1440px]:snap-none")
  })

  it("keeps long and unbroken titles inside the fixed-height card, in either direction", () => {
    const container = render("english", null, [
      {
        id: "t1",
        categoryId: "jesus",
        title: "Supercalifragilistic".repeat(8),
      },
    ])
    const label = card(container, "t1")?.querySelector("span.relative")
    expect(label?.className).toContain("line-clamp-3")
    expect(label?.className).toContain("break-words")
    expect(label?.className).toContain("min-w-0")
    // Logical offset, so the glyph flips to the leading side in RTL.
    const icon = card(container, "t1")?.querySelector("svg")
    expect(icon?.getAttribute("class")).toContain("end-3")
    expect(icon?.getAttribute("class")).not.toContain("right-3")
  })
})

describe("WatchHomeCategoryRail scrolling behaviour", () => {
  const CARD_STEP = 206
  const VIEWPORT = 1000
  const mounted: Array<{ root: Root; host: HTMLElement }> = []
  let scrollLeft = 0
  let rtl = false
  let scrollByMock = vi.fn()
  const resizeObservers: Array<{
    callback: () => void
    observed: Set<Element>
  }> = []

  function installLayout() {
    scrollLeft = 0
    rtl = false
    scrollByMock = vi.fn()
    resizeObservers.length = 0
    const isScroller = (element: Element) =>
      element.getAttribute("data-testid") === "watch-home-category-scroller"
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? this.children.length * CARD_STEP : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? VIEWPORT : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
      configurable: true,
      get(this: HTMLElement) {
        return isScroller(this) ? scrollLeft : 0
      },
      set() {},
    })
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollByMock,
    })
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ direction: rtl ? "rtl" : "ltr" }) as CSSStyleDeclaration,
    )
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia
    class StubResizeObserver {
      private entry: { callback: () => void; observed: Set<Element> }
      constructor(callback: () => void) {
        this.entry = { callback, observed: new Set() }
        resizeObservers.push(this.entry)
      }
      observe(element: Element) {
        this.entry.observed.add(element)
      }
      disconnect() {
        this.entry.observed.clear()
      }
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver)
  }

  async function mount(
    tiles?: readonly RailTileInput[] | null,
  ): Promise<{ host: HTMLElement; root: Root }> {
    installLayout()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push({ root, host })
    await act(async () => {
      root.render(
        <WatchHomeCategoryRail languageSlug="english" tiles={tiles} />,
      )
    })
    return { host, root }
  }

  async function scrollTo(host: HTMLElement, position: number) {
    scrollLeft = position
    await act(async () => {
      host
        .querySelector('[data-testid="watch-home-category-scroller"]')
        ?.dispatchEvent(new Event("scroll"))
    })
  }

  const previous = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="watch-home-category-previous"]',
    )
  const next = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="watch-home-category-next"]',
    )
  const fadeStart = (host: HTMLElement) =>
    host.querySelector('[data-testid="watch-home-category-fade-start"]')
  const fadeEnd = (host: HTMLElement) =>
    host.querySelector('[data-testid="watch-home-category-fade-end"]')
  const manyTiles = (count: number): RailTileInput[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      categoryId: "jesus",
    }))

  afterEach(async () => {
    for (const { root, host } of mounted.splice(0)) {
      await act(async () => root.unmount())
      host.remove()
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("starts at the beginning: only a forward arrow and the end fade", async () => {
    const { host } = await mount()

    expect(previous(host)).toBeNull()
    expect(fadeStart(host)).toBeNull()
    expect(next(host)).not.toBeNull()
    expect(fadeEnd(host)).not.toBeNull()
  })

  it("labels the arrows with the dedicated catalog strings, not video-preview copy", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)

    expect(previous(host)?.getAttribute("aria-label")).toBe(
      enMessages.WatchHomeCategories.previous,
    )
    expect(next(host)?.getAttribute("aria-label")).toBe(
      enMessages.WatchHomeCategories.next,
    )
  })

  it("shows both arrows mid-rail and only the backward one at the end", async () => {
    const { host } = await mount()
    const maxScroll = WATCH_HOME_CATEGORIES.length * CARD_STEP - VIEWPORT

    await scrollTo(host, 300)
    expect(previous(host)).not.toBeNull()
    expect(next(host)).not.toBeNull()
    expect(fadeStart(host)).not.toBeNull()
    expect(fadeEnd(host)).not.toBeNull()

    await scrollTo(host, maxScroll)
    expect(previous(host)).not.toBeNull()
    expect(next(host)).toBeNull()
    expect(fadeEnd(host)).toBeNull()

    // Fractional rest positions must not leave a spent arrow enabled.
    await scrollTo(host, maxScroll - 0.5)
    expect(next(host)).toBeNull()
  })

  it("keeps the arrows as ordinary tabbable buttons that only fine pointers from md see", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)

    for (const button of [previous(host), next(host)]) {
      expect(button?.getAttribute("type")).toBe("button")
      // Effective tab order, not attribute absence: base-ui sets tabindex="0".
      expect(button?.tabIndex).toBe(0)
      const classes = button?.className.split(/\s+/) ?? []
      expect(classes).toContain("hidden")
      expect(classes).toContain("md:pointer-fine:flex")
    }
    // The cue overlays must never become hit targets.
    expect(fadeStart(host)?.className).toContain("pointer-events-none")
    expect(fadeEnd(host)?.className).toContain("pointer-events-none")
  })

  it("gives the arrows an explicit dark-on-light face, never the section's white", async () => {
    // The rail section is text-white and the outline Button variant paints a
    // white background: without an explicit pair the chevron was white on
    // white. Same face as the Watch carousel arrows.
    const { host } = await mount()
    await scrollTo(host, 300)

    for (const button of [previous(host), next(host)]) {
      const classes = button?.className.split(/\s+/) ?? []
      expect(classes).toContain("bg-white/95")
      expect(classes).toContain("text-stone-900")
      expect(classes).not.toContain("text-white")
      expect(classes).toContain("rounded-full")
      expect(classes).toContain("size-11")
    }
  })

  it("scrolls toward the logical end in left-to-right", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)

    await act(async () => next(host)?.click())
    expect(scrollByMock).toHaveBeenLastCalledWith({
      left: VIEWPORT * 0.8,
      behavior: "smooth",
    })
    await act(async () => previous(host)?.click())
    expect(scrollByMock).toHaveBeenLastCalledWith({
      left: -VIEWPORT * 0.8,
      behavior: "smooth",
    })
  })

  it("scrolls toward the logical end in right-to-left, where scrollLeft is negative", async () => {
    const { host } = await mount()
    rtl = true
    // Negative scrollLeft is how RTL reports travel away from the start edge.
    await scrollTo(host, -300)
    expect(previous(host)).not.toBeNull()
    expect(next(host)).not.toBeNull()

    await act(async () => next(host)?.click())
    expect(scrollByMock).toHaveBeenLastCalledWith({
      left: -VIEWPORT * 0.8,
      behavior: "smooth",
    })
    await act(async () => previous(host)?.click())
    expect(scrollByMock).toHaveBeenLastCalledWith({
      left: VIEWPORT * 0.8,
      behavior: "smooth",
    })
    // The glyphs mirror in RTL through CSS, not by swapping which arrow is which.
    expect(
      previous(host)?.querySelector("svg")?.getAttribute("class"),
    ).toContain("rtl:rotate-180")
    expect(next(host)?.querySelector("svg")?.getAttribute("class")).toContain(
      "rtl:rotate-180",
    )
  })

  it("places arrows and fades on logical edges so RTL mirrors them", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)

    expect(previous(host)?.className).toContain("start-2")
    expect(next(host)?.className).toContain("end-2")
    expect(fadeStart(host)?.className).toContain("start-0")
    expect(fadeStart(host)?.className).toContain("rtl:bg-gradient-to-l")
    expect(fadeEnd(host)?.className).toContain("end-0")
    expect(fadeEnd(host)?.className).toContain("rtl:bg-gradient-to-r")
  })

  it("uses reduced motion when the visitor asks for it", async () => {
    const { host } = await mount()
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia

    await act(async () => next(host)?.click())
    expect(scrollByMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    )
  })

  it("hands focus to the opposite arrow when the focused arrow is spent", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)
    const forward = next(host)
    await act(async () => {
      forward?.focus()
      forward?.click()
    })
    expect(document.activeElement).toBe(forward)

    await scrollTo(host, WATCH_HOME_CATEGORIES.length * CARD_STEP - VIEWPORT)

    expect(next(host)).toBeNull()
    expect(document.activeElement).toBe(previous(host))
  })

  it("does not steal focus the visitor has already moved to a card", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)
    await act(async () => next(host)?.click())
    const cardLink = host.querySelector<HTMLElement>("a[href]")
    await act(async () => cardLink?.focus())

    await scrollTo(host, WATCH_HOME_CATEGORIES.length * CARD_STEP - VIEWPORT)

    expect(document.activeElement).toBe(cardLink)
  })

  it("does not steal focus after a click on Next followed by a click outside", async () => {
    // Activation is not focus: the visitor pressed Next, then clicked away to
    // the page body, then wheel-scrolled the rail to its end.
    const { host } = await mount()
    await scrollTo(host, 300)
    await act(async () => {
      next(host)?.focus()
      next(host)?.click()
    })
    await act(async () => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)

    await scrollTo(host, WATCH_HOME_CATEGORIES.length * CARD_STEP - VIEWPORT)

    expect(next(host)).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it("hands focus the other way when Previous is spent at the start", async () => {
    const { host } = await mount()
    await scrollTo(host, 300)
    await act(async () => previous(host)?.focus())

    await scrollTo(host, 0)

    expect(previous(host)).toBeNull()
    expect(document.activeElement).toBe(next(host))
  })

  it("has no arrows or fades when every tile already fits", async () => {
    const { host } = await mount(manyTiles(2))

    expect(previous(host)).toBeNull()
    expect(next(host)).toBeNull()
    expect(fadeStart(host)).toBeNull()
    // Assumed forward in the server HTML, then corrected once measured.
    expect(fadeEnd(host)).toBeNull()
  })

  it("re-measures when authored tiles grow at the same viewport width", async () => {
    // Short -> long at an unchanged scroller box: a ResizeObserver on the
    // scroller alone would leave the stale "nothing to scroll" state.
    const { host, root } = await mount(manyTiles(2))
    expect(next(host)).toBeNull()

    await act(async () => {
      root.render(
        <WatchHomeCategoryRail languageSlug="english" tiles={manyTiles(13)} />,
      )
    })

    expect(next(host)).not.toBeNull()
    expect(fadeEnd(host)).not.toBeNull()
  })

  it("re-measures when authored tiles shrink to fit", async () => {
    const { host, root } = await mount(manyTiles(13))
    expect(next(host)).not.toBeNull()

    await act(async () => {
      root.render(
        <WatchHomeCategoryRail languageSlug="english" tiles={manyTiles(2)} />,
      )
    })

    expect(next(host)).toBeNull()
    expect(fadeEnd(host)).toBeNull()
  })

  it("observes every list item so a card resizing alone re-measures", async () => {
    const { host } = await mount(manyTiles(5))
    const scroller = host.querySelector(
      '[data-testid="watch-home-category-scroller"]',
    )
    const observed = resizeObservers.flatMap(({ observed }) => [...observed])

    expect(observed).toContain(scroller)
    for (const child of scroller?.children ?? []) {
      expect(observed).toContain(child)
    }
  })

  it("stops listening when unmounted", async () => {
    const { host, root } = await mount()
    const scroller = host.querySelector(
      '[data-testid="watch-home-category-scroller"]',
    )
    const removeSpy = vi.spyOn(scroller as Element, "removeEventListener")

    await act(async () => root.unmount())
    mounted.splice(0)
    host.remove()

    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function))
    expect(resizeObservers.every(({ observed }) => observed.size === 0)).toBe(
      true,
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
