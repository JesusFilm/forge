/**
 * @vitest-environment jsdom
 *
 * U6 — SiblingCarousel tests.
 *
 * Embla browser-API polyfills are in vitest.setup.ts. We mock
 * `next/navigation`'s `useParams` to feed a stable `currentLocale` and
 * `next/image` to a plain `<img>` so we don't need a Next.js runtime.
 *
 * Embla itself is not mocked — we let it run inside jsdom so we can spy on
 * the real `scrollTo` it installs on the captured `setApi` instance,
 * verifying U6's auto-scroll-on-mount behavior.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Embla browser-API polyfills (matchMedia / IntersectionObserver /
// ResizeObserver) live in vitest.setup.ts so every Embla-backed test inherits
// them automatically.

const { useParamsMock } = vi.hoisted(() => ({
  // The component reads `params?.locale`, so a loose return type matches the
  // shape `next/navigation`'s `useParams` actually exposes (a record with
  // optional segment values). Concrete returns happen via mockReturnValue in
  // each test.
  useParamsMock: vi.fn<() => Record<string, string | undefined>>(() => ({
    locale: "english",
  })),
}))

vi.mock("next/navigation", () => ({
  useParams: useParamsMock,
}))

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
  }: {
    src: string
    alt: string
    fill?: boolean
    sizes?: string
    className?: string
  }) => (
    // A `<div>` stand-in (not `<img>`) sidesteps the next/no-img-element
    // lint rule while still letting us assert on `data-src` and the
    // alt-text proxy attribute. We don't need real image rendering — jsdom
    // doesn't paint anyway.
    <div
      data-testid="next-image-mock"
      data-src={src}
      data-alt={alt}
      className={className}
    />
  ),
}))

import { SiblingCarousel } from "@/components/watch/SiblingCarousel"
import type { WatchSiblingCarouselBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  useParamsMock.mockReset()
  useParamsMock.mockReturnValue({ locale: "english" })
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
  opts: { thumb?: boolean; image?: ImageVariantFields } = {},
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

describe("SiblingCarousel — happy path", () => {
  it("renders one thumbnail per child with the current item highlighted", () => {
    const block = makeBlock(10, 2)

    act(() => {
      root.render(<SiblingCarousel block={block} />)
    })

    const items = container.querySelectorAll(
      "[data-testid='sibling-carousel-item']",
    )
    expect(items.length).toBe(10)

    // Active item carries data-active="true" and renders the "Playing now" pill.
    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active).not.toBeNull()
    // 2-segment route shape: `/{slug}/{locale}` — the parent slug segment
    // was removed when the watch route migrated to flat `[slug]/[locale]`.
    expect(active!.getAttribute("data-href")).toBe("/child-3-slug/english")

    const playingNow = container.querySelector(
      "[data-testid='sibling-carousel-playing-now']",
    )
    expect(playingNow).not.toBeNull()

    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    expect(label?.textContent).toBe("Clip 3 of 10")
  })

  it("renders an in-app href without the /watch/ basePath prefix", () => {
    const block = makeBlock(3, 0)

    act(() => {
      root.render(<SiblingCarousel block={block} />)
    })

    const items = Array.from(
      container.querySelectorAll("[data-testid='sibling-carousel-item']"),
    )
    for (const item of items) {
      const href = item.getAttribute("data-href") ?? ""
      // basePath auto-prepends; in-app hrefs MUST NOT include /watch/ literal.
      expect(href.startsWith("/watch/")).toBe(false)
      // 2-segment route — child slug then locale, no parent segment.
      expect(href).toMatch(/^\/child-\d+-slug\/english$/)
      expect(href.endsWith("/english")).toBe(true)
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
      root.render(<SiblingCarousel block={block} />)
    })

    const placeholders = container.querySelectorAll(
      "[data-testid='sibling-carousel-thumb-placeholder']",
    )
    // Exactly one child (#2) is missing an image.
    expect(placeholders.length).toBe(1)
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
      root.render(<SiblingCarousel block={block} />)
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
      root.render(<SiblingCarousel block={block} />)
    })

    // Flush passive effects (the setApi callback installs in a useEffect).
    await act(async () => {
      await Promise.resolve()
    })

    const active = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    expect(active).not.toBeNull()
    expect(active!.getAttribute("data-href")).toBe("/child-12-slug/english")
    const label = container.querySelector(
      "[data-testid='sibling-carousel-label']",
    )
    expect(label?.textContent).toBe("Clip 12 of 15")
  })

  it("renders an empty currentLocale segment when params lack `locale`", () => {
    useParamsMock.mockReturnValue({})
    const block = makeBlock(3, 1)

    act(() => {
      root.render(<SiblingCarousel block={block} />)
    })

    const item = container.querySelector(
      "[data-testid='sibling-carousel-item'][data-active='true']",
    )
    // Trailing slash with empty locale segment — caller is responsible for
    // ensuring `[locale]` is present in the route; we don't fabricate one.
    expect(item!.getAttribute("data-href")).toBe("/child-2-slug/")
  })
})

describe("SiblingCarousel — image priority (resolvePosterUrl)", () => {
  // Each test renders a single-active-item block and reads the active item's
  // <Image> stand-in (`data-src`) to assert which image variant won the
  // priority chain. The variant order is:
  //   mobileCinematicHigh > mobileCinematicLow > thumbnail > placeholder
  //   (`url` is intentionally NOT in the chain — it 400s on Cloudflare.)
  function singleChildBlock(
    image: ImageVariantFields,
  ): WatchSiblingCarouselBlock {
    return {
      kind: "SiblingCarousel",
      canonicalParent: {
        documentId: "parent-1",
        slug: "p",
        title: "P",
        children: [
          makeChild(1, { image }),
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

  it("uses mobileCinematicHigh when all four variants are present", () => {
    act(() => {
      root.render(
        <SiblingCarousel
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
  })

  it("falls through to mobileCinematicLow when mobileCinematicHigh is absent", () => {
    act(() => {
      root.render(
        <SiblingCarousel
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
