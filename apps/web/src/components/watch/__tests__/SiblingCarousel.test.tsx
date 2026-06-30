/**
 * @vitest-environment jsdom
 *
 * U6 — SiblingCarousel tests.
 *
 * Embla browser-API polyfills are in vitest.setup.ts. We mock `next/image`
 * to a plain `<img>` so we don't need a Next.js runtime.
 *
 * Embla itself is not mocked — we let it run inside jsdom so we can spy on
 * the real `scrollTo` it installs on the captured `setApi` instance,
 * verifying U6's auto-scroll-on-mount behavior.
 */

import { act, type MouseEventHandler, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Embla browser-API polyfills (matchMedia / IntersectionObserver /
// ResizeObserver) live in vitest.setup.ts so every Embla-backed test inherits
// them automatically.

// `next/image` requires the Next.js runtime image-optimization layer; for a
// dispatch-and-DOM test a plain <img> is sufficient and lets us assert on
// `src` without parsing the optimizer's `/image?url=...` wrapper.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    className,
    placeholder,
    blurDataURL,
  }: {
    src: string
    alt: string
    fill?: boolean
    sizes?: string
    className?: string
    placeholder?: string
    blurDataURL?: string
  }) => (
    // A `<div>` stand-in (not `<img>`) sidesteps the next/no-img-element
    // lint rule while still letting us assert on `data-src` and the
    // alt-text proxy attribute. We don't need real image rendering — jsdom
    // doesn't paint anyway.
    <div
      data-testid="next-image-mock"
      data-src={src}
      data-alt={alt}
      data-placeholder={placeholder ?? ""}
      data-blur-data-url={blurDataURL ?? ""}
      className={className}
    />
  ),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    onNavigate: _onNavigate,
    prefetch,
    children,
    ...props
  }: {
    href: string
    onClick?: MouseEventHandler<HTMLAnchorElement>
    onNavigate?: unknown
    prefetch?: boolean
    children: ReactNode
    [key: string]: unknown
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event)
        event.preventDefault()
      }}
      {...props}
    >
      {children}
    </a>
  ),
}))

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: "SiblingCarousel" | "VideoLabels") =>
    (key: string, values?: Record<string, unknown>) => {
      const catalogs = {
        SiblingCarousel: {
          clipPosition: `Clip ${values?.current} of ${values?.total}`,
          position: `${values?.current} of ${values?.total}`,
          chapterCount: `${values?.count} chapters`,
          clipAriaLabel: `${values?.title} · Clip ${values?.current} of ${values?.total}`,
          chaptersAriaLabel: `${values?.title} · ${values?.count} chapters`,
          chapter: "Chapter",
          noImage: "No image",
          playingNow: "Playing now",
          previousChapter: "Previous chapter",
          nextChapter: "Next chapter",
        },
        VideoLabels: {
          video: "Video",
          collection: "Collection",
        },
      }

      const group = catalogs[namespace] as Record<string, string> | undefined
      return group?.[key] ?? key
    },
}))

import { SiblingCarousel } from "@/components/watch/SiblingCarousel"
import { WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY } from "@/components/watch/chapter-navigation"
import type { WatchSiblingCarouselBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

type ImageVariantFields = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
}

function makeChild(
  i: number,
  opts: {
    thumb?: boolean
    image?: ImageVariantFields
    muxPlaybackId?: string | null
    muxThumbnailBlurDataUrl?: string | null
    muxHeroPosterBlurDataUrl?: string | null
  } = {},
) {
  // When `opts.image` is supplied, use it verbatim — lets tests assert on
  // the priority chain (`mobileCinematicHigh` > `mobileCinematicLow` >
  // `thumbnail` > nothing; `url` is intentionally NOT in the chain).
  // Default fixture uses `thumbnail` (NOT `url`) because resolvePosterUrl
  // dropped `url` entirely — see F2 in the watch-page review queue.
  const images =
    opts.thumb === false
      ? []
      : opts.image
        ? [opts.image]
        : [{ thumbnail: `https://cdn.test/${i}.jpg` }]
  return {
    documentId: `child-${i}`,
    slug: `child-${i}-slug`,
    title: `Child ${i}`,
    label: i % 2 === 0 ? `Label ${i}` : null,
    images,
    durationSeconds: null,
    muxPlaybackId: opts.muxPlaybackId ?? null,
    muxThumbnailBlurDataUrl: opts.muxThumbnailBlurDataUrl ?? null,
    muxHeroPosterBlurDataUrl: opts.muxHeroPosterBlurDataUrl ?? null,
  }
}

