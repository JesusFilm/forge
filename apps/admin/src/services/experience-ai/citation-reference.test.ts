import { describe, expect, it } from "vitest"
import {
  formatCitationReference,
  pickLocalisedName,
} from "./citation-reference"

const johnName = { en: "John", es: "Juan", "fr-CA": "Jean" }

describe("pickLocalisedName", () => {
  it("returns the exact-locale name when present", () => {
    expect(pickLocalisedName(johnName, "es", "fallback")).toBe("Juan")
  })

  it("falls back to the BCP-47 language base, then en, then the fallback", () => {
    // fr-CA exact match
    expect(pickLocalisedName(johnName, "fr-CA", "x")).toBe("Jean")
    // pt-BR → no pt → en
    expect(pickLocalisedName(johnName, "pt-BR", "x")).toBe("John")
    // unknown shape → fallback
    expect(pickLocalisedName(null, "en", "John 3")).toBe("John 3")
  })
})

describe("formatCitationReference", () => {
  it("composes a single verse", () => {
    expect(
      formatCitationReference(
        johnName,
        { chapterStart: 3, verseStart: 16, verseEnd: 16 },
        "en",
      ),
    ).toBe("John 3:16")
  })

  it("composes a same-chapter verse range", () => {
    expect(
      formatCitationReference(
        johnName,
        { chapterStart: 20, verseStart: 19, verseEnd: 29 },
        "en",
      ),
    ).toBe("John 20:19-29")
  })

  it("composes a chapter-only reference (no verse)", () => {
    expect(
      formatCitationReference({ en: "Psalm" }, { chapterStart: 23 }, "en"),
    ).toBe("Psalm 23")
  })

  it("composes a chapter range with no verses", () => {
    expect(
      formatCitationReference(
        { en: "Psalm" },
        { chapterStart: 23, chapterEnd: 24 },
        "en",
      ),
    ).toBe("Psalm 23-24")
  })

  it("composes a cross-chapter verse range", () => {
    expect(
      formatCitationReference(
        { en: "Matthew" },
        { chapterStart: 5, chapterEnd: 7, verseStart: 1, verseEnd: 29 },
        "en",
      ),
    ).toBe("Matthew 5:1-7:29")
  })

  it("localizes the book name", () => {
    expect(
      formatCitationReference(
        johnName,
        { chapterStart: 3, verseStart: 16, verseEnd: 16 },
        "es",
      ),
    ).toBe("Juan 3:16")
  })

  it("never returns verse text — only the reference label", () => {
    const ref = formatCitationReference(
      johnName,
      { chapterStart: 3, verseStart: 16 },
      "en",
    )
    expect(ref).toBe("John 3:16")
    expect(ref).not.toMatch(/for god so loved/i)
  })
})
