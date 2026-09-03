/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Section } from "@/components/sections"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { DynamicCollectionFeedCacheSignatures } from "@/lib/dynamic-collection-contract"
import type { WatchHomeModel } from "@/lib/watch-home"

const createCacheSignatures = vi.hoisted(() => vi.fn())

vi.mock("next/image", () => ({
  default: () => null,
}))

vi.mock("next-intl", () => ({
  // `useLocale` is consumed by the shared Carousel (text direction), which
  // reaches this tree through the category rail under the hero.
  useLocale: () => "en",
  useTranslations: () => (key: string) =>
    key === "pageTitle" ? "Jesus Film Project Watch" : key,
}))

vi.mock("@/lib/dynamic-collection-cache-signature", () => ({
  createInitialDynamicCollectionFeedCacheSignatures: createCacheSignatures,
}))

vi.mock("@/components/home/WatchHomeFooter", () => ({
  WatchHomeFooter: () => <footer data-testid="watch-home-footer" />,
}))

vi.mock("@/components/home/WatchHomeTvCarousel", () => ({
  WatchHomeTvCarousel: ({ pinned = true }: { pinned?: boolean }) => (
    <section
      data-testid="watch-home-hero"
      data-block-marker="WatchHomeHeroBlock"
      data-pinned={pinned ? "true" : "false"}
    />
  ),
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: ({
    section,
    languageSlug,
    dynamicCollections,
  }: {
    section: {
      __typename?: string | null
      content?: Array<Record<string, unknown> | null> | null
      heading?: string | null
      headingLevel?: string | null
      itemsSource?: string | null
      sectionContent?: Array<Record<string, unknown> | null> | null
    }
    languageSlug: string
    dynamicCollections?: {
      cacheSignatures?: DynamicCollectionFeedCacheSignatures
      featuredCollections?: { ids: string[]; slugs: string[] }
    }
  }) => {
    const headings = (
      block: typeof section | Record<string, unknown> | null,
    ): Array<{ heading: string; level: "h1" | "h2" }> => {
      if (!block) return []
      if (
        block.__typename === "TextBlock" &&
        (block.headingLevel === "h1" || block.headingLevel === "h2") &&
        typeof block.heading === "string" &&
        block.heading.trim().length > 0
      ) {
        return [
          {
            heading: block.heading,
            level: block.headingLevel,
          },
        ]
      }

      const children =
        block.__typename === "SectionBlock"
          ? block.sectionContent
          : block.__typename === "ContainerBlock"
            ? block.content
            : null

      return Array.isArray(children) ? children.flatMap(headings) : []
    }

    if (section.__typename === "WatchHomeCategoryRailBlock") {
      return (
        <section
          data-testid="watch-home-category-rail"
          data-block-marker="WatchHomeCategoryRailBlock"
          data-language-slug={languageSlug}
        />
      )
    }

    return (
      <section
        data-testid="experience-section"
        data-section-type={section.__typename ?? "unknown"}
        data-language-slug={languageSlug}
        data-block-marker={section.__typename ?? "unknown"}
        data-items-source={section.itemsSource ?? undefined}
        data-desktop-cache-signature={
          dynamicCollections?.cacheSignatures?.desktop
        }
        data-excluded-slug-count={
          dynamicCollections?.featuredCollections?.slugs.length
        }
      >
        {headings(section).map(({ heading, level }) =>
          level === "h1" ? (
            <h1 key={heading}>{heading}</h1>
          ) : (
            <h2 key={heading}>{heading}</h2>
          ),
        )}
      </section>
    )
  },
}))

import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"

const heroModel = {
  heroSlides: [],
  sections: [],
  carousel: { pools: [] },
  missingData: [],
} satisfies WatchHomeModel

function makeBlock(__typename: string, sectionKey: string) {
  return { __typename, sectionKey } as unknown as Section
}

function makePageHeadingBlock(
  heading = "Watch free Christian videos, Bible stories, and films",
  sectionKey = "page-heading",
) {
  return {
    __typename: "TextBlock",
    sectionKey,
    heading,
    headingLevel: "h1",
  } as unknown as Section
}

