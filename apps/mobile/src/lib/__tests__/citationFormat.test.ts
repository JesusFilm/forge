import { formatCitationLabel } from "../citationFormat"

type Input = Parameters<typeof formatCitationLabel>[0]

// Every field is written out on every fixture. Deriving one from another would
// let a case pass because a sibling field also steered the branch.
function citation(overrides: Partial<Input>): Input {
  return {
    bookName: "Genesis",
    chapterStart: null,
    chapterEnd: null,
    verseStart: null,
    verseEnd: null,
    ...overrides,
  }
}

describe("formatCitationLabel", () => {
  it("renders a single verse", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Galatians",
          chapterStart: 2,
          chapterEnd: null,
          verseStart: 20,
          verseEnd: null,
        }),
      ),
    ).toBe("Galatians 2:20")
  })

  it("renders a same-chapter range with both verses", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: 1,
          chapterEnd: null,
          verseStart: 26,
          verseEnd: 27,
        }),
      ),
    ).toBe("Genesis 1:26-27")
  })

  it("treats an equal chapterEnd as the same chapter", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: 1,
          chapterEnd: 1,
          verseStart: 26,
          verseEnd: 27,
        }),
      ),
    ).toBe("Genesis 1:26-27")
  })

  it("renders a cross-chapter range with both chapters", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Galatians",
          chapterStart: 2,
          chapterEnd: 3,
          verseStart: 20,
          verseEnd: 5,
        }),
      ),
    ).toBe("Galatians 2:20–3:5")
  })

  it("renders a cross-chapter range that runs to the end of a chapter", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Galatians",
          chapterStart: 2,
          chapterEnd: 3,
          verseStart: 20,
          verseEnd: null,
        }),
      ),
    ).toBe("Galatians 2:20–3")
  })

  it("renders a whole-chapter citation with no verse number", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: 3,
          chapterEnd: null,
          verseStart: null,
          verseEnd: null,
        }),
      ),
    ).toBe("Genesis 3")
  })

  it("renders a chapter range with no verse numbers", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: 3,
          chapterEnd: 5,
          verseStart: null,
          verseEnd: null,
        }),
      ),
    ).toBe("Genesis 3–5")
  })

  // The composition this replaces emitted "Genesis 3:" for exactly this shape.
  it("emits no dangling separator when the verse is absent", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: 3,
          chapterEnd: null,
          verseStart: null,
          verseEnd: 12,
        }),
      ),
    ).toBe("Genesis 3")
  })

  it("falls back to a named placeholder when the book name is absent", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: null,
          chapterStart: 1,
          chapterEnd: null,
          verseStart: 1,
          verseEnd: null,
        }),
      ),
    ).toBe("Unknown Book 1:1")

    expect(
      formatCitationLabel(
        citation({
          bookName: "",
          chapterStart: 1,
          chapterEnd: null,
          verseStart: 1,
          verseEnd: null,
        }),
      ),
    ).toBe("Unknown Book 1:1")
  })

  it("renders the book alone when the chapter is absent", () => {
    expect(
      formatCitationLabel(
        citation({
          bookName: "Genesis",
          chapterStart: null,
          chapterEnd: null,
          verseStart: 26,
          verseEnd: 27,
        }),
      ),
    ).toBe("Genesis")
  })

  // Exhaustive sweep over every nullable combination: no output may end in a
  // separator or carry an empty one, whichever branch it takes.
  it("never emits a trailing or empty separator, for any combination", () => {
    const values = [null, 1, 2] as const

    for (const bookName of ["Genesis", null]) {
      for (const chapterStart of values) {
        for (const chapterEnd of values) {
          for (const verseStart of values) {
            for (const verseEnd of values) {
              const label = formatCitationLabel({
                bookName,
                chapterStart,
                chapterEnd,
                verseStart,
                verseEnd,
              })

              expect(label).not.toMatch(/[:\-–]\s*$/)
              expect(label).not.toMatch(/[:\-–]{2}/)
              expect(label.trim()).toBe(label)
              expect(label.length).toBeGreaterThan(0)
            }
          }
        }
      }
    }
  })
})
