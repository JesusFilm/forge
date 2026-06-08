import {
  buildBibleQuotesBlock,
  buildDescriptionBlock,
  buildRelatedQuestionsBlock,
  formatCitationReference,
} from "./detailsAdapters"
import type {
  WatchBibleCitation,
  WatchStudyQuestion,
} from "../../lib/normalizeVideo"

function makeQuestion(value: string, order = 0): WatchStudyQuestion {
  return { documentId: `q-${order}`, value, order }
}

function makeCitation(
  overrides: Partial<WatchBibleCitation> = {},
): WatchBibleCitation {
  return {
    documentId: "c-1",
    osisId: null,
    bookName: "John",
    chapterStart: 3,
    chapterEnd: null,
    verseStart: 16,
    verseEnd: null,
    order: 0,
    ...overrides,
  }
}

describe("buildDescriptionBlock", () => {
  it("maps description into the textHeading/contentParagraphs alias shape", () => {
    const block = buildDescriptionBlock("A short film.")
    expect(block).toEqual({
      kind: "text",
      __typename: "TextBlock",
      textHeading: null,
      contentParagraphs: ["A short film."],
    })
  })

  it("returns null for empty / whitespace / null description", () => {
    expect(buildDescriptionBlock(null)).toBeNull()
    expect(buildDescriptionBlock(undefined)).toBeNull()
    expect(buildDescriptionBlock("")).toBeNull()
    expect(buildDescriptionBlock("   ")).toBeNull()
  })
})

describe("buildRelatedQuestionsBlock", () => {
  it("uses the rqHeading alias and a per-question index id with empty answers", () => {
    const block = buildRelatedQuestionsBlock([
      makeQuestion("Who is Jesus?", 0),
      makeQuestion("Why does it matter?", 1),
    ])
    expect(block).toMatchObject({
      kind: "relatedQuestions",
      __typename: "RelatedQuestionsBlock",
      rqHeading: "Related Questions",
    })
    expect(block?.questions).toEqual([
      { id: "0", question: "Who is Jesus?", answer: "" },
      { id: "1", question: "Why does it matter?", answer: "" },
    ])
  })

  it("returns null when there are no questions", () => {
    expect(buildRelatedQuestionsBlock([])).toBeNull()
    expect(buildRelatedQuestionsBlock(null)).toBeNull()
    expect(buildRelatedQuestionsBlock(undefined)).toBeNull()
  })

  it("drops empty-valued questions and returns null if all are empty", () => {
    expect(buildRelatedQuestionsBlock([makeQuestion("")])).toBeNull()
  })
})

describe("formatCitationReference", () => {
  it("formats a single verse", () => {
    expect(formatCitationReference(makeCitation())).toBe("John 3:16")
  })

  it("formats a verse range in the same chapter", () => {
    expect(
      formatCitationReference(makeCitation({ verseStart: 16, verseEnd: 18 })),
    ).toBe("John 3:16-18")
  })

  it("formats a chapter-only reference when no verse", () => {
    expect(formatCitationReference(makeCitation({ verseStart: null }))).toBe(
      "John 3",
    )
  })

  it("falls back to book name when no chapter", () => {
    expect(
      formatCitationReference(
        makeCitation({ chapterStart: null, verseStart: null }),
      ),
    ).toBe("John")
  })

  it("returns null when there is no book name", () => {
    expect(formatCitationReference(makeCitation({ bookName: null }))).toBeNull()
  })

  it("treats an equal verseEnd as a single verse (no range)", () => {
    expect(
      formatCitationReference(makeCitation({ verseStart: 16, verseEnd: 16 })),
    ).toBe("John 3:16")
  })
})

describe("buildBibleQuotesBlock", () => {
  it("uses the bqcHeading alias and reference-level quotes with empty text", () => {
    const block = buildBibleQuotesBlock([
      makeCitation(),
      makeCitation({
        documentId: "c-2",
        bookName: "Luke",
        chapterStart: 2,
        verseStart: null,
      }),
    ])
    expect(block).toMatchObject({
      kind: "bibleQuotesCarousel",
      __typename: "BibleQuotesCarouselBlock",
      bqcHeading: "Bible Quotes",
    })
    expect(block?.quotes).toEqual([
      { id: "0", reference: "John 3:16", text: "" },
      { id: "1", reference: "Luke 2", text: "" },
    ])
  })

  it("drops citations with no usable reference and returns null if all are dropped", () => {
    expect(buildBibleQuotesBlock([makeCitation({ bookName: null })])).toBeNull()
    expect(buildBibleQuotesBlock([])).toBeNull()
    expect(buildBibleQuotesBlock(null)).toBeNull()
  })
})