function makeNestedPageHeadingBlock(
  heading = "Watch free Christian videos, Bible stories, and films",
  sectionKey = "page-heading",
) {
  return {
    __typename: "SectionBlock",
    sectionKey: `${sectionKey}-section`,
    sectionContent: [
      {
        __typename: "ContainerBlock",
        sectionKey: `${sectionKey}-container`,
        content: [makePageHeadingBlock(heading, sectionKey)],
      },
    ],
  } as unknown as Section
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  createCacheSignatures.mockReset()
  createCacheSignatures.mockReturnValue({
    mobile: "m".repeat(43),
    desktop: "d".repeat(43),
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe("WatchHomeExperiencePage", () => {
  it("server-renders one fallback h1 without an authored page heading", () => {
    const html = renderToStaticMarkup(
      <WatchHomeExperiencePage
        heroModel={heroModel}
        blocks={[]}
        languageSlug="english"
      />,
    )
    const serverContainer = document.createElement("div")
    serverContainer.innerHTML = html

    expect(serverContainer.querySelectorAll("h1")).toHaveLength(1)
    expect(serverContainer.querySelector("h1")?.textContent).toBe(
      "Jesus Film Project Watch",
    )
  })

  it("renders the authored page topic as the only hydrated h1", async () => {
    const blocks = [makeNestedPageHeadingBlock()]
    const html = renderToStaticMarkup(
      <WatchHomeExperiencePage
        heroModel={heroModel}
        blocks={blocks}
        languageSlug="english"
      />,
    )
    const serverContainer = document.createElement("div")
    serverContainer.innerHTML = html

    expect(serverContainer.querySelectorAll("h1")).toHaveLength(1)
    expect(serverContainer.querySelector("h1")?.textContent).toBe(
      "Watch free Christian videos, Bible stories, and films",
    )

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    expect(container.querySelectorAll("h1")).toHaveLength(1)
    expect(container.querySelector("h1")?.textContent).toBe(
      "Watch free Christian videos, Bible stories, and films",
    )
  })

  it("keeps the first authored h1 and demotes additional authored h1s", async () => {
    const blocks = [
      makePageHeadingBlock("Primary page heading", "primary-heading"),
      makeNestedPageHeadingBlock("Secondary page heading", "secondary-heading"),
    ]
    const html = renderToStaticMarkup(
      <WatchHomeExperiencePage
        heroModel={heroModel}
        blocks={blocks}
        languageSlug="english"
      />,
    )
    const serverContainer = document.createElement("div")
    serverContainer.innerHTML = html

    expect(serverContainer.querySelectorAll("h1")).toHaveLength(1)
    expect(serverContainer.querySelector("h1")?.textContent).toBe(
      "Primary page heading",
    )
    expect(
      Array.from(serverContainer.querySelectorAll("h2")).map(
        (heading) => heading.textContent,
      ),
    ).toContain("Secondary page heading")

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    expect(container.querySelectorAll("h1")).toHaveLength(1)
    expect(container.querySelector("h1")?.textContent).toBe(
      "Primary page heading",
    )
    expect(
      Array.from(container.querySelectorAll("h2")).map(
        (heading) => heading.textContent,
      ),
    ).toContain("Secondary page heading")
  })

  it("contains only top-level standalone video blocks on the Watch rail", async () => {
    const blocks = [
      makeBlock("WatchHomeHeroBlock", "hero"),
      makeBlock("VideoHeroBlock", "video-hero"),
      makeBlock("VideoCarouselBlock", "course"),
      makeBlock("SectionBlock", "section"),
      makeBlock("VideoBlock", "invitation"),
      makeBlock("MediaCollectionBlock", "collection"),
      makeBlock("LanguageGlobeBlock", "language-globe"),
    ]

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    const rails = Array.from(
      container.querySelectorAll<HTMLElement>("[data-watch-home-content-rail]"),
    )
    expect(rails).toHaveLength(2)

    for (const rail of rails) {
      for (const className of WATCH_PAGE_CONTENT_CLASSES.split(" ")) {
        expect(rail.classList.contains(className)).toBe(true)
      }
      expect(rail.classList.contains("pt-16")).toBe(true)
      expect(
        rail.querySelectorAll('[data-testid="experience-section"]'),
      ).toHaveLength(1)
    }

    expect(
      rails.map(
        (rail) =>
          rail.querySelector<HTMLElement>('[data-testid="experience-section"]')
            ?.dataset.sectionType,
      ),
    ).toEqual(["VideoCarouselBlock", "VideoBlock"])

    const renderedSections = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="experience-section"]',
      ),
    )

    for (const sectionType of [
      "VideoHeroBlock",
      "SectionBlock",
      "MediaCollectionBlock",
      "LanguageGlobeBlock",
    ]) {
      const section = container.querySelector<HTMLElement>(
        `[data-section-type="${sectionType}"]`,
      )
      expect(
        section?.parentElement?.hasAttribute("data-watch-home-content-rail"),
      ).toBe(false)
    }

    expect(
      renderedSections.map((section) => section.dataset.sectionType),
    ).toEqual([
      "VideoHeroBlock",
      "VideoCarouselBlock",
      "SectionBlock",
      "VideoBlock",
      "MediaCollectionBlock",
      "LanguageGlobeBlock",
    ])
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-block-marker]"),
      ).map((block) => block.dataset.blockMarker),
    ).toEqual([
      "WatchHomeHeroBlock",
      "VideoHeroBlock",
      "VideoCarouselBlock",
      "SectionBlock",
      "VideoBlock",
      "MediaCollectionBlock",
      "LanguageGlobeBlock",
    ])
    expect(
      renderedSections.every(
        (section) => section.dataset.languageSlug === "english",
      ),
    ).toBe(true)
    expect(
      container.querySelectorAll('[data-testid="watch-home-hero"]'),
    ).toHaveLength(1)
    expect(
      container.querySelector('[data-testid="watch-home-footer"]'),
    ).not.toBeNull()
    const authoredGlobe = container.querySelector(
      '[data-section-type="LanguageGlobeBlock"]',
    )
    expect(authoredGlobe).not.toBeNull()
    expect(authoredGlobe?.nextElementSibling?.getAttribute("data-testid")).toBe(
      "watch-home-footer",
    )
  })

  it("keeps the canonical footer as the final element after the dynamic discovery feed", async () => {
    const blocks = [
      makeBlock("MediaCollectionBlock", "authored-collection"),
      {
        __typename: "MediaCollectionBlock",
        sectionKey: "dynamic-collection-feed",
        itemsSource: "dynamicCollections",
      } as unknown as Section,
    ]

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    const footer = container.querySelector('[data-testid="watch-home-footer"]')
    const dynamicFeed = container.querySelector(
      '[data-items-source="dynamicCollections"]',
    )

    expect(footer).not.toBeNull()
    expect(dynamicFeed).not.toBeNull()
    expect(dynamicFeed?.getAttribute("data-desktop-cache-signature")).toBe(
      "d".repeat(43),
    )
    expect(createCacheSignatures).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheScope: "live",
        locale: "en",
        languageSlug: "english",
      }),
    )
    expect(dynamicFeed?.compareDocumentPosition(footer as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(footer?.parentElement?.lastElementChild).toBe(footer)
  })

  it("preserves the editor-authored globe position around the dynamic feed", async () => {
    const blocks = [
      {
        __typename: "MediaCollectionBlock",
        sectionKey: "dynamic-collection-feed",
        itemsSource: "dynamicCollections",
      } as unknown as Section,
      makeBlock("LanguageGlobeBlock", "language-globe"),
    ]

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    const dynamicFeed = container.querySelector(
      '[data-items-source="dynamicCollections"]',
    )
    const globe = container.querySelector(
      '[data-section-type="LanguageGlobeBlock"]',
    )

    expect(dynamicFeed).not.toBeNull()
    expect(globe).not.toBeNull()
    expect(dynamicFeed?.compareDocumentPosition(globe as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it.each([
    ["an authored hero block", [makeBlock("WatchHomeHeroBlock", "hero")]],
    ["the fallback hero carousel", [] as Section[]],
  ])(
    "does not synthesize a category rail after %s on a supported schema",
    async (_label, blocks) => {
      await act(async () => {
        root.render(
          <WatchHomeExperiencePage
            heroModel={heroModel}
            blocks={blocks}
            languageSlug="english"
          />,
        )
      })

      const rails = container.querySelectorAll(
        '[data-testid="watch-home-category-rail"]',
      )
      expect(rails).toHaveLength(0)
    },
  )

  it.each([
    ["an authored hero block", [makeBlock("WatchHomeHeroBlock", "hero")]],
    ["the fallback hero carousel", [] as Section[]],
  ])(
    "renders one fixed compatibility rail directly after %s",
    async (_label, blocks) => {
      await act(async () => {
        root.render(
          <WatchHomeExperiencePage
            heroModel={heroModel}
            blocks={blocks}
            languageSlug="english"
            legacyCategoryRailCompatibility
          />,
        )
      })

      const rails = container.querySelectorAll(
        '[data-testid="watch-home-category-rail"]',
      )
      expect(rails).toHaveLength(1)
      // "Directly after" is asserted in block order rather than as a DOM
      // sibling: the fallback carousel hero is sticky and sits OUTSIDE the
      // body zone that covers it, while an authored hero block sits inside
      // it. Both must still put the rail immediately after the hero.
      const renderedBlocks = Array.from(
        container.querySelectorAll<HTMLElement>("[data-block-marker]"),
      )
      const heroIndex = renderedBlocks.findIndex(
        (block) => block.dataset.testid === "watch-home-hero",
      )
      expect(heroIndex).toBeGreaterThanOrEqual(0)
      expect(renderedBlocks[heroIndex + 1]).toBe(rails[0])
    },
  )

  it.each([
    [
      "before",
      [
        makeBlock("WatchHomeCategoryRailBlock", "categories"),
        makeBlock("MediaCollectionBlock", "collection"),
      ],
      ["WatchHomeCategoryRailBlock", "MediaCollectionBlock"],
    ],
    [
      "between",
      [
        makeBlock("MediaCollectionBlock", "first"),
        makeBlock("WatchHomeCategoryRailBlock", "categories"),
        makeBlock("LanguageGlobeBlock", "last"),
      ],
      [
        "MediaCollectionBlock",
        "WatchHomeCategoryRailBlock",
        "LanguageGlobeBlock",
      ],
    ],
    [
      "after",
      [
        makeBlock("MediaCollectionBlock", "collection"),
        makeBlock("WatchHomeCategoryRailBlock", "categories"),
      ],
      ["MediaCollectionBlock", "WatchHomeCategoryRailBlock"],
    ],
  ])(
    "renders the authored category rail %s surrounding blocks",
    async (_label, blocks, order) => {
      await act(async () => {
        root.render(
          <WatchHomeExperiencePage
            heroModel={heroModel}
            blocks={blocks as Section[]}
            languageSlug="english"
          />,
        )
      })

      expect(
        Array.from(
          container.querySelectorAll<HTMLElement>("[data-block-marker]"),
        ).map((block) => block.dataset.blockMarker),
      ).toEqual(["WatchHomeHeroBlock", ...order])
      expect(
        container.querySelectorAll('[data-testid="watch-home-category-rail"]'),
      ).toHaveLength(1)
    },
  )

  it("bounds large authored parent-slug sets before signing and rendering", () => {
    const authoredCollections = Array.from({ length: 201 }, (_, index) => ({
      __typename: "MediaCollectionBlock",
      sectionKey: `authored-${index}`,
      mediaDefaultCollectionSlug: `collection-${index}`,
      items: [],
    })) as unknown as Section[]
    const dynamicFeed = {
      __typename: "MediaCollectionBlock",
      sectionKey: "dynamic-collection-feed",
      itemsSource: "dynamicCollections",
    } as unknown as Section

    const html = renderToStaticMarkup(
      <WatchHomeExperiencePage
        heroModel={heroModel}
        blocks={[...authoredCollections, dynamicFeed]}
        languageSlug="english"
      />,
    )

    expect(createCacheSignatures).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedSlugs: expect.arrayContaining([
          "collection-0",
          "collection-199",
        ]),
      }),
    )
    const signatureInput = createCacheSignatures.mock.calls[0]?.[0] as {
      excludedSlugs: string[]
    }
    expect(signatureInput.excludedSlugs).toHaveLength(200)

    const serverContainer = document.createElement("div")
    serverContainer.innerHTML = html
    expect(
      serverContainer
        .querySelector('[data-items-source="dynamicCollections"]')
        ?.getAttribute("data-excluded-slug-count"),
    ).toBe("200")
  })
  it("hoists a leading authored hero block above the body zone that covers it", async () => {
    // This is the production /watch shape: the hero arrives as an authored
    // block, not through the fallback carousel branch. Rendered inline it
    // lands INSIDE the body zone, which scrolls with it and never covers it.
    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={[
            makeBlock("WatchHomeHeroBlock", "hero"),
            makeBlock("MediaCollectionBlock", "collection"),
          ]}
          languageSlug="english"
        />,
      )
    })

    const hero = container.querySelector('[data-testid="watch-home-hero"]')
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    )
    expect(hero).not.toBeNull()
    expect(bodyZone).not.toBeNull()
    expect(bodyZone?.contains(hero as Node)).toBe(false)
    expect(hero?.nextElementSibling).toBe(bodyZone)
    // Exactly one hero: hoisting must not leave the inline copy behind.
    expect(
      container.querySelectorAll('[data-testid="watch-home-hero"]'),
    ).toHaveLength(1)
    expect(
      bodyZone?.querySelector('[data-block-marker="MediaCollectionBlock"]'),
    ).not.toBeNull()
  })

  it("does not pin a mid-page authored hero block", async () => {
    // It renders INSIDE the body zone. Pinned, it would stick at the viewport
    // top under the very content its coverage check measures against — which
    // reads as 100% covered, so its video would pause and never resume.
    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={[
            makeBlock("MediaCollectionBlock", "collection"),
            makeBlock("WatchHomeHeroBlock", "hero"),
          ]}
          languageSlug="english"
        />,
      )
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-hero"]')
        ?.getAttribute("data-pinned"),
    ).toBe("false")
  })

  it("pins a hoisted leading authored hero block", async () => {
    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={[
            makeBlock("WatchHomeHeroBlock", "hero"),
            makeBlock("MediaCollectionBlock", "collection"),
          ]}
          languageSlug="english"
        />,
      )
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-hero"]')
        ?.getAttribute("data-pinned"),
    ).toBe("true")
  })

  it("leaves a mid-page authored hero block in place", async () => {
    // Pinning a hero that starts halfway down the page has no meaning, so a
    // non-leading hero keeps its authored position inside the body zone.
    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={[
            makeBlock("MediaCollectionBlock", "collection"),
            makeBlock("WatchHomeHeroBlock", "hero"),
          ]}
          languageSlug="english"
        />,
      )
    })

    const hero = container.querySelector('[data-testid="watch-home-hero"]')
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    )
    expect(bodyZone?.contains(hero as Node)).toBe(true)
    expect(
      container.querySelectorAll('[data-testid="watch-home-hero"]'),
    ).toHaveLength(1)
  })

  // The production /watch route renders this page, not WatchHomePage, so the
  // hero's full-bleed media needs its own guard here: an `overflow-x-clip`
  // re-added to the 1920px column snaps the intro video back onto the rail.
  // The carousel itself is mocked in this suite, so this asserts the column
  // around it; WatchHomePage.test.tsx pins the media frame's own classes.
  it("leaves the content column unclipped so the hero media can bleed", async () => {
    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={heroModel}
          blocks={[]}
          languageSlug="english"
        />,
      )
    })

    const hero = container.querySelector(
      '[data-testid="watch-home-hero"]',
    ) as HTMLElement
    const clippingAncestors: string[] = []
    for (
      let node = hero.parentElement;
      node && node !== container;
      node = node.parentElement
    ) {
      if (/overflow-(hidden|x-clip|x-hidden)/.test(node.className)) {
        clippingAncestors.push(node.className)
      }
    }
    expect(clippingAncestors).toEqual([
      // <main> keeps its clip so the 100vw span never adds page scroll.
      // Clip, not hidden: hidden would make <main> a scroll container and
      // break the sticky hero.
      "min-h-screen overflow-x-clip bg-black text-white",
    ])
    expect((hero.parentElement as HTMLElement).className).toContain(
      "max-w-[1920px]",
    )
  })
})
