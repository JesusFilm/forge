// @vitest-environment jsdom

import { act } from "react"
import type { Route } from "next"
import { setRequestLocale } from "next-intl/server"
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
    CarouselPrevious: ({
      label,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) => (
      <button aria-label={label} {...props} />
    ),
    CarouselNext: ({
      label,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) => (
      <button aria-label={label} {...props} />
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
  options: {
    availability?: WatchLanguageInventoryCard["availability"]
    childCount?: number
  } = {},
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
    availability: options.availability ?? "AUDIO",
    href,
    watchLanguageSlug: "english",
    parentSlug,
    parentTitle: parentSlug ? "Series" : null,
    durationSeconds: 60,
    childCount: options.childCount ?? 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

describe("LanguageInventoryPage video thumbnails", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setRequestLocale("ru")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setRequestLocale("en")
  })

  it("preserves localized labels and routes while assisting routable cards and sections", () => {
    const inventory: WatchLanguageInventoryModel = {
      languageSlug: "russian",
      languageName: "Russian",
      languageNativeName: "Русский",
      switcherLanguages: [],
      counts: {
        audioCollections: 1,
        audioVideos: 2,
        subtitleOnlyVideos: 1,
        total: 6,
      },
      promoted: [
        card("promoted-linked", "Видео с озвучкой", "/linked.html" as Route),
        card(
          "promoted-collection",
          "Коллекция фильмов",
          "/collection.html" as Route,
          null,
          { childCount: 3 },
        ),
        card("promoted-static", "Статичное видео", null),
      ],
      audioCollections: [],
      audioVideos: [
        card(
          "compact-linked",
          "Видео в коллекции",
          "/compact.html" as Route,
          "series",
        ),
        card("compact-static", "Статичное видео в коллекции", null, "series"),
      ],
      subtitleOnlyVideos: [
        card(
          "subtitle-linked",
          "Видео только с субтитрами",
          "/subtitle.html" as Route,
          null,
          { availability: "SUBTITLE_ONLY" },
        ),
      ],
    }

    act(() => {
      root.render(<LanguageInventoryPage inventory={inventory} />)
    })

    const linkedFull = container.querySelector<HTMLElement>(
      '[aria-label="Видео с озвучкой"]',
    )
    const linkedCollection = container.querySelector<HTMLAnchorElement>(
      '[aria-label="Коллекция фильмов"]',
    )
    const staticFull = container.querySelector<HTMLElement>(
      '[aria-label="Статичное видео"]',
    )
    expect(linkedFull?.className).toContain("group")
    expect(linkedFull?.className).toContain("focus-visible:outline-none")
    expect(
      linkedFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).not.toBeNull()
    expect(linkedFull?.hasAttribute("data-english-assist")).toBe(false)
    expect(linkedFull?.title).toBe("Open video")
    expect(linkedFull?.getAttribute("aria-label")).toBe("Видео с озвучкой")
    expect(linkedFull?.getAttribute("href")).toBe("/linked.html")
    expect(linkedCollection?.hasAttribute("data-english-assist")).toBe(false)
    expect(linkedCollection?.title).toBe("Open collection")
    expect(linkedCollection?.getAttribute("aria-label")).toBe(
      "Коллекция фильмов",
    )
    expect(linkedCollection?.getAttribute("href")).toBe("/collection.html")
    expect(staticFull?.className).not.toContain("group")
    expect(staticFull?.className).not.toContain("focus-visible:outline-none")
    expect(
      staticFull?.querySelector(
        '[data-testid="language-inventory-thumbnail-frame"]',
      ),
    ).toBeNull()
    expect(staticFull?.hasAttribute("title")).toBe(false)

    const compactFrames = container.querySelectorAll(
      '[data-testid="language-inventory-compact-thumbnail-frame"]',
    )
    expect(compactFrames).toHaveLength(1)
    const linkedCompact = compactFrames[0]?.closest("a")
    expect(linkedCompact?.className).toContain("group")
    expect(linkedCompact?.className).toContain("focus-visible:outline-none")
    expect(linkedCompact?.hasAttribute("data-english-assist")).toBe(false)
    expect(linkedCompact?.title).toBe("Open video")
    expect(linkedCompact?.getAttribute("href")).toBe("/compact.html")

    const staticCompactTitle = Array.from(
      container.querySelectorAll("span"),
    ).find((element) => element.textContent === "Статичное видео в коллекции")
    const staticCompact = staticCompactTitle?.parentElement?.parentElement
    expect(staticCompact?.tagName).toBe("DIV")
    expect(staticCompact?.className).not.toContain("group")
    expect(staticCompact?.querySelector("svg")).toBeNull()

    const subtitleSection = container.querySelector<HTMLElement>(
      '[data-testid="language-inventory-subtitle-only"]',
    )
    const subtitleLink = subtitleSection?.querySelector<HTMLAnchorElement>(
      '[aria-label="Видео только с субтитрами"]',
    )
    expect(subtitleLink?.hasAttribute("data-english-assist")).toBe(false)
    expect(subtitleLink?.title).toBe("Open video")
    expect(subtitleLink?.getAttribute("aria-label")).toBe(
      "Видео только с субтитрами",
    )
    expect(subtitleLink?.getAttribute("href")).toBe("/subtitle.html")
    expect(
      subtitleLink?.querySelector<HTMLElement>(
        '[title="Subtitles are available without dubbed audio"]',
      )?.title,
    ).toBe("Subtitles are available without dubbed audio")
    expect(
      subtitleSection?.querySelector<HTMLElement>(
        '[title="Videos with subtitles and no dubbed audio"]',
      )?.title,
    ).toBe("Videos with subtitles and no dubbed audio")

    const sectionLinks =
      container.querySelectorAll<HTMLAnchorElement>("nav a[title]")
    expect(sectionLinks).toHaveLength(6)
    expect(sectionLinks[0]?.hasAttribute("data-english-assist")).toBe(false)
    expect(sectionLinks[0]?.title).toBe("Go to new releases")
    expect(sectionLinks[0]?.getAttribute("aria-label")).toBe("Новинки: 3")
    expect(sectionLinks[0]?.getAttribute("href")).toBe("#new")
    expect(sectionLinks[5]?.hasAttribute("data-english-assist")).toBe(false)
    expect(sectionLinks[5]?.title).toBe("Go to subtitles-only videos")
    expect(sectionLinks[5]?.getAttribute("aria-label")).toBe(
      "Только субтитры: 1",
    )
    expect(sectionLinks[5]?.getAttribute("href")).toBe("#subtitles-only")

    const carouselButtons =
      container.querySelectorAll<HTMLButtonElement>("nav button[title]")
    expect(carouselButtons).toHaveLength(2)
    expect(carouselButtons[0]?.getAttribute("aria-label")).toBe(
      "Предыдущее видео в предпросмотре",
    )
    expect(carouselButtons[0]?.title).toBe("Show the previous section")
    expect(carouselButtons[1]?.getAttribute("aria-label")).toBe(
      "Следующее видео в предпросмотре",
    )
    expect(carouselButtons[1]?.title).toBe("Show the next section")

    expect(
      container.querySelector('[data-testid="english-assist-guide-trigger"]'),
    ).toBeNull()
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
    expect(container.querySelector("[data-english-assist]")).toBeNull()

    expect(
      container.querySelector('[title="Dubbed audio is available"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[title="Recently added in this language"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[title="Videos are ordered from newest to oldest"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[title="Video Bible collections"]'),
    ).not.toBeNull()
  })
})
