/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CarouselItem: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  CarouselNext: () => null,
  CarouselPrevious: () => null,
}))

import { ExperienceSectionRenderer } from "./index"

describe("WatchHomeCategoryRail Experience dispatch", () => {
  it("passes the authored ids and page language through normal dispatch", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ExperienceSectionRenderer
          section={
            {
              __typename: "WatchHomeCategoryRailBlock",
              categoryIds: ["family", "jesus"],
            } as never
          }
          languageSlug="spanish-latin-american"
        />,
      )
    })
    await act(async () => {
      await import("./WatchHomeCategoryRailExperience")
    })
    const cards = Array.from(
      container.querySelectorAll('[data-testid^="watch-home-category-card-"]'),
    )

    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "watch-home-category-card-family",
      "watch-home-category-card-jesus",
    ])
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/family.html/spanish-latin-american.html",
      "/jesus.html/spanish-latin-american.html",
    ])

    await act(async () => root.unmount())
  })

  it("does not treat a malformed missing selection as the all-category default", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ExperienceSectionRenderer
          section={{ __typename: "WatchHomeCategoryRailBlock" } as never}
          languageSlug="english"
        />,
      )
      await import("./WatchHomeCategoryRailExperience")
    })

    expect(container.innerHTML).toBe("")
    await act(async () => root.unmount())
  })
})
