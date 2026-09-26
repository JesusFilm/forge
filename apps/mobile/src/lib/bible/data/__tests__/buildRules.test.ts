// catalog-entries.json holds real bible.helloao.org catalog entries from
// 2026-09-25, plus one synthetic entry (see its `note`). ebible-translations.csv
// holds the real eBible.org header and five real rows, with the byte-order mark.
import catalogFixture from "./fixtures/catalog-entries.json"
import {
  BSB_CREDIT,
  REQUIRED_TRANSLATION_IDS,
  catalogEntries,
  decideLicense,
  decodeChapterFacts,
  ebibleIdFromLicenseUrl,
  encodeChapterFacts,
  missingRequiredTranslations,
  parseCsv,
  pickLanguageDefaults,
  readEbibleLicenses,
  selectCatalog,
  translationSystemTable,
  type LanguageCandidate,
  type SourceRecord,
  type TextFacts,
} from "../buildRules"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../languageDefaults.generated"
import { translationBookSystem } from "../../versification/translationSystems.generated"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const CSV = fs.readFileSync(
  `${__dirname}/fixtures/ebible-translations.csv`,
  "utf8",
)
const LICENSES = readEbibleLicenses(CSV)

type CatalogFixtureEntry = (typeof catalogFixture.translations)[number]

// Stand-in text facts: the license filter never reads them.
const TEXT: TextFacts = {
  sha256: "a".repeat(64),
  bytes: 1000,
  books: "GEN-REV",
  verses: 31000,
  chapters: {},
}

function record(entry: CatalogFixtureEntry): SourceRecord {
  const ebibleId = ebibleIdFromLicenseUrl(entry.licenseUrl)
  return {
    id: entry.id,
    name: entry.name,
    englishName: entry.englishName,
    shortName: entry.shortName,
    language: entry.language,
    languageName: entry.languageName,
    languageEnglishName: entry.languageEnglishName,
    textDirection: entry.textDirection === "rtl" ? "rtl" : "ltr",
    sha256: entry.sha256,
    licenseUrl: entry.licenseUrl,
    license: ebibleId === null ? null : (LICENSES.get(ebibleId) ?? null),
    text: TEXT,
  }
}

const RECORDS = catalogFixture.translations.map(record)

describe("parseCsv", () => {
  it("reads quoted fields with commas and doubled quotes, and drops the BOM", () => {
    const rows = parseCsv('﻿"a","b, c"\n"say ""hi""",""\n')
    expect(rows).toEqual([
      ["a", "b, c"],
      ['say "hi"', ""],
    ])
  })

  it("reads the real eBible header and rows", () => {
    const rows = parseCsv(CSV)
    expect(rows[0]?.[0]).toBe("languageCode")
    expect(rows).toHaveLength(6)
    expect(rows.every((row) => row.length === rows[0]?.length)).toBe(true)
    const abp = rows.find((row) => row[1] === "abp")
    expect(abp?.[2]).toBe("Ayta, Abellen")
  })
})

describe("readEbibleLicenses", () => {
  it("keeps the Redistributable and Copyright columns by eBible id", () => {
    expect(LICENSES.get("russyn")).toEqual({
      redistributable: true,
      copyright: "public domain",
    })
    expect(LICENSES.get("abp")).toEqual({
      redistributable: false,
      copyright: "Copyright © 2020-2024 Wycliffe Bible Translators, Inc.",
    })
    expect(LICENSES.size).toBe(5)
  })
})

describe("ebibleIdFromLicenseUrl", () => {
  it("reads the id from an eBible details link", () => {
    expect(
      ebibleIdFromLicenseUrl(
        "https://ebible.org/Scriptures/details.php?id=russyn",
      ),
    ).toBe("russyn")
    expect(
      ebibleIdFromLicenseUrl(
        "https://ebible.org/Scriptures/details.php?id=eng-web",
      ),
    ).toBe("eng-web")
  })

  it("returns null for a link that is not an eBible details page", () => {
    expect(ebibleIdFromLicenseUrl("https://berean.bible/")).toBeNull()
    expect(
      ebibleIdFromLicenseUrl(
        "https://github.com/HelloAOLab/bibles/blob/main/AAB/LICENSE",
      ),
    ).toBeNull()
    expect(
      ebibleIdFromLicenseUrl(
        "https://evil.example/Scriptures/details.php?id=x",
      ),
    ).toBeNull()
    expect(ebibleIdFromLicenseUrl("not a url")).toBeNull()
  })
})

