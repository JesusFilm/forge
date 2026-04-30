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

import { BibleQuotesSection } from "@/components/watch/BibleQuotesSection"
import type { WatchBibleQuotesBlock } from "@/lib/content"

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
  } as never
}

describe("BibleQuotesSection — visibility", () => {
  it("returns null (section hidden) when bibleCitations is empty", () => {
    act(() => {
      root.render(
        <BibleQuotesSection bibleCitations={[]} onShareClick={vi.fn()} />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-bible-quotes"]'),
    ).toBeNull()
    expect(container.textContent).toBe("")
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

    // The promo card is appended last as an <li>.
    const list = container.querySelector(
      '[data-testid="watch-bible-quotes-list"]',
    )
    expect(list?.tagName.toLowerCase()).toBe("ul")
    const lastChild = list!.lastElementChild
    expect(lastChild?.getAttribute("data-testid")).toBe(
      "watch-bible-quotes-promo",
    )
    expect(lastChild?.textContent).toContain("Free Resources")
    expect(lastChild?.textContent).toContain("Join Our Bible Study")
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