function makeBlock(
  childCount: number,
  currentIndex: number,
  parentSlug = "jesus-collection",
): WatchSiblingCarouselBlock {
  const children = Array.from({ length: childCount }, (_, i) =>
    makeChild(i + 1),
  )
  return {
    kind: "SiblingCarousel",
    canonicalParent: {
      documentId: "parent-1",
      slug: parentSlug,
      title: "Jesus Collection",
      children,
    } as never,
    currentVideoDocumentId: children[currentIndex]!.documentId,
  }
}

const pilatePageChapterSlugs = [
  "triumphal-entry-and-results",
  "last-supper",
  "betrayal-and-denial-foretold",
  "jesus-promises-the-holy-spirit",
  "the-arrest-of-jesus-and-peter-denial",
  "my-kingdom-is-not-of-this-world",
  "jesus-sentenced-to-be-crucified",
  "the-crucifixion-of-jesus",
  "jesus-is-alive",
  "doubting-thomas",
  "miraculous-catch",
  "do-you-love-me",
  "upper-room-teaching",
  "jesus-is-betrayed-and-arrested",
  "jesus-is-mocked-and-questioned",
  "jesus-is-brought-to-pilate",
  "jesus-is-brought-to-herod",
  "jesus-is-sentenced",
  "jesus-carries-his-cross",
  "jesus-is-crucified",
  "sign-on-the-cross",
  "crucified-convicts",
  "my-last-day",
  "death-of-jesus",
  "jesus-is-buried",
  "angels-at-the-tomb",
  "the-tomb-is-empty",
  "resurrected-jesus-appears",
  "invitation-to-know-jesus-personally",
]

