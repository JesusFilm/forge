import {
  CATALOG_FORMAT_VERSION,
  decodeBookSet,
  encodeBookSet,
  parseCatalog,
  type StoredCatalogTranslation,
} from "../catalog"
import { BIBLE_BOOKS } from "../../text/books"

const ALL_BOOKS = BIBLE_BOOKS.map((book) => book.usfm)
const NEW_TESTAMENT = BIBLE_BOOKS.filter(
  (book) => book.testament === "new",
).map((book) => book.usfm)

const RUS_SYN: StoredCatalogTranslation = {
  id: "rus_syn",
  language: "rus",
  languageName: "русский",
  languageEnglishName: "Russian",
  name: "Синодальный перевод",
  englishName: "Russian Synodal Bible",
  shortName: "SYN",
  textDirection: "ltr",
  complete: true,
  credit: "public domain",
  sha256: "0ae481d3257ba895a57748179fc194012ffbfd500c141f9c3ef042a4db4771c6",
  downloadBytes: 9_000_000,
  books: "GEN-REV",
}

const NT_ONLY: StoredCatalogTranslation = {
  ...RUS_SYN,
  id: "aai",
  language: "aai",
  complete: false,
  books: "MAT-REV",
}

function stored(translations: unknown): unknown {
  return { formatVersion: CATALOG_FORMAT_VERSION, translations }
}

describe("book sets", () => {
  it("writes runs of books in canon order as ranges", () => {
    expect(encodeBookSet(ALL_BOOKS)).toBe("GEN-REV")
    expect(encodeBookSet([...NEW_TESTAMENT].reverse())).toBe("MAT-REV")
    expect(encodeBookSet(["MAT", "RUT", "GEN", "EXO", "JUD"])).toBe(
      "GEN-EXO RUT MAT JUD",
    )
    expect(encodeBookSet([])).toBe("")
  })

  it("reads a range string back into the same books", () => {
    expect([...(decodeBookSet("GEN-REV") ?? [])]).toEqual(ALL_BOOKS)
    expect([...(decodeBookSet("GEN-EXO RUT MAT JUD") ?? [])]).toEqual([
      "GEN",
      "EXO",
      "RUT",
      "MAT",
      "JUD",
    ])
  })

  it("refuses an unknown book, a reversed range, or a repeat", () => {
    for (const text of ["", "GEN-TOB", "REV-GEN", "GEN GEN", "GEN-EXO EXO"])
      expect(decodeBookSet(text)).toBeNull()
  })
})

describe("parseCatalog", () => {
  it("reads each translation, with its books as a set", () => {
    const catalog = parseCatalog(stored([RUS_SYN, NT_ONLY]))
    expect(catalog?.translations.map((entry) => entry.id)).toEqual([
      "rus_syn",
      "aai",
    ])
    const aai = catalog?.byId.get("aai")
    expect(aai?.books.has("JHN")).toBe(true)
    expect(aai?.books.has("GEN")).toBe(false)
    expect(aai?.downloadBytes).toBe(9_000_000)
  })

  it("refuses another format version", () => {
    expect(parseCatalog({ formatVersion: 0, translations: [RUS_SYN] })).toBe(
      null,
    )
  })

  it("refuses the whole catalog when one entry is malformed", () => {
    const broken: unknown[] = [
      { ...RUS_SYN, credit: " " },
      { ...RUS_SYN, sha256: "xyz" },
      { ...RUS_SYN, downloadBytes: 0 },
      { ...RUS_SYN, textDirection: "ttb" },
      { ...RUS_SYN, books: "GEN-TOB" },
      { ...NT_ONLY, complete: true },
      { ...RUS_SYN, complete: "yes" },
    ]
    for (const entry of broken)
      expect(parseCatalog(stored([NT_ONLY, entry]))).toBeNull()
  })

  it("refuses a repeated id and an empty list", () => {
    expect(parseCatalog(stored([RUS_SYN, RUS_SYN]))).toBeNull()
    expect(parseCatalog(stored([]))).toBeNull()
    expect(parseCatalog(null)).toBeNull()
  })
})
