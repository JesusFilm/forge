// @vitest-environment jsdom

import { act } from "react"
import type { Route } from "next"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("@/components/ui/carousel", () => {
  return {
    Carousel: ({ children }: { children?: React.ReactNode }) => (
      <div data-slot="carousel">{children}</div>
    ),
    CarouselContent: ({
      children,
      className,
      viewportClassName,
      ...props
    }: React.ComponentProps<"div"> & { viewportClassName?: string }) => (
      <div data-slot="carousel-content" className={viewportClassName}>
        <div className={className} {...props}>
          {children}
        </div>
      </div>
    ),
    CarouselItem: ({ children, ...props }: React.ComponentProps<"div">) => (
      <div data-slot="carousel-item" {...props}>
        {children}
      </div>
    ),
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
    availability: "AUDIO",
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

  it("shows shared frames only on routable full and compact cards", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "english",
      languageName: "English",
      languageNativeName: null,
      switcherLanguages: [],
      counts: {
        audioCollections: 0,
        audioVideos: 2,
        subtitleOnlyVideos: 0,
        total: 4,
      },
      promoted: [
        card("promoted-linked", "Promoted Linked", "/linked.html" as Route),
        card("promoted-static", "Promoted Static", null),
      ],
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
      subtitleOnlyVideos: [],
    }

    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const linkedFull = container.querySelector<HTMLElement>(
      '[aria-label="Promoted Linked"]',
    )
    const staticFull = container.querySelector<HTMLElement>(
      '[aria-label="Promoted Static"]',
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

    const navigationTrack = container.querySelector(
      '[data-testid="language-inventory-navigation-track"]',
    )
    expect(navigationTrack?.className).toContain("pl-5")
    expect(navigationTrack?.className).toContain(
      "sm:pl-[max(2rem,calc(50%_-_38rem))]",
    )
    const navigationFrame = navigationTrack?.closest(
      '[data-slot="carousel"]',
    )?.parentElement
    expect(navigationFrame?.className).toContain("max-w-[1920px]")
    expect(navigationFrame?.className).not.toContain("max-w-7xl")

    const navigationSpacer = container.querySelector(
      '[data-testid="language-inventory-navigation-end-spacer"]',
    )
    expect(navigationSpacer?.getAttribute("aria-hidden")).toBe("true")
    expect(navigationSpacer?.className).toContain(
      "sm:w-[max(2rem,calc(50%_-_38rem))]",
    )
  })
})
