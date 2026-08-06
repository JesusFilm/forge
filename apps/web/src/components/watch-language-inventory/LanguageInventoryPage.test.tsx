// @vitest-environment jsdom

import { act } from "react"
import type { Route } from "next"
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
    CarouselPrevious: () => null,
    CarouselNext: () => null,
  }
})
vi.mock("./LanguageCollectionSwitcher", () => ({
  LanguageCollectionSwitcher: () => null,
}))

import { LanguageInventoryPage } from "./LanguageInventoryPage"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

function card(
  id: string,
  title: string,
  href: WatchLanguageInventoryCard["href"],
  parentSlug: string | null = null,
  availability: WatchLanguageInventoryCard["availability"] = "AUDIO",
): WatchLanguageInventoryCard {
  return {
    id,
    coreId: id,
    slug: id,
    title,
    description: null,
    imageUrl: null,
    imageAlt: title,
    label: "SHORT_FILM",
    availability,
    href,
    watchLanguageSlug: "english",
    parentSlug,
    parentTitle: parentSlug ? "Series" : null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

describe("LanguageInventoryPage video thumbnails", () => {
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

  it("shows shared frames only on routable catalog cards", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: null,
      switcherLanguages: [],
      counts: {
        audioCollections: 0,
        audioVideos: 2,
        subtitleOnlyVideos: 2,
        total: 4,
      },
      promoted: [],
      audioCollections: [],
      audioVideos: [
        card(
          "compact-linked",
          "Compact Linked",
          "/compact.html" as Route,
          "series",
        ),
        card("compact-static", "Compact Static", null, "series"),
      ],
      subtitleOnlyVideos: [
        card(
          "subtitle-linked",
          "Subtitle Linked",
          "/linked.html" as Route,
          null,
          "SUBTITLE_ONLY",
        ),
        card("subtitle-static", "Subtitle Static", null, null, "SUBTITLE_ONLY"),
      ],
    }

    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const linkedFull = container.querySelector<HTMLElement>(
      '[aria-label="Subtitle Linked"]',
    )
    const staticFull = container.querySelector<HTMLElement>(
      '[aria-label="Subtitle Static"]',
    )
    expect(linkedFull?.className).toContain("group")
    expect(linkedFull?.className).toContain("focus-visible:outline-none")
    expect(
      linkedFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).not.toBeNull()
    expect(staticFull?.className).not.toContain("group")
    expect(staticFull?.className).not.toContain("focus-visible:outline-none")
    expect(
      staticFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).toBeNull()

    const compactFrames = container.querySelectorAll(
      '[data-testid="language-inventory-compact-thumbnail-frame"]',
    )
    expect(compactFrames).toHaveLength(1)
    const linkedCompact = compactFrames[0]?.closest("a")
    expect(linkedCompact?.className).toContain("group")
    expect(linkedCompact?.className).toContain("focus-visible:outline-none")

    const staticCompactTitle = Array.from(
      container.querySelectorAll("span"),
    ).find((element) => element.textContent === "Compact Static")
    const staticCompact = staticCompactTitle?.parentElement?.parentElement
    expect(staticCompact?.tagName).toBe("DIV")
    expect(staticCompact?.className).not.toContain("group")
    expect(staticCompact?.querySelector("svg")).toBeNull()
  })
})