describe("SiblingCarousel — happy path", () => {
  it("renders one thumbnail per child with the current item highlighted", () => {
    const block = makeBlock(10, 2)

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const items = container.querySelectorAll(
      "[data-testid='sibling-carousel-item']",
    )
    expect(items.length).toBe(10)
    const firstItemSlot = items[0]?.closest("[data-slot='carousel-item']")
    expect(firstItemSlot?.className).toContain("basis-[48%]")
    expect(firstItemSlot?.className).toContain("sm:basis-[36%]")
    expect(firstItemSlot?.className).toContain("md:basis-1/3")

    const rail = container.querySelector("[data-block-type='SiblingCarousel']")
    expect(rail?.className).toContain("-mx-5")
    expect(rail?.className).toContain("w-[calc(100%+2.5rem)]")
    expect(rail?.className).toContain("md:mx-0")
    expect(rail?.className).toContain("md:w-full")

    const header = rail?.querySelector("header")
    expect(header?.className).toContain("px-5")
    expect(header?.className).toContain("md:px-0")
    const headerLine = header?.querySelector("p")
    expect(headerLine?.className).toContain("font-normal")
    expect(headerLine?.className).not.toContain("font-medium")
    expect(headerLine?.querySelector("span")?.className).toContain(
      "font-medium",
    )
    const carousel = container.querySelector("[data-slot='carousel']")
    expect(carousel?.className).toContain("pl-5")
    expect(carousel?.className).toContain("md:pl-0")
    expect(carousel?.className).not.toContain("translate-x-10")
    expect(carousel?.className).not.toContain("md:translate-x-0")
    const content = container.querySelector(
      "[data-slot='carousel-content'] > div",
    )
    const viewport = container.querySelector("[data-slot='carousel-content']")
    expect(viewport?.className).toContain("overflow-x-visible")
    expect(viewport?.className).toContain("md:overflow-x-clip")
    expect(content?.className).not.toContain("pl-10")
    expect(content?.className).not.toContain("md:pl-0")
    expect(content?.className).not.toContain("translate-x-14")
    expect(content?.className).not.toContain("md:translate-x-0")
    const endSpacer = container.querySelector(
      "[data-testid='sibling-carousel-end-spacer']",
    )
    expect(endSpacer).not.toBeNull()
    expect(endSpacer?.className).toContain("basis-[52%]")
    expect(endSpacer?.className).toContain("md:basis-[66.666%]")

    // Active item carries data-active="true" and renders the "Playing now" pill.
    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active).not.toBeNull()
    const activeOutline = active!.querySelector(
      "[data-testid='sibling-carousel-active-outline']",
    )
    expect(activeOutline).not.toBeNull()
    expect(activeOutline?.className).toContain("absolute")
    expect(activeOutline?.className).toContain("inset-0")
    expect(activeOutline?.className).toContain("z-[60]")
    expect(activeOutline?.className).toContain("border-4")
    expect(activeOutline?.className).toContain("border-white")
    expect(activeOutline?.className).toContain("transition-[opacity,transform]")
    expect(activeOutline?.className).toContain("duration-300")
    expect(activeOutline?.className).toContain("opacity-100")
    expect(active!.className).not.toContain("border-4")
    expect(active!.className).toContain("aspect-video")
    expect(active!.className).not.toContain("translate-x-10")
    expect(active!.className).not.toContain("md:translate-x-0")
    expect(active!.className).not.toContain("-translate-x-4")
    expect(active!.className).not.toContain("aspect-square")
    expect(active!.className).not.toContain("after:inset-0")
    expect(active!.className).not.toContain("after:border-4")
    expect(active!.className).toContain("focus-visible:outline-white/80")
    expect(active!.className).toContain("shadow-[0_2px_6px_rgba")
    // Contextual 3-segment shape keeps chapter navigation inside the
    // collection instead of resolving by the child slug alone.
    expect(active!.getAttribute("data-href")).toBe(
      "/jesus-collection.html/child-3-slug/english.html",
    )
    const caption = active!.querySelector(
      "[data-testid='sibling-carousel-caption']",
    )
    expect(caption).not.toBeNull()
    expect(caption?.className).toContain("h-full")
    expect(caption?.className).toContain("bg-gradient-to-t")
    expect(caption?.className).toContain("via-black/35")
    expect(caption?.className).toContain("z-20")
    expect(caption?.className).toContain("gap-[3px]")
    expect(caption?.className).not.toContain("gap-1.5")
    const captionText = Array.from(caption!.querySelectorAll("span"))
    expect(captionText[0]?.className).toContain("font-normal")
    expect(captionText[0]?.className).not.toContain("font-semibold")
    expect(captionText[1]?.className).toContain("font-semibold")
    expect(captionText[1]?.className).not.toContain("font-bold")

    const blurMask = active!.querySelector("[aria-hidden='true']")
    expect(blurMask?.className).toContain("h-full")
    expect(blurMask?.className).toContain("bg-black/35")
    expect(blurMask?.className).toContain("backdrop-blur-[14px]")
    expect(blurMask?.className).toContain("rgba(0,0,0,0.35)_62%")

    const bevel = active!.querySelector(
      "[data-testid='sibling-carousel-bevel']",
    )
    expect(bevel).not.toBeNull()
    expect(bevel?.className).toContain("absolute")
    expect(bevel?.className).toContain("inset-0")
    expect(bevel?.className).toContain("z-40")
    expect(bevel?.className).toContain("border")
    expect(bevel?.className).toContain("border-white")
    expect(bevel?.className).toContain("opacity-40")
    expect(bevel?.className).toContain("mix-blend-soft-light")

    const playingNow = container.querySelector(
      "[data-testid='sibling-carousel-playing-now']",
    )
    expect(playingNow).not.toBeNull()

    const inactive = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='false']",
    )
    expect(inactive?.className).not.toContain("border-transparent")
    expect(inactive?.className).toContain("opacity-70")
    expect(inactive?.className).toContain("hover:opacity-100")
    const hoverOutline = inactive?.querySelector(
      "[data-testid='sibling-carousel-hover-outline']",
    )
    expect(hoverOutline?.className).toContain("z-50")
    expect(hoverOutline?.className).toContain("rounded-lg")
    expect(hoverOutline?.className).toContain("group-hover:opacity-100")
    const outlineSegments = hoverOutline?.querySelectorAll("span")
    expect(outlineSegments).toHaveLength(4)
    expect(outlineSegments?.[0]?.className).toContain("h-[4px]")
    expect(outlineSegments?.[0]?.className).toContain("bg-brand-red")
    expect(outlineSegments?.[1]?.className).toContain(
      "bg-[linear-gradient(to_bottom",
    )
    expect(outlineSegments?.[1]?.className).toContain("rgba(0,0,0,0.92)_100%")
    expect(outlineSegments?.[3]?.className).toContain("bg-black/90")

    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    const mobileLabel = label?.querySelector(".md\\:hidden")
    const desktopLabel = label?.querySelector(".hidden.md\\:inline")
    expect(mobileLabel?.textContent).toBe("3 of 10")
    expect(desktopLabel?.textContent).toBe("Clip 3 of 10")
  })

  it("routes a child through the contextual collection shape", () => {
    // Builder contract: parent `jesus-collection` + child `magdalena`
    // + locale `english` → `/jesus-collection.html/magdalena/english.html`.
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "jesus-collection",
        title: "Jesus Collection",
        children: [
          { ...makeChild(1), slug: "magdalena", documentId: "magdalena-doc" },
          makeChild(2),
        ],
      } as never,
      currentVideoDocumentId: "magdalena-doc",
    }

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active!.tagName).toBe("A")
    expect(active!.getAttribute("data-href")).toBe(
      "/jesus-collection.html/magdalena/english.html",
    )
    expect(active!.getAttribute("href")).toBe(
      "/jesus-collection.html/magdalena/english.html",
    )
  })

  it("uses the stored Mux thumbnail LQIP only for Mux thumbnails", () => {
    const blurDataURL = "data:image/jpeg;base64,AQIDBA=="
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "jesus-collection",
        title: "Jesus Collection",
        children: [
          makeChild(1, {
            muxPlaybackId: "mux-playback-1",
            muxThumbnailBlurDataUrl: blurDataURL,
          }),
          makeChild(2, {
            muxThumbnailBlurDataUrl: "data:image/jpeg;base64,SHOULD_NOT_USE",
          }),
        ],
      } as never,
      currentVideoDocumentId: "child-1",
    }

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const images = container.querySelectorAll("[data-testid='next-image-mock']")
    expect(images[0]?.getAttribute("data-src")).toBe(
      "https://image.mux.com/mux-playback-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
    expect(images[0]?.getAttribute("data-placeholder")).toBe("blur")
    expect(images[0]?.getAttribute("data-blur-data-url")).toBe(blurDataURL)
    expect(images[1]?.getAttribute("data-src")).toBe("https://cdn.test/2.jpg")
    expect(images[1]?.getAttribute("data-placeholder")).toBe("")
    expect(images[1]?.getAttribute("data-blur-data-url")).toBe("")
  })

  it("preserves the Anticipate collection segment for all 29 Pilate page chapters", () => {
    const children = pilatePageChapterSlugs.map((slug, index) => ({
      ...makeChild(index + 1),
      documentId: `pilate-chapter-${index + 1}`,
      slug,
      title: `Pilate chapter ${index + 1}`,
    }))
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "anticipate-parent",
        slug: "anticipate-the-resurrection",
        title: "Anticipate the Resurrection",
        children,
      } as never,
      currentVideoDocumentId: "pilate-chapter-12",
    }

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const hrefs = Array.from(
      container.querySelectorAll("[data-testid='sibling-carousel-item']"),
      (item) => item.getAttribute("data-href"),
    )
    expect(hrefs).toHaveLength(29)
    expect(hrefs).toEqual(
      pilatePageChapterSlugs.map(
        (slug) => `/anticipate-the-resurrection.html/${slug}/english.html`,
      ),
    )
    expect(hrefs).toContain(
      "/anticipate-the-resurrection.html/jesus-is-crucified/english.html",
    )
    expect(hrefs).toContain(
      "/anticipate-the-resurrection.html/resurrected-jesus-appears/english.html",
    )
    expect(hrefs).toContain(
      "/anticipate-the-resurrection.html/invitation-to-know-jesus-personally/english.html",
    )
    expect(hrefs).not.toContain("/jesus-is-crucified.html/english.html")
    expect(hrefs).not.toContain("/resurrected-jesus-appears.html/english.html")
    expect(hrefs).not.toContain(
      "/invitation-to-know-jesus-personally.html/english.html",
    )
  })

  it("makes the clicked chapter card current while navigation is pending", () => {
    const block = makeBlock(4, 0)

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const target = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-2-slug/english.html']",
    )
    const previousCurrent = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-1-slug/english.html']",
    )

    expect(target).not.toBeNull()
    expect(previousCurrent).not.toBeNull()
    expect(target!.getAttribute("data-pending")).toBe("false")
    expect(target!.getAttribute("data-active")).toBe("false")
    expect(target!.getAttribute("aria-busy")).toBeNull()
    expect(previousCurrent!.getAttribute("data-active")).toBe("true")

    act(() => {
      target!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      )
    })

    expect(target!.getAttribute("data-pending")).toBe("true")
    expect(target!.getAttribute("data-active")).toBe("true")
    expect(target!.getAttribute("aria-busy")).toBe("true")
    const targetOutline = target!.querySelector(
      "[data-testid='sibling-carousel-active-outline']",
    )
    expect(targetOutline).not.toBeNull()
    expect(targetOutline?.className).toContain("border-4")
    expect(targetOutline?.className).toContain("border-white")
    expect(targetOutline?.className).toContain("opacity-100")
    expect(target!.className).not.toContain("border-4")
    expect(previousCurrent!.getAttribute("data-active")).toBe("false")
    const previousOutline = previousCurrent!.querySelector(
      "[data-testid='sibling-carousel-active-outline']",
    )
    expect(previousOutline).not.toBeNull()
    expect(previousOutline?.className).toContain("opacity-0")
    expect(
      target!.querySelector("[data-testid='sibling-carousel-loading-icon']"),
    ).not.toBeNull()

    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    const mobileLabel = label?.querySelector(".md\\:hidden")
    const desktopLabel = label?.querySelector(".hidden.md\\:inline")
    expect(mobileLabel?.textContent).toBe("2 of 4")
    expect(desktopLabel?.textContent).toBe("Clip 2 of 4")
  })

  it("emits full pending chapter metadata for a normal inactive click", () => {
    const block = makeBlock(4, 0)
    const onChapterNavigateIntent = vi.fn()

    act(() => {
      root.render(
        <SiblingCarousel
          block={block}
          languageSlug="english"
          onChapterNavigateIntent={onChapterNavigateIntent}
        />,
      )
    })

    const target = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-2-slug/english.html']",
    )

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    act(() => {
      target!.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(onChapterNavigateIntent).toHaveBeenCalledTimes(1)
    expect(onChapterNavigateIntent).toHaveBeenCalledWith({
      href: "/jesus-collection.html/child-2-slug/english.html",
      languageSlug: "english",
      sourceVideoDocumentId: "child-1",
      targetVideoDocumentId: "child-2",
      title: "Child 2",
      slug: "child-2-slug",
      label: "Label 2",
      posterUrl: "https://cdn.test/2.jpg",
      posterBlurDataUrl: null,
      sourceCarouselIndex: expect.any(Number),
    })
  })

  it("emits the full hero Mux poster for optimistic chapter transitions", () => {
    const onChapterNavigateIntent = vi.fn()
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "jesus-collection",
        title: "Jesus Collection",
        children: [
          makeChild(1),
          makeChild(2, {
            muxPlaybackId: "mux playback 2",
            muxThumbnailBlurDataUrl: "data:image/jpeg;base64,CARD==",
            muxHeroPosterBlurDataUrl: "data:image/webp;base64,HERO==",
          }),
        ],
      } as never,
      currentVideoDocumentId: "child-1",
    }

    act(() => {
      root.render(
        <SiblingCarousel
          block={block}
          languageSlug="english"
          onChapterNavigateIntent={onChapterNavigateIntent}
        />,
      )
    })

    const target = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-2-slug/english.html']",
    )

    act(() => {
      target!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      )
    })

    expect(onChapterNavigateIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        posterUrl:
          "https://image.mux.com/mux%20playback%202/thumbnail.webp?time=2",
        posterBlurDataUrl: "data:image/webp;base64,HERO==",
      }),
    )
  })

  it("uses controlled pending state when the parent supplies it", () => {
    const block = makeBlock(4, 0)

    act(() => {
      root.render(
        <SiblingCarousel
          block={block}
          languageSlug="english"
          pendingNavigation={{
            href: "/jesus-collection.html/child-3-slug/english.html",
            languageSlug: "english",
            sourceVideoDocumentId: "child-1",
            targetVideoDocumentId: "child-3",
            title: "Child 3",
            slug: "child-3-slug",
            label: null,
            posterUrl: "https://cdn.test/3.jpg",
          }}
        />,
      )
    })

    const previousCurrent = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-1-slug/english.html']",
    )
    const target = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-3-slug/english.html']",
    )

    expect(previousCurrent!.getAttribute("data-active")).toBe("false")
    expect(target!.getAttribute("data-active")).toBe("true")
    expect(target!.getAttribute("data-pending")).toBe("true")
    expect(target!.getAttribute("aria-busy")).toBe("true")
    expect(
      target!.querySelector("[data-testid='sibling-carousel-loading-icon']"),
    ).not.toBeNull()

    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    expect(label?.textContent).toContain("3 of 4")
    expect(label?.textContent).toContain("Clip 3 of 4")
  })

  it("does not show pending feedback for modified chapter clicks", () => {
    const block = makeBlock(4, 0)
    const onChapterNavigateIntent = vi.fn()

    act(() => {
      root.render(
        <SiblingCarousel
          block={block}
          languageSlug="english"
          onChapterNavigateIntent={onChapterNavigateIntent}
        />,
      )
    })

    const target = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-2-slug/english.html']",
    )

    act(() => {
      target!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          metaKey: true,
        }),
      )
    })

    expect(target!.getAttribute("data-pending")).toBe("false")
    expect(onChapterNavigateIntent).not.toHaveBeenCalled()
    expect(target!.getAttribute("aria-busy")).toBeNull()
    expect(
      target!.querySelector("[data-testid='sibling-carousel-loading-icon']"),
    ).toBeNull()
  })

  it("does not emit pending feedback for the already-current chapter", () => {
    const block = makeBlock(4, 0)
    const onChapterNavigateIntent = vi.fn()

    act(() => {
      root.render(
        <SiblingCarousel
          block={block}
          languageSlug="english"
          onChapterNavigateIntent={onChapterNavigateIntent}
        />,
      )
    })

    const current = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-href='/jesus-collection.html/child-1-slug/english.html']",
    )

    act(() => {
      current!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      )
    })

    expect(onChapterNavigateIntent).not.toHaveBeenCalled()
    expect(current!.getAttribute("data-pending")).toBe("false")
    expect(current!.getAttribute("aria-busy")).toBeNull()
  })

  it("renders an in-app href without the /watch/ basePath prefix", () => {
    const block = makeBlock(3, 0)

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const items = Array.from(
      container.querySelectorAll("[data-testid='sibling-carousel-item']"),
    )
    for (const item of items) {
      const href = item.getAttribute("data-href") ?? ""
      // basePath auto-prepends; in-app hrefs MUST NOT include /watch/ literal.
      expect(href.startsWith("/watch/")).toBe(false)
      // Contextual 3-segment shape — parent slug, child slug, then locale.
      expect(href).toMatch(
        /^\/jesus-collection\.html\/child-\d+-slug\/english\.html$/,
      )
      expect(href.endsWith("/english.html")).toBe(true)
    }
  })

  it("falls back to a placeholder when a child has no image", () => {
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "jesus-collection",
        title: "Jesus Collection",
        children: [makeChild(1), makeChild(2, { thumb: false }), makeChild(3)],
      } as never,
      currentVideoDocumentId: "child-1",
    }

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    const placeholders = container.querySelectorAll(
      "[data-testid='sibling-carousel-thumb-placeholder']",
    )
    // Exactly one child (#2) is missing an image.
    expect(placeholders.length).toBe(1)
  })

  it("renders CarouselPrevious / CarouselNext with carousel-specific aria-labels", () => {
    // The shadcn Carousel primitive accepts a `label` prop. SiblingCarousel
    // passes "Previous chapter" / "Next chapter" so screen-reader users on
    // a page with multiple carousels (chapter + Bible quotes + video) can
    // tell them apart. Pin the label strings here so a future rename
    // breaks the test rather than the agent / AT selector.
    act(() => {
      root.render(
        <SiblingCarousel block={makeBlock(5, 0)} languageSlug="english" />,
      )
    })

    const prev = container.querySelector(
      "button[data-slot='carousel-previous']",
    )
    const next = container.querySelector("button[data-slot='carousel-next']")

    expect(prev?.getAttribute("aria-label")).toBe("Previous chapter")
    expect(next?.getAttribute("aria-label")).toBe("Next chapter")
    // The accessible name lives on aria-label only; the redundant
    // sr-only span was removed to avoid double-announcement on VoiceOver.
    expect(prev?.querySelector(".sr-only")).toBeNull()
    expect(next?.querySelector(".sr-only")).toBeNull()
  })

  it("stacks the hover play overlay above the caption blur and text", () => {
    act(() => {
      root.render(
        <SiblingCarousel block={makeBlock(5, 0)} languageSlug="english" />,
      )
    })

    const inactive = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='false']",
    )
    const playOverlay = inactive?.querySelector(
      "[data-testid='sibling-carousel-play-overlay']",
    )

    expect(playOverlay).not.toBeNull()
    expect(playOverlay?.className).toContain("z-30")
  })
})