describe("decideLicense", () => {
  it("keeps BSB on its own public-domain statement", () => {
    const bsb = RECORDS.find((entry) => entry.id === "BSB")
    expect(bsb && decideLicense(bsb)).toEqual({
      kind: "keep",
      credit: BSB_CREDIT,
    })
  })

  it("drops an entry with a blank copyright line", () => {
    const [first] = RECORDS
    if (!first) throw new Error("fixture is empty")
    expect(
      decideLicense({
        ...first,
        id: "blank",
        licenseUrl: "https://ebible.org/Scriptures/details.php?id=blank",
        license: { redistributable: true, copyright: "  " },
      }),
    ).toEqual({ kind: "drop", reason: "no-credit" })
  })
})

describe("selectCatalog", () => {
  const { kept, dropped } = selectCatalog(RECORDS)

  it("excludes the entry marked not redistributable", () => {
    expect(dropped).toContainEqual({
      id: "abp_synthetic",
      reason: "not-redistributable",
    })
    expect(kept.map((entry) => entry.id)).not.toContain("abp_synthetic")
  })

  it("drops an entry with no eBible license row or no eBible link", () => {
    expect(dropped).toContainEqual({
      id: "ron_bayash",
      reason: "no-ebible-match",
    })
    expect(dropped).toContainEqual({ id: "AAB", reason: "no-ebible-id" })
  })

  it("keeps the rest with the eBible copyright line as the credit", () => {
    expect(kept.map((entry) => [entry.id, entry.credit])).toEqual([
      ["BSB", BSB_CREDIT],
      ["ENGWEBP", "public domain"],
      ["rus_syn", "public domain"],
      ["spa_bes", "Copyright © 2018, 2019 AudioBiblia.org /Irma Flores"],
    ])
  })

  it("drops an entry whose text failed to fetch or to normalize", () => {
    const [bsb, engwebp] = RECORDS.filter(
      (entry) => entry.id === "BSB" || entry.id === "ENGWEBP",
    )
    if (!bsb || !engwebp) throw new Error("fixture lacks BSB or ENGWEBP")
    const result = selectCatalog([
      { ...bsb, text: { rejected: "no-verses" } },
      { ...engwebp, text: { missing: 404 } },
    ])
    expect(result.kept).toHaveLength(0)
    expect(result.dropped).toEqual([
      { id: "BSB", reason: "text-rejected" },
      { id: "ENGWEBP", reason: "source-missing" },
    ])
  })
})

describe("omitted books", () => {
  const [rus] = RECORDS.filter((entry) => entry.id === "rus_syn")
  if (!rus) throw new Error("fixture lacks rus_syn")

  it("keeps a translation that lost a book, as a partial Bible", () => {
    const record = {
      ...rus,
      text: {
        ...TEXT,
        books: "GEN-HOS AMO-REV",
        omitted: { JOL: "no-verses 3" },
      },
    }
    const [kept] = selectCatalog([record]).kept
    expect(kept?.complete).toBe(false)
    expect(catalogEntries(kept ? [kept] : [])[0]?.books).toBe("GEN-HOS AMO-REV")
  })

  it("refuses a lock that lists an omitted book in the book set", () => {
    const record = {
      ...rus,
      text: { ...TEXT, omitted: { JOL: "no-verses 3" } },
    }
    expect(() => selectCatalog([record])).toThrow(
      "rus_syn lists JOL as omitted and as present",
    )
  })
})

describe("catalogEntries", () => {
  it("uses the id as the short name when the catalog has none (nld_)", () => {
    const [rus] = selectCatalog(RECORDS).kept.filter(
      (entry) => entry.id === "rus_syn",
    )
    if (!rus) throw new Error("rus_syn was not kept")
    const [entry] = catalogEntries([{ ...rus, id: "nld_", shortName: "" }])
    expect(entry?.shortName).toBe("nld_")
    expect(entry?.downloadBytes).toBe(TEXT.bytes)
    expect(entry?.complete).toBe(true)
  })
})

