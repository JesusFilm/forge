/**
 * The reader sheets' route contract (feat-551 U10, KTD9). U11 turns a reader
 * control's context into a push with `readerSheetHref`; each sheet route
 * reads its params back with `parseReaderSheetParams`, which fails closed.
 */
import type { Href } from "expo-router"

import type { VerseRef } from "../../versification/convert"
import {
  READER_SHEET_PATHNAMES,
  parseReaderSheetParams,
  readerSheetHref,
  type ReaderSheetContext,
  type ReaderSheetKind,
} from "../routes"

const BSB_PSALM_23_1: VerseRef = { book: "PSA", chapter: 23, verse: 1 }
const SYNODAL_PSALM_22_1: VerseRef = { book: "PSA", chapter: 22, verse: 1 }

const CONTEXT: ReaderSheetContext = {
  translation: { id: "rus_syn" },
  translationRef: SYNODAL_PSALM_22_1,
  ref: BSB_PSALM_23_1,
  offline: false,
}

describe("readerSheetHref", () => {
  it.each<[ReaderSheetKind, string]>([
    ["passage", "/reader-passage"],
    ["translation", "/reader-translation"],
    ["settings", "/reader-settings"],
  ])("sends the %s sheet to %s", (kind, pathname) => {
    expect(readerSheetHref(kind, CONTEXT).pathname).toBe(pathname)
    expect(READER_SHEET_PATHNAMES[kind]).toBe(pathname)
  })

  it("writes every field of the context as a string param", () => {
    expect(readerSheetHref("passage", CONTEXT).params).toEqual({
      translation: "rus_syn",
      ref: "PSA.23.1",
      shownRef: "PSA.22.1",
      offline: "0",
    })
  })

  it("leaves out what the reader does not know yet", () => {
    const params = readerSheetHref("translation", {
      translation: null,
      translationRef: null,
      ref: null,
      offline: true,
    }).params
    expect(params).toEqual({ offline: "1" })
  })

  it("gives a push target that expo-router accepts", () => {
    const push = (href: Href): Href => href
    expect(push(readerSheetHref("settings", CONTEXT))).toBeTruthy()
  })
})

describe("parseReaderSheetParams", () => {
  it("reads back what the href wrote", () => {
    for (const kind of ["passage", "translation", "settings"] as const) {
      expect(
        parseReaderSheetParams(readerSheetHref(kind, CONTEXT).params),
      ).toEqual({
        translationId: "rus_syn",
        ref: BSB_PSALM_23_1,
        translationRef: SYNODAL_PSALM_22_1,
        offline: false,
      })
    }
  })

  it("reads no params as nothing known, online", () => {
    expect(parseReaderSheetParams({})).toEqual({
      translationId: null,
      ref: null,
      translationRef: null,
      offline: false,
    })
  })

  it("reads offline only from the exact flag", () => {
    expect(parseReaderSheetParams({ offline: "1" }).offline).toBe(true)
    for (const value of ["0", "true", "yes", "", ["1"], 1, true]) {
      expect(parseReaderSheetParams({ offline: value }).offline).toBe(false)
    }
  })

  it.each([
    ["a path", "../books"],
    ["a space", "rus syn"],
    ["an empty id", ""],
    ["a repeated param", ["rus_syn", "BSB"]],
    ["a number", 42],
    ["a very long id", "a".repeat(65)],
  ])("refuses a translation id with %s", (_name, translation) => {
    expect(parseReaderSheetParams({ translation }).translationId).toBeNull()
  })

  it.each([
    ["an unknown book", "XYZ.1.1"],
    ["a lower-case book", "jhn.3.16"],
    ["chapter 0", "JHN.0.1"],
    ["verse 0", "JHN.3.0"],
    ["a verse BSB lacks", "JHN.3.99"],
    ["a chapter BSB lacks", "JHN.22.1"],
    ["a fourth part", "JHN.3.16.1"],
    ["an exponent", "JHN.3.1e1"],
    ["a hex number", "JHN.0x3.16"],
    ["a sign", "JHN.+3.16"],
    ["an array", ["JHN.3.16"]],
    ["an object", { book: "JHN", chapter: 3, verse: 16 }],
  ])("refuses a BSB ref with %s", (_name, ref) => {
    expect(parseReaderSheetParams({ ref }).ref).toBeNull()
  })

  it("keeps a shown ref that only the shown numbering has", () => {
    // Hebrew numbering has a Joel 4; BSB's Joel ends at chapter 3.
    expect(parseReaderSheetParams({ ref: "JOL.4.1" }).ref).toBeNull()
    expect(
      parseReaderSheetParams({ shownRef: "JOL.4.1" }).translationRef,
    ).toEqual({ book: "JOL", chapter: 4, verse: 1 })
  })

  it.each([
    ["an unknown book", "XYZ.1.1"],
    ["chapter 0", "PSA.0.1"],
    ["a negative verse", "PSA.3.-1"],
    ["a four-digit verse", "PSA.3.1000"],
    ["missing parts", "PSA.3"],
  ])("refuses a shown ref with %s", (_name, shownRef) => {
    expect(parseReaderSheetParams({ shownRef }).translationRef).toBeNull()
  })

  it("keeps each good field when another one is bad", () => {
    expect(
      parseReaderSheetParams({
        translation: "../x",
        ref: "JHN.3.16",
        shownRef: "nonsense",
        offline: "1",
      }),
    ).toEqual({
      translationId: null,
      ref: { book: "JHN", chapter: 3, verse: 16 },
      translationRef: null,
      offline: true,
    })
  })
})