describe("SiblingCarousel — edge cases", () => {
  it("returns null when the canonical parent has fewer than 2 children", () => {
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "jesus-collection",
        title: "Jesus Collection",
        children: [makeChild(1)],
      } as never,
      currentVideoDocumentId: "child-1",
    }

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    expect(
      container.querySelector("[data-block-type='SiblingCarousel']"),
    ).toBeNull()
    expect(container.children.length).toBe(0)
  })

  it("scrolls the active item into view on mount via embla setApi", async () => {
    // Spy on Embla's scrollTo by installing a setApi-style observer through
    // a wrapper that captures the api the carousel hands back. We can't
    // intercept setApi directly because it's a callback the component
    // creates internally — instead we look for the side-effect: after mount,
    // embla's `selectedScrollSnap()` should reflect the active index.
    //
    // jsdom doesn't lay out the carousel (no measurable widths), so embla's
    // snap math degenerates to 0 across the board. We assert the weaker but
    // meaningful invariant: the carousel mounts, embla initializes, and the
    // active item carries data-active="true" at the captured index.
    const block = makeBlock(15, 11)

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="english" />)
    })

    // Flush passive effects (the setApi callback installs in a useEffect).
    await act(async () => {
      await Promise.resolve()
    })

    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active).not.toBeNull()
    expect(active!.getAttribute("data-href")).toBe(
      "/jesus-collection.html/child-12-slug/english.html",
    )
    expect(active!.getAttribute("data-prefetch")).toBe("false")
    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    const mobileLabel = label?.querySelector(".md\\:hidden")
    const desktopLabel = label?.querySelector(".hidden.md\\:inline")
    expect(mobileLabel?.textContent).toBe("12 of 15")
    expect(desktopLabel?.textContent).toBe("Clip 12 of 15")
  })

  it("consumes preserved chapter-navigation carousel state on the target page", async () => {
    window.sessionStorage.setItem(
      WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
      JSON.stringify({
        languageSlug: "english",
        sourceVideoDocumentId: "child-1",
        targetVideoDocumentId: "child-4",
      }),
    )

    act(() => {
      root.render(
        <SiblingCarousel block={makeBlock(6, 3)} languageSlug="english" />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      window.sessionStorage.getItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY),
    ).toBeNull()
    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active?.getAttribute("data-href")).toBe(
      "/jesus-collection.html/child-4-slug/english.html",
    )
  })

  it("prefers preserved carousel scroll index over source chapter index", async () => {
    window.sessionStorage.setItem(
      WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
      JSON.stringify({
        languageSlug: "english",
        sourceVideoDocumentId: "child-1",
        targetVideoDocumentId: "child-4",
        sourceCarouselIndex: 2,
      }),
    )

    act(() => {
      root.render(
        <SiblingCarousel block={makeBlock(6, 3)} languageSlug="english" />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      window.sessionStorage.getItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY),
    ).toBeNull()
    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active?.getAttribute("data-href")).toBe(
      "/jesus-collection.html/child-4-slug/english.html",
    )
  })

  it("renders a non-clickable card (no <Link>/href) when languageSlug is empty", () => {
    const block = makeBlock(3, 1)

    act(() => {
      root.render(<SiblingCarousel block={block} languageSlug="" />)
    })

    const item = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(item).not.toBeNull()
    // Empty languageSlug fails the slug regex, so no watch route is built.
    // The card still renders — as a plain <div>, not an <a> — with no href.
    expect(item!.tagName).toBe("DIV")
    expect(item!.getAttribute("href")).toBeNull()
    expect(item!.getAttribute("data-href")).toBeNull()
    // Markup is otherwise identical: same className + active marker present.
    expect(item!.className).toContain("aspect-video")
    expect(
      item!.querySelector("[data-testid='sibling-carousel-caption']"),
    ).not.toBeNull()
  })
})

