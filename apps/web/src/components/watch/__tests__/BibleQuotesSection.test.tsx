/**
 * @vitest-environment jsdom
 *
 * U8 — BibleQuotesSection tests.
 *
 * Covers:
 *  - Empty bibleCitations[] → still renders the hardcoded promo CTA.
 *  - 2 citations → renders 3 list items (2 references + 1 hardcoded promo).
 *  - Reference labels are produced by `formatCitation()` (verified against
 *    the canonical "Galatians 2:20" sample from the live data and a
 *    cross-chapter range).
 *  - Admin-resolved passages render inline in the card with Bible.com links.
 *  - Click on the in-section Share button calls `onShareClick`.
 *  - Section emits `data-block-type="BibleQuotes"` so the U4 dispatch
 *    contract still holds when the section component owns the element.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { emblaApi, emblaHandlers, emblaRefMock } = vi.hoisted(() => {
  const handlers: Record<string, Set<(api: unknown) => void>> = {
    reInit: new Set(),
    select: new Set(),
  }
  const api = {
    canScrollNext: vi.fn(() => true),
    canScrollPrev: vi.fn(() => false),
    off: vi.fn((event: string, handler: (api: unknown) => void) => {
      handlers[event]?.delete(handler)
    }),
    on: vi.fn((event: string, handler: (api: unknown) => void) => {
      handlers[event]?.add(handler)
    }),
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    selectedScrollSnap: vi.fn(() => 0),
  }

  return {
    emblaApi: api,
    emblaHandlers: handlers,
    emblaRefMock: vi.fn(),
  }
})

vi.mock("embla-carousel-react", () => ({
  default: () => [emblaRefMock, emblaApi],
}))

vi.mock("@/components/DirectionProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/DirectionProvider")>()
  return { ...actual, useDirection: () => "ltr" }
})

import { BibleQuotesSection } from "@/components/watch/BibleQuotesSection"
import {
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import type { WatchBibleQuotesBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  emblaRefMock.mockClear()
  emblaApi.canScrollNext.mockReturnValue(true)
  emblaApi.canScrollPrev.mockReturnValue(false)
  emblaApi.off.mockClear()
  emblaApi.on.mockClear()
  emblaApi.scrollNext.mockClear()
  emblaApi.scrollPrev.mockClear()
  emblaApi.selectedScrollSnap.mockReturnValue(0)
  emblaHandlers.reInit.clear()
  emblaHandlers.select.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // Stub fetch globally so the suite proves the component no longer performs
  // client-side Bible text fallback requests.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  )
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

type Citation = WatchBibleQuotesBlock["bibleCitations"][number]
type Passage = NonNullable<WatchBibleQuotesBlock["passages"]>[number]

function makeCitation(
  overrides: Partial<{
    documentId: string
    chapterStart: number
    chapterEnd: number | null
    verseStart: number | null
    verseEnd: number | null
    order: number
    osisId: string
    bookName: string | null
    bibleBookDocumentId: string
  }>,
): Citation {
  return {
    documentId: overrides.documentId ?? "bc-1",
    chapterStart: overrides.chapterStart ?? 2,
    chapterEnd: overrides.chapterEnd ?? null,
    verseStart: overrides.verseStart === undefined ? 20 : overrides.verseStart,
    verseEnd: overrides.verseEnd ?? null,
    order: overrides.order ?? 1,
    osisId: overrides.osisId ?? "Gal.2.20",
    bibleBook: {
      documentId: overrides.bibleBookDocumentId ?? "bb-galatians",
      name: overrides.bookName === undefined ? "Galatians" : overrides.bookName,
    },
    passage: null,
  } satisfies Citation
}

function makeYouVersionPassage(overrides: Partial<Passage> = {}): Passage {
  return {
    citationDocumentId: overrides.citationDocumentId ?? "bc-1",
    content: overrides.content ?? "Server-rendered YouVersion passage text.",
    copyright:
      overrides.copyright ??
      "Test Bible version copyright from the server response.",
    humanReference: overrides.humanReference ?? "Galatians 2:20",
    provider: overrides.provider ?? "youversion",
    publisherUrl:
      overrides.publisherUrl === undefined
        ? "https://example.test/bible-version"
        : overrides.publisherUrl,
    reference: overrides.reference ?? "GAL.2.20",
    versionAbbreviation:
      overrides.versionAbbreviation === undefined
        ? "NIV"
        : overrides.versionAbbreviation,
    versionId: overrides.versionId ?? 111,
    versionTitle:
      overrides.versionTitle === undefined
        ? "New International Version"
        : overrides.versionTitle,
  }
}

describe("BibleQuotesSection — visibility", () => {
  it("renders the section with the always-on promo card even when bibleCitations is empty", () => {
    act(() => {
      root.render(
        <BibleQuotesSection bibleCitations={[]} onShareClick={vi.fn()} />,
      )
    })

    const section = container.querySelector(
      '[data-testid="watch-bible-quotes"]',
    )
    expect(section).not.toBeNull()
    expect(section!.getAttribute("data-block-type")).toBe("BibleQuotes")
    // No reference cards rendered, but the trailing promo card is always present.
    expect(
      container.querySelectorAll('[data-testid="watch-bible-quotes-item"]')
        .length,
    ).toBe(0)
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-promo"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-promo-cta"]'),
    ).not.toBeNull()
    const eyebrow = container.querySelector(
      '[data-testid="watch-bible-quotes-promo-eyebrow"]',
    )
    expect(eyebrow?.className).toContain("font-medium")
    expect(eyebrow?.className).toContain("tracking-[0.18em]")
    expect(eyebrow?.className).not.toContain("font-bold")
    expect(eyebrow?.className).not.toContain("tracking-normal")
    const heading = container.querySelector(
      '[data-testid="watch-bible-quotes-promo-heading"]',
    )
    expect(heading?.className).toContain("text-2xl")
    expect(heading?.className).toContain("font-semibold")
    expect(heading?.className).toContain("md:text-3xl")
    expect(heading?.className).not.toContain(
      "text-3xl leading-tight font-black",
    )
    expect(heading?.className).not.toContain("font-black")
  })

  it("renders the section wrapper with data-block-type=BibleQuotes when citations are present", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({})]}
          onShareClick={vi.fn()}
        />,
      )
    })

    const section = container.querySelector(
      '[data-testid="watch-bible-quotes"]',
    )
    expect(section).not.toBeNull()
    expect(section!.getAttribute("data-block-type")).toBe("BibleQuotes")
  })
})

describe("BibleQuotesSection — promo CTA", () => {
  it("renders an external-target anchor on the promo card pointing at the BSF join URL", () => {
    act(() => {
      root.render(
        <BibleQuotesSection bibleCitations={[]} onShareClick={vi.fn()} />,
      )
    })

    const cta = container.querySelector(
      '[data-testid="watch-bible-quotes-promo-cta"]',
    ) as HTMLAnchorElement | null
    expect(cta).not.toBeNull()
    expect(cta!.tagName.toLowerCase()).toBe("a")
    expect(cta!.getAttribute("href")).toBe(
      "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
    )
    expect(cta!.getAttribute("target")).toBe("_blank")
    // rel must contain noreferrer + noopener so window.opener is null on the new tab.
    const rel = cta!.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
    expect(cta!.textContent).toContain("Join our Bible study")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(cta!.className).toContain(token)
    }
    expect(cta!.className).toContain("max-w-full")
    expect(cta!.className).toContain("whitespace-normal")
    expect(cta!.className).toContain("break-words")
  })
})

describe("BibleQuotesSection — citations + promo", () => {
  it("uses larger slide geometry and stronger Admin passage typography", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({ verseEnd: 25 })]}
          onShareClick={vi.fn()}
          passages={[
            makeYouVersionPassage({
              content: "The Admin passage body.",
            }),
          ]}
        />,
      )
    })

    const slide = container.querySelector(
      '[data-testid="watch-bible-quotes-item"]',
    )
    expect(slide?.className).toContain("basis-[76vw]")
    expect(slide?.className).toContain("lg:basis-[36rem]")
    expect(slide?.className).toContain("xl:basis-[38rem]")

    const card = slide?.firstElementChild
    expect(card?.className).toContain("aspect-[1.08/1]")
    expect(card?.className).toContain("min-h-[21rem]")
    expect(card?.className).toContain("sm:min-h-[24rem]")
    expect(card?.className).toContain("md:min-h-[28rem]")
    expect(card?.className).toContain("rounded-xl")

    const reference = container.querySelector(
      '[data-testid="watch-bible-quotes-reference"]',
    )
    expect(reference?.className).toContain("text-sm")
    expect(reference?.className).toContain("font-black")

    const verse = container.querySelector(
      '[data-testid="watch-bible-quotes-verse"]',
    )
    expect(verse?.textContent).toBe("The Admin passage body.")
    const verseClassTokens = (verse?.className ?? "").split(/\s+/)
    expect(verseClassTokens).toContain("text-xl")
    expect(verseClassTokens).toContain("md:text-2xl")
    expect(verseClassTokens).not.toContain("text-2xl")
    expect(verseClassTokens).not.toContain("md:text-3xl")
    expect(verseClassTokens).toContain("text-balance")

    const version = container.querySelector(
      '[data-testid="watch-bible-quotes-version"]',
    )
    expect(version?.textContent).toBe("New International Version")
  })

  it("happy path: 2 citations renders 3 list items (2 citations + 1 promo)", () => {
    const citations: Citation[] = [
      makeCitation({
        documentId: "bc-1",
        chapterStart: 2,
        verseStart: 20,
        chapterEnd: null,
        verseEnd: null,
      }),
      makeCitation({
        documentId: "bc-2",
        chapterStart: 3,
        verseStart: 1,
        chapterEnd: null,
        verseEnd: 5,
      }),
    ]

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={citations}
          onShareClick={vi.fn()}
        />,
      )
    })

    const items = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-item"], [data-testid="watch-bible-quotes-promo"]',
    )
    expect(items.length).toBe(3)
    const bleed = container.querySelector(
      '[data-testid="watch-bible-quotes-carousel-bleed"]',
    )
    expect(bleed?.className).toContain("-mx-5")
    expect(bleed?.className).toContain("w-[calc(100%+2.5rem)]")
    expect(bleed?.className).toContain("md:mx-0")
    const content = container.querySelector(
      '[data-testid="watch-bible-quotes-list"]',
    )
    expect(content?.className).toContain("ps-5")
    expect(content?.className).toContain("md:ps-0")

    // The two citation items render the formatted reference labels.
    const refs = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-reference"]',
    )
    expect(refs.length).toBe(2)
    expect(refs[0]?.textContent).toBe("Galatians 2:20")
    expect(refs[1]?.textContent).toBe("Galatians 3:1-5")

    // The promo card is rendered as a slide; a trailing aria-hidden spacer
    // mirrors the carousel's left bleed padding.
    const promo = container.querySelector(
      '[data-testid="watch-bible-quotes-promo"]',
    )
    expect(promo).not.toBeNull()
    expect(promo!.textContent).toContain("Free Resources")
    expect(promo!.textContent).toContain(
      "Want to understand the Bible more deeply?",
    )
    // The fixed Bible-photo background must always appear on the promo card —
    // verifies the "blank card" regression from May 11 doesn't return.
    const promoImg = promo!.querySelector("img")
    expect(promoImg).not.toBeNull()
    expect(promoImg!.getAttribute("src") ?? "").toContain(
      "photo-1650658720644-e1588bd66de3",
    )
    const spacer = container.querySelector(
      '[data-testid="watch-bible-quotes-end-spacer"]',
    )
    expect(spacer).not.toBeNull()
    expect(spacer!.getAttribute("aria-hidden")).toBe("true")
    expect(spacer!.getAttribute("tabindex")).toBe("-1")
  })

  it("renders visible chapter-style carousel arrow controls", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({}), makeCitation({ documentId: "2" })]}
          onShareClick={vi.fn()}
        />,
      )
    })

    const prev = container.querySelector(
      '[data-testid="watch-bible-quotes-prev"]',
    )
    const next = container.querySelector(
      '[data-testid="watch-bible-quotes-next"]',
    )
    expect(prev).not.toBeNull()
    expect(next).not.toBeNull()
    expect(prev?.className).toContain("md:inline-flex")
    expect(next?.className).toContain("md:inline-flex")
    expect(prev?.className).toContain("-start-12")
    expect(next?.className).toContain("-end-12")
    expect(prev?.className).toContain("text-stone-900")
    expect(next?.className).toContain("text-stone-900")
    expect(prev?.className).not.toContain("sr-only")
    expect(next?.className).not.toContain("sr-only")
  })

  it("renders the cross-chapter en-dash form via formatCitation()", () => {
    const citation = makeCitation({
      documentId: "bc-cross",
      chapterStart: 2,
      verseStart: 20,
      chapterEnd: 3,
      verseEnd: 5,
    })

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })

    const ref = container.querySelector(
      '[data-testid="watch-bible-quotes-reference"]',
    )
    expect(ref?.textContent).toBe("Galatians 2:20–3:5")
  })
})

describe("BibleQuotesSection — Share button", () => {
  it("renders the Share button in the section header", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({})]}
          onShareClick={vi.fn()}
        />,
      )
    })

    const header = container.querySelector(
      '[data-testid="watch-bible-quotes-header"]',
    )
    expect(header).not.toBeNull()
    const shareBtn = header!.querySelector('[data-testid="watch-share-button"]')
    expect(shareBtn).not.toBeNull()
    expect(shareBtn!.tagName.toLowerCase()).toBe("button")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(shareBtn!.className).toContain(token)
    }
    expect(shareBtn!.className).toContain("cursor-pointer")
    expect(shareBtn!.className).toContain("[&_*]:pointer-events-none")
    expect(shareBtn!.className).toContain("[&_*]:cursor-pointer")
    expect((shareBtn as HTMLElement).style.cursor).toBe("pointer")
    expect(header!.querySelector("h2")?.className).toBe(
      WATCH_SECTION_EYEBROW_CLASS,
    )
  })

  it("invokes onShareClick when the Share button is clicked", () => {
    const onShareClick = vi.fn()

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({})]}
          onShareClick={onShareClick}
        />,
      )
    })

    const btn = container.querySelector(
      '[data-testid="watch-share-button"]',
    ) as HTMLButtonElement | null
    expect(btn).not.toBeNull()

    act(() => {
      btn!.click()
    })

    expect(onShareClick).toHaveBeenCalledTimes(1)
  })

  it("renders a concrete share fallback link when an href is supplied", () => {
    const onShareClick = vi.fn()

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({})]}
          href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch%2Fjesus.html%2Fenglish.html"
          onShareClick={onShareClick}
        />,
      )
    })

    const link = container.querySelector(
      '[data-testid="watch-share-button"]',
    ) as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link!.tagName.toLowerCase()).toBe("a")
    expect(link!.getAttribute("href")).toContain(
      "https://www.facebook.com/sharer/sharer.php",
    )
    expect(link!.getAttribute("target")).toBe("_blank")
    const rel = link!.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
    expect(link!.getAttribute("aria-label")).toBe("Share")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(link!.className).toContain(token)
    }
    expect(link!.className).toContain("cursor-pointer")
    expect(link!.className).toContain("[&_*]:pointer-events-none")
    expect(link!.className).toContain("[&_*]:cursor-pointer")
    expect(link!.style.cursor).toBe("pointer")

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      expect(link!.dispatchEvent(clickEvent)).toBe(false)
    })

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(onShareClick).toHaveBeenCalledTimes(1)
  })
})

describe("BibleQuotesSection — Admin-resolved passages", () => {
  it("renders Admin passage content, version, copyright, and Bible.com link inside the carousel card", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[
            makeCitation({ documentId: "bc-1", osisId: "Col.1.16" }),
          ]}
          onShareClick={vi.fn()}
          passages={[
            makeYouVersionPassage({
              citationDocumentId: "bc-1",
              content: "For in Him all things were created.",
              humanReference: "Colossians 1:16",
              reference: "COL.1.16",
              versionAbbreviation: "BSB",
              versionId: 3034,
              versionTitle: "Berean Standard Bible",
            }),
          ]}
        />,
      )
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-youversion"]'),
    ).toBeNull()
    const card = container.querySelector(
      '[data-testid="watch-bible-quotes-card"]',
    ) as HTMLElement | null
    expect(card?.style.backgroundImage).toContain("radial-gradient")
    expect(card?.style.backgroundImage).toContain("linear-gradient")
    expect(
      card?.querySelector('[data-testid="watch-bible-quotes-grain"]'),
    ).not.toBeNull()
    const reference = container.querySelector(
      '[data-testid="watch-bible-quotes-reference"]',
    ) as HTMLElement | null
    expect(reference?.textContent).toBe("Colossians 1:16")
    expect(reference?.querySelector("a")).toBeNull()
    expect(reference?.className).not.toContain("text-white/72")
    expect(reference?.style.color).not.toBe("")
    const verse = container.querySelector(
      '[data-testid="watch-bible-quotes-verse"]',
    )
    expect(verse?.textContent).toBe("For in Him all things were created.")
    expect(verse?.className).toContain("line-clamp-4")
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-version"]')
        ?.textContent,
    ).toBe("Berean Standard Bible")
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-copyright"]')
        ?.textContent,
    ).toBe("Test Bible version copyright from the server response.")
    const readMore = container.querySelector(
      '[data-testid="watch-bible-quotes-read-more"]',
    ) as HTMLAnchorElement | null
    expect(readMore?.textContent).toBe("Read more...")
    expect(readMore?.getAttribute("href")).toBe(
      "https://www.bible.com/bible/3034/COL.1.16.BSB",
    )
    expect(readMore?.getAttribute("target")).toBe("_blank")
    expect(readMore?.getAttribute("rel")).toContain("noopener")
  })

  it("uses the Admin human reference for narrowed ranges", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[
            makeCitation({
              documentId: "bc-cross-chapter",
              osisId: "Gal.2.20-Gal.3.5",
              chapterStart: 2,
              chapterEnd: 3,
              verseStart: 20,
              verseEnd: 5,
            }),
          ]}
          onShareClick={vi.fn()}
          passages={[
            makeYouVersionPassage({
              citationDocumentId: "bc-cross-chapter",
              content: "I have been crucified with Christ.",
              humanReference: "Galatians 2:20",
              reference: "GAL.2.20",
            }),
          ]}
        />,
      )
    })

    const reference = container.querySelector(
      '[data-testid="watch-bible-quotes-reference"]',
    )
    expect(reference?.textContent).toBe("Galatians 2:20")
    expect(reference?.textContent).not.toContain("Galatians 2:20–3:5")
  })

  it("renders only the citation reference when Admin passage data is missing", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({ documentId: "bc-missing" })]}
          onShareClick={vi.fn()}
          passages={[]}
        />,
      )
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-reference"]')
        ?.textContent,
    ).toBe("Galatians 2:20")
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-reference"] a'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-verse"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-version"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-read-more"]'),
    ).toBeNull()
  })

  it("does not build a Bible.com link without a version abbreviation", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({ documentId: "bc-1" })]}
          onShareClick={vi.fn()}
          passages={[
            makeYouVersionPassage({
              citationDocumentId: "bc-1",
              versionAbbreviation: null,
              versionTitle: "Translation Without Abbreviation",
            }),
          ]}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-bible-quotes-reference"] a'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-read-more"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-version"]')
        ?.textContent,
    ).toBe("Translation Without Abbreviation")
  })
})

describe("BibleQuotesSection — gradient quote cards", () => {
  it("uses generated gradient backgrounds for citations instead of photo images", () => {
    const citations: Citation[] = [
      makeCitation({
        documentId: "bc-1",
        bookName: "Psalms",
        chapterStart: 139,
        verseStart: 13,
        verseEnd: 18,
      }),
      makeCitation({
        documentId: "bc-2",
        bookName: "Luke",
        chapterStart: 8,
        verseStart: 2,
      }),
    ]
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={citations}
          onShareClick={vi.fn()}
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-item"] img'),
    ).toBeNull()
    const cards = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-card"]',
    )
    expect(cards).toHaveLength(2)
    expect((cards[0] as HTMLElement).style.backgroundImage).toContain(
      "radial-gradient",
    )
    expect((cards[1] as HTMLElement).style.backgroundImage).toContain(
      "radial-gradient",
    )
    expect((cards[0] as HTMLElement).style.backgroundImage).not.toBe(
      (cards[1] as HTMLElement).style.backgroundImage,
    )
  })

  it("keeps the promo card image while replacing citation images", () => {
    const citations: Citation[] = Array.from({ length: 9 }).map((_, i) =>
      makeCitation({
        documentId: `bc-${i}`,
        bookName: "Psalms",
        chapterStart: 1,
        verseStart: i + 1,
      }),
    )
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={citations}
          onShareClick={vi.fn()}
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-item"] img'),
    ).toBeNull()
    const promoImg = container.querySelector(
      '[data-testid="watch-bible-quotes-promo"] img',
    )
    expect(promoImg?.getAttribute("src")).toContain("images.unsplash.com")
  })
})
