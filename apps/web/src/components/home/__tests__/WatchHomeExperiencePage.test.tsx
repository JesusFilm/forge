/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Section } from "@/components/sections"
import type { WatchHomeModel } from "@/lib/watch-home"
import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"

vi.mock("next/image", () => ({
  default: () => null,
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: () => <div data-testid="experience-section" />,
}))

vi.mock("@/components/home/WatchHomeTvCarousel", () => ({
  WatchHomeTvCarousel: () => <div data-testid="watch-home-carousel" />,
}))

const model: WatchHomeModel = {
  heroSlides: [],
  sections: [],
  carousel: { pools: [], muxInserts: [] },
  program: null,
  missingData: [],
}

describe("WatchHomeExperiencePage", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("renders only the first Watch Home Hero block", async () => {
    const blocks = [
      { __typename: "WatchHomeHeroBlock", sectionKey: "hero-one" },
      { __typename: "WatchHomeHeroBlock", sectionKey: "hero-two" },
    ] as unknown as Section[]

    await act(async () => {
      root.render(
        <WatchHomeExperiencePage
          heroModel={model}
          blocks={blocks}
          languageSlug="english"
        />,
      )
    })

    expect(
      container.querySelectorAll('[data-testid="watch-home-carousel"]'),
    ).toHaveLength(1)
  })
})