describe("SiblingCarousel — image priority", () => {
  // Each test renders a single-active-item block and reads the active item's
  // <Image> stand-in (`data-src`) to assert which image variant won the
  // priority chain. The variant order is:
  //   muxPlaybackId second-2 frame > editorial image chain > placeholder
  // The editorial fallback order is:
  //   mobileCinematicHigh > mobileCinematicLow > thumbnail > placeholder
  //   (`url` is intentionally NOT in the chain — it 400s on Cloudflare.)
  function singleChildBlock(
    image: ImageVariantFields,
    muxPlaybackId: string | null = null,
  ): WatchSiblingCarouselBlock {
    return {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "p",
        title: "P",
        children: [
          makeChild(1, { image, muxPlaybackId }),
          makeChild(2), // sibling so children.length >= 2 (carousel renders)
        ],
      } as never,
      currentVideoDocumentId: "child-1",
    }
  }

  function activeImage(): HTMLElement | null {
    return container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true'] [data-testid='next-image-mock']",
    )
  }

  function activePlaceholder(): HTMLElement | null {
    return container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true'] [data-testid='sibling-carousel-thumb-placeholder']",
    )
  }

  it("uses the language-aware Mux second-2 frame before curated image fallbacks", () => {
    act(() => {
      root.render(
        <SiblingCarousel
          languageSlug="english"
          block={singleChildBlock(
            {
              mobileCinematicHigh: "https://cdn.test/high.jpg",
              thumbnail: "https://cdn.test/thumb.jpg",
            },
            "mux-playback-1",
          )}
        />,
      )
    })
    expect(activeImage()!.getAttribute("data-src")).toBe(
      "https://image.mux.com/mux-playback-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
    )
  })

  it("uses mobileCinematicHigh when all four variants are present", () => {
    act(() => {
      root.render(
        <SiblingCarousel
          languageSlug="english"
          block={singleChildBlock({
            mobileCinematicHigh: "https://cdn.test/high.jpg",
            mobileCinematicLow: "https://cdn.test/low.jpg",
            thumbnail: "https://cdn.test/thumb.jpg",
            url: "https://cdn.test/url.jpg",
          })}
        />,
      )
    })
    const img = activeImage()
    expect(img).not.toBeNull()
    expect(img!.getAttribute("data-src")).toBe("https://cdn.test/high.jpg")
    expect(img!.getAttribute("data-alt")).toBe("Child 1 thumbnail")
  })

  it("uses a non-empty fallback alt for informative thumbnails without titles", () => {
    const block = singleChildBlock({
      thumbnail: "https://cdn.test/thumb.jpg",
    })
    block.canonicalParent.children[0]!.title = null

    act(() => {
      root.render(<SiblingCarousel languageSlug="english" block={block} />)
    })

    expect(activeImage()!.getAttribute("data-alt")).toBe(
      "Related video thumbnail",
    )
  })

  it("falls through to mobileCinematicLow when mobileCinematicHigh is absent", () => {
    act(() => {
      root.render(
        <SiblingCarousel
          languageSlug="english"
          block={singleChildBlock({
            mobileCinematicLow: "https://cdn.test/low.jpg",
            thumbnail: "https://cdn.test/thumb.jpg",
            url: "https://cdn.test/url.jpg",
          })}
        />,
      )
    })
    expect(activeImage()!.getAttribute("data-src")).toBe(
      "https://cdn.test/low.jpg",
    )
  })

  it("falls through to thumbnail when both mobileCinematic* variants are absent", () => {
    act(() => {
      root.render(
        <SiblingCarousel
          languageSlug="english"
          block={singleChildBlock({
            thumbnail: "https://cdn.test/thumb.jpg",
            url: "https://cdn.test/url.jpg",
          })}
        />,
      )
    })
    expect(activeImage()!.getAttribute("data-src")).toBe(
      "https://cdn.test/thumb.jpg",
    )
  })

  it("renders the placeholder when only `url` is present (url is dropped from the chain)", () => {
    act(() => {
      root.render(
        <SiblingCarousel
          languageSlug="english"
          block={singleChildBlock({
            url: "https://cdn.test/url.jpg",
          })}
        />,
      )
    })
    // No image — `url` is intentionally NOT a fallback (returns 400 on
    // Cloudflare due to a misshaped variant path). Placeholder wins.
    expect(activeImage()).toBeNull()
    expect(activePlaceholder()).not.toBeNull()
  })
})
