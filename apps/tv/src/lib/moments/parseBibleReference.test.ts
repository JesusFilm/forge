import {
  MAX_REFERENCES_PER_MOMENT,
  parseBibleReference,
  parseBibleReferences,
} from "./parseBibleReference"

describe("parseBibleReference", () => {
  it("parses book chapter:verse", () => {
    expect(parseBibleReference("John 3:16")).toMatchObject({
      bookName: "John",
      chapterStart: 3,
      verseStart: 16,
      verseEnd: null,
    })
  })

  it("parses a verse range", () => {
    expect(parseBibleReference("Matthew 5:3-12")).toMatchObject({
      bookName: "Matthew",
      chapterStart: 5,
      verseStart: 3,
      verseEnd: 12,
    })
  })

  it("parses chapter-only references", () => {
    expect(parseBibleReference("1 Corinthians 13")).toMatchObject({
      bookName: "1 Corinthians",
      chapterStart: 13,
      verseStart: null,
    })
  })

  it("parses multi-word books and en-dash ranges", () => {
    expect(parseBibleReference("Song of Solomon 2:1–3")).toMatchObject({
      bookName: "Song of Solomon",
      chapterStart: 2,
      verseStart: 1,
      verseEnd: 3,
    })
  })

  it("synthesizes a stable documentId for cache keying", () => {
    const a = parseBibleReference("John 3:16")
    const b = parseBibleReference("John 3:16")
    expect(a!.documentId).toBe(b!.documentId)
    expect(a!.documentId).not.toBe(parseBibleReference("John 3:17")!.documentId)
  })

  // Conservative rejections — a wrong guess fetches the WRONG passage under a
  // right-looking reference, strictly worse than plain text. One case per
  // rejection clause.
  it.each([
    ["empty", ""],
    ["book only", "Matthew"],
    ["cross-chapter range", "Matthew 5:3-6:2"],
    ["reversed range", "Matthew 5:12-3"],
    ["zero chapter", "Matthew 0:3"],
    ["zero verse", "Matthew 5:0"],
    ["trailing prose", "Matthew 5:3 and following"],
    ["not a reference", "the sermon on the mount"],
  ])("rejects %s", (_label, raw) => {
    expect(parseBibleReference(raw)).toBeNull()
  })
})

describe("parseBibleReferences", () => {
  it("drops unparseable entries and keeps the rest", () => {
    const parsed = parseBibleReferences([
      "John 3:16",
      "not a reference",
      "Luke 15:11-32",
    ])
    expect(parsed.map((c) => c.bookName)).toEqual(["John", "Luke"])
  })

  it("caps the list so one runaway row cannot queue dozens of fetches", () => {
    const many = Array.from({ length: 12 }, (_, i) => `John ${i + 1}:1`)
    expect(parseBibleReferences(many)).toHaveLength(MAX_REFERENCES_PER_MOMENT)
  })
})