describe("missingRequiredTranslations", () => {
  it("names BSB and the Russian Synodal Bible when either is absent", () => {
    expect(REQUIRED_TRANSLATION_IDS).toEqual(["BSB", "rus_syn"])
    expect(missingRequiredTranslations(["BSB", "rus_syn", "x"])).toEqual([])
    expect(missingRequiredTranslations(["BSB"])).toEqual(["rus_syn"])
    expect(missingRequiredTranslations([])).toEqual(["BSB", "rus_syn"])
  })
})

describe("pickLanguageDefaults", () => {
  function candidate(
    id: string,
    language: string,
    complete: boolean,
    verses: number,
  ): LanguageCandidate {
    return { id, language, complete, verses }
  }

  it("maps eng to BSB, even when another English Bible has more verses", () => {
    expect(
      pickLanguageDefaults([
        candidate("ENGWEBP", "eng", true, 31102),
        candidate("BSB", "eng", true, 31086),
      ]),
    ).toEqual({ eng: "BSB" })
  })

  it("prefers a complete Bible over a partial one with more verses", () => {
    expect(
      pickLanguageDefaults([
        candidate("spa_big_nt", "spa", false, 40000),
        candidate("spa_bes", "spa", true, 31101),
      ]),
    ).toEqual({ spa: "spa_bes" })
  })

  it("breaks a tie by the most verses, then by the lower id", () => {
    expect(
      pickLanguageDefaults([
        candidate("spa_bes", "spa", true, 31101),
        candidate("spa_blm", "spa", true, 31103),
        candidate("fra_b", "fra", true, 31000),
        candidate("fra_a", "fra", true, 31000),
        candidate("aai_nt", "aai", false, 7955),
      ]),
    ).toEqual({ aai: "aai_nt", fra: "fra_a", spa: "spa_blm" })
  })
})

describe("chapter facts", () => {
  it("round-trips a book as its chapter count and chosen last verses", () => {
    const facts = { chapterCount: 150, lastVerses: { 3: 8, 2: 12 } }
    expect(encodeChapterFacts(facts)).toBe("150 2:12 3:8")
    expect(decodeChapterFacts("150 2:12 3:8")).toEqual({
      chapterCount: 150,
      lastVerses: { 2: 12, 3: 8 },
    })
    expect(decodeChapterFacts("21")).toEqual({
      chapterCount: 21,
      lastVerses: {},
    })
  })

  it("refuses a malformed string", () => {
    for (const text of [
      "",
      "x",
      "150 2:",
      "150 2:0",
      "3 4:5",
      "0",
      "3 2:5 2:6",
    ])
      expect(decodeChapterFacts(text)).toBeNull()
  })
})

describe("translationSystemTable", () => {
  it("gives BSB the bsb system without classifying it", () => {
    const bsb = selectCatalog(RECORDS).kept.find((entry) => entry.id === "BSB")
    if (!bsb) throw new Error("BSB was not kept")
    expect(translationSystemTable([bsb], {}).table).toEqual({
      BSB: { main: "bsb" },
    })
  })

  it("lets an override win and refuses one for an unknown translation", () => {
    const rus = selectCatalog(RECORDS).kept.find(
      (entry) => entry.id === "rus_syn",
    )
    if (!rus) throw new Error("rus_syn was not kept")
    const result = translationSystemTable([rus], {
      rus_syn: { JOL: { system: "org", reason: "test" } },
      nope: { JOL: { system: "org", reason: "test" } },
    })
    // main is left out when it is eng, the default.
    expect(result.table.rus_syn).toEqual({ JOL: "org" })
    expect(result.errors).toEqual([
      "override for nope: the translation is not in the catalog",
    ])
    expect(result.overridden).toEqual(["rus_syn JOL: main eng -> org"])
  })
})

describe("the committed tables", () => {
  it("map eng to BSB and rus to the Russian Synodal Bible", () => {
    expect(LANGUAGE_DEFAULT_TRANSLATIONS.eng).toBe("BSB")
    expect(LANGUAGE_DEFAULT_TRANSLATIONS.rus).toBe("rus_syn")
  })

  it("number each book in its translation's system", () => {
    expect(translationBookSystem("BSB", "PSA")).toBe("bsb")
    expect(translationBookSystem("rus_syn", "PSA")).toBe("rsc")
    expect(translationBookSystem("rus_syn", "DAN")).toBe("rsc")
    expect(translationBookSystem("dan_det", "JOL")).toBe("org")
    expect(translationBookSystem("not_in_catalog", "PSA")).toBe("eng")
  })
})
