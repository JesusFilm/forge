import type { Caption } from "@remotion/captions"
import { describe, expect, it } from "vitest"

import {
  activeTokenIndex,
  applyTokenTextEdit,
  buildCaptionPages,
  deletePage,
  deleteToken,
} from "./captions"
import type { CaptionPage } from "./schema"

// Whisper-style word captions: whitespace is the delimiter, so every token
// after the first carries a leading space.
const fixture: Caption[] = [
  { text: "Jesus", startMs: 0, endMs: 400, timestampMs: 200, confidence: null },
  {
    text: " said",
    startMs: 400,
    endMs: 700,
    timestampMs: 550,
    confidence: null,
  },
  {
    text: " follow",
    startMs: 700,
    endMs: 1000,
    timestampMs: 850,
    confidence: null,
  },
  {
    text: " me",
    startMs: 1000,
    endMs: 1300,
    timestampMs: 1150,
    confidence: null,
  },
  {
    text: " Come",
    startMs: 3000,
    endMs: 3400,
    timestampMs: 3200,
    confidence: null,
  },
  {
    text: " and",
    startMs: 3400,
    endMs: 3700,
    timestampMs: 3550,
    confidence: null,
  },
  {
    text: " see",
    startMs: 3700,
    endMs: 4000,
    timestampMs: 3850,
    confidence: null,
  },
]

const pagesFixture = (): CaptionPage[] => buildCaptionPages(fixture)

describe("buildCaptionPages", () => {
  it("maps TikTok pages to the captionPageSchema shape with the default 1200ms window", () => {
    const pages = pagesFixture()
    expect(pages).toHaveLength(2)

    expect(pages[0]).toEqual({
      text: "Jesus said follow me",
      startMs: 0,
      // durationMs spans until the next page starts (library contract).
      durationMs: 3000,
      tokens: [
        { text: "Jesus", fromMs: 0, toMs: 400 },
        { text: " said", fromMs: 400, toMs: 700 },
        { text: " follow", fromMs: 700, toMs: 1000 },
        { text: " me", fromMs: 1000, toMs: 1300 },
      ],
    })

    expect(pages[1]).toEqual({
      text: "Come and see",
      startMs: 3000,
      durationMs: 1000,
      tokens: [
        // Page-initial token text is trimmed by createTikTokStyleCaptions.
        { text: "Come", fromMs: 3000, toMs: 3400 },
        { text: " and", fromMs: 3400, toMs: 3700 },
        { text: " see", fromMs: 3700, toMs: 4000 },
      ],
    })
  })

  it("preserves leading spaces on non-page-initial tokens", () => {
    const pages = pagesFixture()
    expect(pages[0].tokens[1].text).toBe(" said")
    expect(pages[1].tokens[2].text).toBe(" see")
  })

  it("honors a custom combineTokensWithinMilliseconds window", () => {
    const pages = buildCaptionPages(fixture, {
      combineTokensWithinMilliseconds: 200,
    })
    // Every space-leading token exceeds the 200ms window -> one page per word.
    expect(pages).toHaveLength(fixture.length)
    expect(pages.every((page) => page.tokens.length === 1)).toBe(true)
  })
})

describe("applyTokenTextEdit", () => {
  it("replaces token text immutably, preserving timings and the leading space", () => {
    const pages = pagesFixture()
    const edited = applyTokenTextEdit(pages, 0, 1, "says")

    expect(edited[0].tokens[1]).toEqual({
      text: " says",
      fromMs: 400,
      toMs: 700,
    })
    expect(edited[0].text).toBe("Jesus says follow me")
    // Untouched page is reused; original input is unchanged.
    expect(edited[1]).toBe(pages[1])
    expect(pages[0].tokens[1].text).toBe(" said")
  })

  it("does not double the leading space when the replacement already has one", () => {
    const pages = pagesFixture()
    const edited = applyTokenTextEdit(pages, 0, 1, " says")
    expect(edited[0].tokens[1].text).toBe(" says")
  })

  it("does not invent a leading space for page-initial tokens", () => {
    const pages = pagesFixture()
    const edited = applyTokenTextEdit(pages, 1, 0, "Go")
    expect(edited[1].tokens[0].text).toBe("Go")
    expect(edited[1].text).toBe("Go and see")
  })

  it("throws RangeError on out-of-range indices", () => {
    const pages = pagesFixture()
    expect(() => applyTokenTextEdit(pages, 2, 0, "x")).toThrow(RangeError)
    expect(() => applyTokenTextEdit(pages, 0, 99, "x")).toThrow(RangeError)
  })
})

describe("deleteToken", () => {
  it("removes the token and recomputes the page text", () => {
    const pages = pagesFixture()
    const result = deleteToken(pages, 0, 1)

    expect(result[0].tokens).toHaveLength(3)
    expect(result[0].text).toBe("Jesus follow me")
    // Page timings unchanged.
    expect(result[0].startMs).toBe(0)
    expect(result[0].durationMs).toBe(3000)
    expect(pages[0].tokens).toHaveLength(4)
  })

  it("trims the recomputed text when the page-initial token is deleted", () => {
    const pages = pagesFixture()
    const result = deleteToken(pages, 1, 0)
    // Remaining tokens are " and" + " see" -> page text must not keep the
    // leading space.
    expect(result[1].text).toBe("and see")
    expect(result[1].tokens[0].text).toBe(" and")
  })

  it("drops the page when its last token is deleted", () => {
    const singleTokenPage: CaptionPage = {
      text: "Amen",
      startMs: 0,
      durationMs: 500,
      tokens: [{ text: "Amen", fromMs: 0, toMs: 500 }],
    }
    const other: CaptionPage = {
      text: "Go",
      startMs: 500,
      durationMs: 500,
      tokens: [{ text: "Go", fromMs: 500, toMs: 1000 }],
    }
    const result = deleteToken([singleTokenPage, other], 0, 0)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(other)
  })

  it("throws RangeError on out-of-range indices", () => {
    const pages = pagesFixture()
    expect(() => deleteToken(pages, 5, 0)).toThrow(RangeError)
    expect(() => deleteToken(pages, 0, -1)).toThrow(RangeError)
  })
})

describe("deletePage", () => {
  it("removes the page immutably", () => {
    const pages = pagesFixture()
    const result = deletePage(pages, 0)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(pages[1])
    expect(pages).toHaveLength(2)
  })

  it("throws RangeError on out-of-range indices", () => {
    expect(() => deletePage(pagesFixture(), 2)).toThrow(RangeError)
  })
})

describe("activeTokenIndex", () => {
  it("is inclusive of fromMs and exclusive of toMs", () => {
    const [page] = pagesFixture()
    expect(activeTokenIndex(page, 0)).toBe(0)
    // 400 is token 0's toMs (exclusive) and token 1's fromMs (inclusive).
    expect(activeTokenIndex(page, 400)).toBe(1)
    expect(activeTokenIndex(page, 699.9)).toBe(1)
    expect(activeTokenIndex(page, 700)).toBe(2)
  })

  it("returns -1 when no token is active", () => {
    const [first] = pagesFixture()
    // 1300 is the last token's toMs (exclusive) -> nothing active.
    expect(activeTokenIndex(first, 1300)).toBe(-1)
    expect(activeTokenIndex(first, 2000)).toBe(-1)
    expect(activeTokenIndex(first, -1)).toBe(-1)
  })
})
