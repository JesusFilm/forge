/**
 * The pushed reader's route contract (feat-551 U11, KTD9). U12's quote card
 * pushes `readerHref`; `app/reader.tsx` reads the params back with
 * `parseReaderRouteParams`, which fails closed to "no start reference".
 */
import type { Href } from "expo-router"

import type { VerseRef } from "../../versification/convert"
import {
  READER_PATHNAME,
  parseReaderRouteParams,
  readerHref,
} from "../readerRoute"

const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }

describe("readerHref", () => {
  it("pushes the root reader route, never the Bible tab's /bible", () => {
    expect(READER_PATHNAME).toBe("/reader")
    expect(readerHref(JOHN_3_16, "quote").pathname).toBe("/reader")
  })

  it("writes the BSB book code, chapter, verse, and source as strings", () => {
    expect(readerHref(JOHN_3_16, "quote").params).toEqual({
      book: "JHN",
      chapter: "3",
      verse: "16",
      source: "quote",
    })
  })

  it("gives a push target that expo-router accepts", () => {
    const push = (href: Href): Href => href
    expect(push(readerHref(JOHN_3_16, "quote"))).toBeTruthy()
  })
})

describe("parseReaderRouteParams", () => {
  it("reads back what the href wrote", () => {
    expect(
      parseReaderRouteParams(readerHref(JOHN_3_16, "quote").params),
    ).toEqual({ startRef: JOHN_3_16, source: "quote" })
    expect(
      parseReaderRouteParams(
        readerHref({ book: "PSA", chapter: 23, verse: 1 }, "link").params,
      ),
    ).toEqual({
      startRef: { book: "PSA", chapter: 23, verse: 1 },
      source: "link",
    })
  })

  it("keeps a gap verse, which the reader shows with its note (R21)", () => {
    expect(
      parseReaderRouteParams({ book: "MAT", chapter: "18", verse: "11" })
        .startRef,
    ).toEqual({ book: "MAT", chapter: 18, verse: 11 })
  })

  it("opens verse 1 for a link with no verse (R1)", () => {
    expect(parseReaderRouteParams({ book: "ROM", chapter: "8" })).toEqual({
      startRef: { book: "ROM", chapter: 8, verse: 1 },
      source: "link",
    })
  })

  it("reads a missing or unknown source as a link, never as a quote", () => {
    const params = { book: "JHN", chapter: "3", verse: "16" }
    expect(parseReaderRouteParams(params).source).toBe("link")
    expect(parseReaderRouteParams({ ...params, source: "tab" }).source).toBe(
      "link",
    )
    expect(
      parseReaderRouteParams({ ...params, source: ["quote"] }).source,
    ).toBe("link")
  })

  it.each<[string, Record<string, unknown>]>([
    ["no params", {}],
    ["no chapter", { book: "JHN", verse: "16" }],
    ["an unknown book", { book: "XYZ", chapter: "3", verse: "16" }],
    ["a lowercase book", { book: "jhn", chapter: "3", verse: "16" }],
    ["an OSIS book", { book: "John", chapter: "3", verse: "16" }],
    ["an array book", { book: ["JHN"], chapter: "3", verse: "16" }],
    ["chapter 0", { book: "JHN", chapter: "0", verse: "1" }],
    ["a chapter past the book", { book: "JHN", chapter: "22", verse: "1" }],
    ["verse 0", { book: "JHN", chapter: "3", verse: "0" }],
    ["a verse past the chapter", { book: "JHN", chapter: "3", verse: "37" }],
    ["a signed number", { book: "JHN", chapter: "-3", verse: "16" }],
    ["a decimal", { book: "JHN", chapter: "3", verse: "16.5" }],
    ["a padded number", { book: "JHN", chapter: " 3", verse: "16" }],
    ["a huge number", { book: "JHN", chapter: "3", verse: "1e3" }],
    ["an empty verse", { book: "JHN", chapter: "3", verse: "" }],
    ["an object", { book: "JHN", chapter: { n: 3 }, verse: "16" }],
  ])("refuses %s, so the reader keeps the saved position", (_name, params) => {
    expect(parseReaderRouteParams(params).startRef).toBeNull()
  })
})
