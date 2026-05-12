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

import {
  BibleQuotesSection,
  shouldEnableDrag,
} from "@/components/watch/BibleQuotesSection"
import type { WatchBibleQuotesBlock } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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

function makeCitation(
  overrides: Partial<{
    documentId: string
    chapterStart: number
    chapterEnd: number | null
    verseStart: number
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
    verseStart: overrides.verseStart ?? 20,
    verseEnd: overrides.verseEnd ?? null,
    order: overrides.order ?? 1,
    osisId: overrides.osisId ?? "Gal.2.20",
    bibleBook: {
      documentId: overrides.bibleBookDocumentId ?? "bb-galatians",
      name: overrides.bookName === undefined ? "Galatians" : overrides.bookName,
    },
  } satisfies Citation
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
  })
})

describe("BibleQuotesSection — citations + promo", () => {
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
      "Want to grow deep in your understanding of the Bible?",
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
      "https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/en-asv/books/psalms/chapters/139/verses/13.json",
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

  it("renders a Read more... link only when verseEnd is present", () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined))
    const citations: Citation[] = [
      makeCitation({ documentId: "single", verseStart: 20, verseEnd: null }),
      makeCitation({ documentId: "range", verseStart: 20, verseEnd: 25 }),
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
    expect(readMores.length).toBe(1)
    const anchor = readMores[0] as HTMLAnchorElement
    expect(anchor.getAttribute("target")).toBe("_blank")
    const rel = anchor.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
    expect(anchor.getAttribute("href")).toContain("biblegateway.com/passage/")
    expect(anchor.getAttribute("href")).toContain("version=NIV")
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
    expect(anchor!.getAttribute("href")).not.toContain("version=NIV")
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

describe("BibleQuotesSection — drag predicate", () => {
  // jsdom's zero-width layout means scrollSnapList() always returns []
  // through the rendered carousel, so the drag-enable branch is unreachable
  // via component tests. Unit-test the predicate directly.
  it("returns false when zero or one snap point exists", () => {
    expect(shouldEnableDrag({ scrollSnapList: () => [] })).toBe(false)
    expect(shouldEnableDrag({ scrollSnapList: () => [0] })).toBe(false)
  })

  it("returns true when two or more snap points exist", () => {
    expect(shouldEnableDrag({ scrollSnapList: () => [0, 1] })).toBe(true)
    expect(shouldEnableDrag({ scrollSnapList: () => [0, 1, 2, 3] })).toBe(true)
  })
})
