/**
 * @vitest-environment jsdom
 *
 * U8 — BibleQuotesSection tests.
 *
 * Covers:
 *  - Empty bibleCitations[] → returns null (section hidden).
 *  - 2 citations → renders 3 list items (2 references + 1 hardcoded promo).
 *  - Reference labels are produced by `formatCitation()` (verified against
 *    the canonical "Galatians 2:20" sample from the live data and a
 *    cross-chapter range).
 *  - Click on the in-section Share button calls `onShareClick`.
 *  - Section emits `data-block-type="BibleQuotes"` so the U4 dispatch
 *    contract still holds when the section component owns the element.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { emblaApi, emblaHandlers, emblaRefMock, emitEmbla } = vi.hoisted(() => {
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
    emitEmbla: (event: "reInit" | "select") => {
      for (const handler of handlers[event]) handler(api)
    },
  }
})

vi.mock("embla-carousel-react", () => ({
  default: () => [emblaRefMock, emblaApi],
}))

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
  // Stub fetch globally so non-fetch-focused tests don't accidentally hit
  // undici with a cross-realm AbortSignal (which logs a noisy TypeError
  // through the component's catch block but does not affect rendered DOM).
  // Tests in the verse-fetch describe block install their own mock and
  // override this one.
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
type YouVersionPassage = NonNullable<
  WatchBibleQuotesBlock["youVersionPassages"]
>[number]

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
  } satisfies Citation
}

function makeYouVersionPassage(
  overrides: Partial<YouVersionPassage> = {},
): YouVersionPassage {
  return {
    citationDocumentId: overrides.citationDocumentId ?? "bc-1",
    content: overrides.content ?? "Server-rendered YouVersion passage text.",
    copyright:
      overrides.copyright ??
      "Test Bible version copyright from the server response.",
    humanReference: overrides.humanReference ?? "Galatians 2:20",
    publisherUrl:
      overrides.publisherUrl ?? "https://example.test/bible-version",
    reference: overrides.reference ?? "GAL.2.20",
    versionAbbreviation: overrides.versionAbbreviation ?? "NIV",
    versionId: overrides.versionId ?? 111,
    versionTitle: overrides.versionTitle ?? "New International Version",
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
  it("uses larger slide geometry and stronger verse typography", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: "The verse body." }), {
          status: 200,
        }),
      ),
    )
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({ verseEnd: 25 })]}
          onShareClick={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
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
    const verseClassTokens = (verse?.className ?? "").split(/\s+/)
    expect(verseClassTokens).toContain("text-xl")
    expect(verseClassTokens).toContain("md:text-2xl")
    expect(verseClassTokens).not.toContain("text-2xl")
    expect(verseClassTokens).not.toContain("md:text-3xl")
    expect(verseClassTokens).toContain("text-balance")

    const readMore = container.querySelector(
      '[data-testid="watch-bible-quotes-read-more"]',
    )
    expect(readMore?.className).toContain("text-xl")
    expect(readMore?.className).toContain("decoration-2")
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
    expect(bleed?.className).toContain("-mx-10")
    expect(bleed?.className).toContain("w-[calc(100%+5rem)]")
    expect(bleed?.className).toContain("md:mx-0")
    const content = container.querySelector(
      '[data-testid="watch-bible-quotes-list"]',
    )
    expect(content?.className).toContain("pl-10")
    expect(content?.className).toContain("md:pl-0")

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
    expect(prev?.className).toContain("-left-12")
    expect(next?.className).toContain("-right-12")
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

describe("BibleQuotesSection — YouVersion compact embed", () => {
  it("does not render the YouVersion panel when no server passage data is supplied", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[makeCitation({})]}
          onShareClick={vi.fn()}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-bible-quotes-youversion"]'),
    ).toBeNull()
  })

  it("renders the first citation in the compact YouVersion panel from server data", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[
            makeCitation({ documentId: "bc-1", osisId: "Gal.2.20" }),
          ]}
          onShareClick={vi.fn()}
          youVersionPassages={[
            makeYouVersionPassage({
              citationDocumentId: "bc-1",
              content: "I have been crucified with Christ.",
              humanReference: "Galatians 2:20",
              reference: "GAL.2.20",
            }),
          ]}
        />,
      )
    })

    const panel = container.querySelector(
      '[data-testid="watch-bible-quotes-youversion"]',
    )
    const carouselBleed = container.querySelector(
      '[data-testid="watch-bible-quotes-carousel-bleed"]',
    )
    expect(panel).not.toBeNull()
    expect(carouselBleed).not.toBeNull()
    expect(
      carouselBleed!.compareDocumentPosition(panel!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(panel?.textContent).toContain("Galatians 2:20")
    expect(panel?.getAttribute("data-reference")).toBe("GAL.2.20")
    expect(panel?.textContent).toContain("I have been crucified with Christ.")
    expect(panel?.textContent).toContain("NIV")
    expect(panel?.textContent).toContain("New International Version")
    expect(panel?.textContent).toContain(
      "Test Bible version copyright from the server response.",
    )
    const attribution = container.querySelector(
      '[data-testid="watch-bible-quotes-youversion-copyright"]',
    )
    expect(attribution?.textContent).toBe(
      "Test Bible version copyright from the server response.",
    )
    expect(panel?.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.test/bible-version",
    )
  })

  it("labels narrowed cross-chapter passages with the fetched YouVersion reference", () => {
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
          youVersionPassages={[
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

    const panel = container.querySelector(
      '[data-testid="watch-bible-quotes-youversion"]',
    )
    expect(panel?.textContent).toContain("Galatians 2:20")
    expect(panel?.textContent).not.toContain("Galatians 2:20–3:5")
  })

  it("updates the compact YouVersion panel when Embla selects another citation", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[
            makeCitation({ documentId: "bc-gal", osisId: "Gal.2.20" }),
            makeCitation({
              documentId: "bc-john",
              bookName: "John",
              osisId: "John.3.16",
              chapterStart: 3,
              verseStart: 16,
            }),
          ]}
          onShareClick={vi.fn()}
          youVersionPassages={[
            makeYouVersionPassage({
              citationDocumentId: "bc-gal",
              content: "Galatians passage.",
              humanReference: "Galatians 2:20",
              reference: "GAL.2.20",
            }),
            makeYouVersionPassage({
              citationDocumentId: "bc-john",
              content: "For God so loved the world.",
              humanReference: "John 3:16",
              reference: "JHN.3.16",
            }),
          ]}
        />,
      )
    })

    expect(emblaApi.on).toHaveBeenCalledWith("select", expect.any(Function))

    act(() => {
      emblaApi.selectedScrollSnap.mockReturnValue(1)
      emitEmbla("select")
    })

    const panel = container.querySelector(
      '[data-testid="watch-bible-quotes-youversion"]',
    )
    expect(panel?.textContent).toContain("John 3:16")
    expect(panel?.getAttribute("data-reference")).toBe("JHN.3.16")
    expect(panel?.textContent).toContain("For God so loved the world.")
  })

  it("hides the YouVersion panel when the active slide is the promo card", () => {
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[
            makeCitation({ documentId: "bc-1", osisId: "Gal.2.20" }),
          ]}
          onShareClick={vi.fn()}
          youVersionPassages={[makeYouVersionPassage()]}
        />,
      )
    })

    const promo = container.querySelector(
      '[data-testid="watch-bible-quotes-promo"]',
    ) as HTMLElement | null
    expect(promo).not.toBeNull()

    act(() => {
      promo!.click()
    })

    expect(
      container.querySelector('[data-testid="watch-bible-quotes-youversion"]'),
    ).toBeNull()
  })
})

describe("BibleQuotesSection — Unsplash image + verse fetch", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders an <img> per citation using the index-cycled Unsplash URLs", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
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
    const imgs = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-item"] img',
    )
    // next/image emits an <img> per card; both src values should reference
    // an Unsplash URL (next/image wraps the original).
    expect(imgs.length).toBeGreaterThanOrEqual(2)
    const src0 = imgs[0]?.getAttribute("src") ?? ""
    const src1 = imgs[1]?.getAttribute("src") ?? ""
    expect(src0).toContain("images.unsplash.com")
    expect(src1).toContain("images.unsplash.com")
    // Different index → different underlying URL.
    expect(src0).not.toBe(src1)
  })

  it("fetches the verse text from wldeh/bible-api with lowercased book name", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ text: "Verse body", reference: "Psalms 139:13" }),
        { status: 200 },
      ),
    )
    const citation = makeCitation({
      documentId: "bc-psalms",
      bookName: "Psalms",
      chapterStart: 139,
      verseStart: 13,
      verseEnd: 18,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    // Effect ran on mount; flush microtasks so the fetched body renders.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalled()
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(url).toContain(
      "https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/en-webbe/books/psalms/chapters/139/verses/13.json",
    )
    const verse = container.querySelector(
      '[data-testid="watch-bible-quotes-verse"]',
    )
    expect(verse?.textContent).toBe("Verse body")
  })

  it("uses the locale-mapped Bible version when locale='es'", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }))
    const citation = makeCitation({
      bookName: "Lucas",
      chapterStart: 8,
      verseStart: 2,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
          locale="es"
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(url).toContain("/bibles/es-rvr1960/")
  })

  it("renders a Read more... link for verse ranges and chapter-only citations, not for single verses", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citations: Citation[] = [
      makeCitation({ documentId: "single", verseStart: 20, verseEnd: null }),
      makeCitation({ documentId: "range", verseStart: 20, verseEnd: 25 }),
      makeCitation({
        documentId: "chapter-only",
        bookName: "Genesis",
        chapterStart: 3,
        verseStart: null,
        verseEnd: null,
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
    const readMores = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-read-more"]',
    )
    expect(readMores.length).toBe(2)
    for (const node of readMores) {
      const anchor = node as HTMLAnchorElement
      expect(anchor.getAttribute("target")).toBe("_blank")
      const rel = anchor.getAttribute("rel") ?? ""
      expect(rel).toContain("noopener")
      expect(rel).toContain("noreferrer")
      expect(anchor.getAttribute("href")).toContain("biblegateway.com/passage/")
      expect(anchor.getAttribute("href")).toContain("version=WEB")
    }
  })

  it("chapter-only citation: label is 'Genesis 3' (no ':0') and Read more points at the whole chapter", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citation = makeCitation({
      bookName: "Genesis",
      chapterStart: 3,
      verseStart: null,
      verseEnd: null,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    const label = container.querySelector(
      '[data-testid="watch-bible-quotes-reference"]',
    )
    expect(label?.textContent).toBe("Genesis 3")
    expect(label?.textContent).not.toContain(":")

    const readMore = container.querySelector(
      '[data-testid="watch-bible-quotes-read-more"]',
    ) as HTMLAnchorElement | null
    expect(readMore).not.toBeNull()
    // BibleGateway accepts "Genesis 3" as a chapter-level search.
    expect(decodeURIComponent(readMore!.getAttribute("href") ?? "")).toContain(
      "search=Genesis 3",
    )
  })

  it("chapter-only citation: fetches verse 1 from the jsdelivr API as the body preview", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ verse: "1", text: "In the beginning..." }),
        { status: 200 },
      ),
    )
    const citation = makeCitation({
      bookName: "Genesis",
      chapterStart: 3,
      verseStart: null,
      verseEnd: null,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    // Drain the microtask queue so the effect's fetch + json + setState
    // settle before we inspect the DOM.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(url).toContain("/books/genesis/chapters/3/verses/1.json")

    const body = container.querySelector(
      '[data-testid="watch-bible-quotes-verse"]',
    )
    expect(body?.textContent).toContain("In the beginning")
  })

  it("locale='es' maps the BibleGateway Read-more link to version=NVI", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citation = makeCitation({
      bookName: "Lucas",
      chapterStart: 8,
      verseStart: 2,
      verseEnd: 5,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
          locale="es"
        />,
      )
    })
    const anchor = container.querySelector(
      '[data-testid="watch-bible-quotes-read-more"]',
    ) as HTMLAnchorElement | null
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute("href")).toContain("version=NVI")
  })

  it("multi-word book names are normalized to whitespace-stripped slugs in the jsdelivr URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ verse: "1", text: "Body" }), {
        status: 200,
      }),
    )
    const citation = makeCitation({
      bookName: "1 Corinthians",
      chapterStart: 13,
      verseStart: 4,
      verseEnd: 7,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalled()
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(url).toContain("/books/1corinthians/")
    expect(url).not.toContain("%20")
    expect(url).not.toContain(" ")
  })

  it("hostile book names containing path-traversal segments are rejected before fetch", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citation = makeCitation({
      bookName: "../etc/passwd",
      chapterStart: 1,
      verseStart: 1,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("null bookName / null chapterStart / null verseStart skip the fetch entirely", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citations: Citation[] = [
      makeCitation({
        documentId: "null-book",
        bookName: null,
        chapterStart: 1,
        verseStart: 1,
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
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-verse"]'),
    ).toBeNull()
  })

  it("fetch is called with cache: 'force-cache' so cross-navigation hits dedupe", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: "Body" }), { status: 200 }),
    )
    const citation = makeCitation({
      bookName: "Psalms",
      chapterStart: 23,
      verseStart: 1,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalled()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.cache).toBe("force-cache")
  })

  it("non-ok fetch responses render the card without a verse element", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }))
    const citation = makeCitation({
      bookName: "Psalms",
      chapterStart: 1,
      verseStart: 1,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-testid="watch-bible-quotes-verse"]'),
    ).toBeNull()
  })

  it("fetch reject (network error) renders the card without a verse element", async () => {
    fetchMock.mockRejectedValue(new TypeError("network unreachable"))
    const citation = makeCitation({
      bookName: "Psalms",
      chapterStart: 1,
      verseStart: 1,
    })
    // Swallow the expected error log so the test output stays clean.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      act(() => {
        root.render(
          <BibleQuotesSection
            bibleCitations={[citation]}
            onShareClick={vi.fn()}
          />,
        )
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(
        container.querySelector('[data-testid="watch-bible-quotes-verse"]'),
      ).toBeNull()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("formatScripture strips ';N:N…' and ',N:N…' footnote markers before rendering", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "For God so loved the world;1 he gave,2:3 his only Son.",
        }),
        { status: 200 },
      ),
    )
    const citation = makeCitation({
      bookName: "John",
      chapterStart: 3,
      verseStart: 16,
      verseEnd: 16,
    })
    act(() => {
      root.render(
        <BibleQuotesSection
          bibleCitations={[citation]}
          onShareClick={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const verse = container.querySelector(
      '[data-testid="watch-bible-quotes-verse"]',
    )
    // Semicolon-footnote regex strips everything from `;1` onward, so the
    // rendered text is just the lead-in.
    expect(verse?.textContent).toBe("For God so loved the world")
  })

  it("BIBLE_IMAGES cycles by index modulo array length (no silent repeat of image 0)", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
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
    const imgs = container.querySelectorAll(
      '[data-testid="watch-bible-quotes-item"] img',
    )
    const src0 = imgs[0]?.getAttribute("src") ?? ""
    const src7 = imgs[7]?.getAttribute("src") ?? ""
    // 7 % 7 === 0, so the 8th citation card should reuse image 0.
    expect(src7).toBe(src0)
    // 8 % 7 === 1, so the 9th citation should reuse image 1 (NOT image 0).
    const src8 = imgs[8]?.getAttribute("src") ?? ""
    const src1 = imgs[1]?.getAttribute("src") ?? ""
    expect(src8).toBe(src1)
    expect(src8).not.toBe(src0)
  })
})
