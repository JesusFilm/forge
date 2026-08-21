/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Section } from "@/components/sections"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { WatchHomeModel } from "@/lib/watch-home"

vi.mock("next/image", () => ({
  default: () => null,
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "pageTitle" ? "Jesus Film Project Watch" : key,
}))

vi.mock("@/components/home/WatchHomeFooter", () => ({
  WatchHomeFooter: () => <footer data-testid="watch-home-footer" />,
}))

vi.mock("@/components/home/WatchHomeTvCarousel", () => ({
  WatchHomeTvCarousel: () => (
    <section
      data-testid="watch-home-hero"
      data-block-marker="WatchHomeHeroBlock"
    />
  ),
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: ({
    section,
    languageSlug,
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

    return (
      <section
        data-testid="experience-section"
        data-section-type={section.__typename ?? "unknown"}
        data-language-slug={languageSlug}
        data-block-marker={section.__typename ?? "unknown"}
        data-items-source={section.itemsSource ?? undefined}
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
  carousel: { pools: [], muxInserts: [] },
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
    expect(serverContainer.querySelector("h2")?.textContent).toBe(
      "Secondary page heading",
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
      "Primary page heading",
    )
    expect(container.querySelector("h2")?.textContent).toBe(
      "Secondary page heading",
    )
  })

  it("contains only top-level standalone video blocks on the Watch rail", async () => {
    const blocks = [
      makeBlock("WatchHomeHeroBlock", "hero"),
      makeBlock("VideoHeroBlock", "video-hero"),
      makeBlock("VideoCarouselBlock", "course"),
      makeBlock("SectionBlock", "section"),
      makeBlock("VideoBlock", "invitation"),
      makeBlock("MediaCollectionBlock", "collection"),
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
  })

  it("keeps the canonical footer reachable before the dynamic discovery feed", async () => {
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
    expect(footer?.compareDocumentPosition(dynamicFeed as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
