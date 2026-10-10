// A switch to a partial Bible that lacks the current book (owner, 2026-09-28):
// the reader warns, then opens the translation at its start. The catalog is
// the real bundled one, so the book sets are production shapes.
import { parseCatalog, type Catalog } from "../../data/catalog"
import { catalogHasBook } from "../../repository/resolveChapter"
import type { UsfmBookId } from "../../text/books"
import type { VerseRef } from "../../versification/convert"
import { getT } from "../../../../i18n/useT"
import { partialSwitch, translationStart } from "../partialSwitch"

const T = getT("BibleTranslationPicker")

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
/** A New Testament only. */
const WBT = CATALOG.byId.get("cpc_wbt")!
/** Selections: Ruth, Proverbs, Luke, John, Acts. */
const GUE = CATALOG.byId.get("gue_wbt")!
const SYNODAL = CATALOG.byId.get("rus_syn")!
const DEUTERONOMY_2_4: VerseRef = { book: "DEU", chapter: 2, verse: 4 }

describe("translationStart", () => {
  it("is the first book the translation has, at 1:1", () => {
    expect(translationStart(WBT, catalogHasBook)).toEqual({
      shown: { book: "MAT", chapter: 1, verse: 1 },
      bsb: { book: "MAT", chapter: 1, verse: 1 },
    })
    expect(translationStart(GUE, catalogHasBook)?.shown.book).toBe("RUT")
    expect(translationStart(SYNODAL, catalogHasBook)?.shown.book).toBe("GEN")
  })

  it("asks `hasBook`, so a download's own book list wins (R25)", () => {
    const onlyJohn = (_: unknown, book: UsfmBookId) => book === "JHN"
    expect(translationStart(WBT, onlyJohn)?.shown.book).toBe("JHN")
    expect(translationStart(WBT, () => false)).toBeNull()
  })
})

describe("partialSwitch", () => {
  const input = {
    translation: WBT,
    ref: DEUTERONOMY_2_4,
    shownRef: DEUTERONOMY_2_4,
    hasBook: catalogHasBook,
  }

  it("warns for a book the translation lacks, and names both places", () => {
    expect(partialSwitch(T, input)).toEqual({
      start: {
        shown: { book: "MAT", chapter: 1, verse: 1 },
        bsb: { book: "MAT", chapter: 1, verse: 1 },
      },
      title: "WBT does not have Deuteronomy",
      message: `${WBT.name} is a partial Bible. If you switch, the reader goes to its start, Matthew 1:1. You lose your place at Deuteronomy 2:4.`,
      cancelLabel: "Cancel",
      confirmLabel: "Switch",
    })
  })

  it("names the place as the reader shows it, in the shown numbers", () => {
    // Synodal Psalm 22 is BSB Psalm 23; the viewer saw Psalm 22.
    const warning = partialSwitch(T, {
      ...input,
      ref: { book: "PSA", chapter: 23, verse: 1 },
      shownRef: { book: "PSA", chapter: 22, verse: 1 },
    })
    expect(warning?.message).toContain("your place at Psalms 22:1.")
  })

  it("does not warn when the translation has the book, or with no place", () => {
    expect(
      partialSwitch(T, {
        ...input,
        ref: { book: "JHN", chapter: 3, verse: 16 },
      }),
    ).toBeNull()
    expect(partialSwitch(T, { ...input, translation: SYNODAL })).toBeNull()
    expect(partialSwitch(T, { ...input, ref: null })).toBeNull()
  })
})
