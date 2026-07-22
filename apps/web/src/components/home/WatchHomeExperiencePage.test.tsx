/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Section } from "@/components/sections"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { WatchHomeModel } from "@/lib/watch-home"

vi.mock("next/image", () => ({
  default: () => null,
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
    section: { __typename?: string | null }
    languageSlug: string
  }) => (
    <section
      data-testid="experience-section"
      data-section-type={section.__typename ?? "unknown"}
      data-language-slug={languageSlug}
      data-block-marker={section.__typename ?? "unknown"}
    />
  ),
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
})
