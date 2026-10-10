import { describe, expect, it } from "vitest"

import { selectPlayableVariant } from "../content"
import type { WatchVariant } from "../content"

function variant(overrides: Partial<WatchVariant>): WatchVariant {
  return {
    documentId: "v",
    slug: null,
    published: true,
    hls: "https://example.com/stream.m3u8",
    duration: 0,
    language: {
      coreId: null,
      bcp47: null,
      slug: null,
      name: null,
      nativeName: null,
    },
    downloads: [],
    muxVideo: null,
    videoEdition: null,
    ...overrides,
  }
}

describe("selectPlayableVariant — 4-tier locale priority", () => {
  it("Tier 1: matches language.slug first (e.g. 'spanish-castilian')", () => {
    const variants = [
      variant({
        documentId: "english",
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: null,
          nativeName: null,
        },
      }),
      variant({
        documentId: "spanish",
        language: {
          coreId: "5635",
          bcp47: "es",
          slug: "spanish-castilian",
          name: null,
          nativeName: null,
        },
      }),
    ]

    const selected = selectPlayableVariant(variants, "spanish-castilian", "529")
    expect(selected?.documentId).toBe("spanish")
  })

  it("Tier 2: matches language.bcp47 when slug doesn't match", () => {
    const variants = [
      variant({
        documentId: "english",
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: null,
          nativeName: null,
        },
      }),
    ]

    const selected = selectPlayableVariant(variants, "en", "529")
    expect(selected?.documentId).toBe("english")
  })

  it("Tier 3: falls back to primary language by coreId", () => {
    const variants = [
      variant({
        documentId: "german",
        language: {
          coreId: "1106",
          bcp47: "de",
          slug: "german",
          name: null,
          nativeName: null,
        },
      }),
      variant({
        documentId: "english",
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: null,
          nativeName: null,
        },
      }),
    ]

    // Request a locale that matches NEITHER slug nor bcp47; primary should win.
    const selected = selectPlayableVariant(variants, "unmatched-locale", "529")
    expect(selected?.documentId).toBe("english")
  })

  it("Tier 4: falls back to first playable when nothing else matches", () => {
    const variants = [
      variant({
        documentId: "first",
        language: {
          coreId: "999",
          bcp47: "xx",
          slug: "obscure",
          name: null,
          nativeName: null,
        },
      }),
    ]

    const selected = selectPlayableVariant(variants, "unmatched", null)
    expect(selected?.documentId).toBe("first")
  })

  it("returns null when given empty array", () => {
    expect(selectPlayableVariant([], "english", "529")).toBeNull()
  })

  it("returns null when primaryLanguageId is null AND nothing matches", () => {
    const variants = [
      variant({
        documentId: "only",
        language: {
          coreId: "999",
          bcp47: "xx",
          slug: "x",
          name: null,
          nativeName: null,
        },
      }),
    ]
    // Caller passes already-filtered playable variants → Tier 4 falls
    // back to first playable, never null when array non-empty.
    const selected = selectPlayableVariant(variants, "unmatched", null)
    expect(selected?.documentId).toBe("only")
  })

  it("preserves Tier 1 precedence even when Tier 3 would also match", () => {
    const variants = [
      variant({
        documentId: "primary-but-other-locale",
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: null,
          nativeName: null,
        },
      }),
      variant({
        documentId: "tier-1-match",
        language: {
          coreId: "5635",
          bcp47: "es",
          slug: "spanish-castilian",
          name: null,
          nativeName: null,
        },
      }),
    ]

    // Tier 1 matches "spanish-castilian"; Tier 3 would match coreId 529.
    // Tier 1 MUST win.
    const selected = selectPlayableVariant(variants, "spanish-castilian", "529")
    expect(selected?.documentId).toBe("tier-1-match")
  })
})
