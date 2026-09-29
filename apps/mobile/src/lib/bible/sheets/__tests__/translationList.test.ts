/**
 * The translation picker's list (feat-553 U10, R23, R30, R41) over the real
 * bundled catalog: the viewer's language first, the offline filter, search
 * values, and the status line each row shows.
 */
import { parseCatalog, type Catalog } from "../../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../../data/languageDefaults.generated"
import type { TranslationDownloadState } from "../../repository/translationDownloads"
import { BIBLE_BOOKS, type UsfmBookId } from "../../text/books"
import {
  buildTranslationList,
  coverageLabel,
  isUpdateAvailable,
  isOnDevice,
  translationLanguageLabel,
  translationSearchValues,
  translationStatusLabel,
  viewerLanguageCodes,
} from "../translationList"
import { getT } from "../../../../i18n/useT"

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
const NOT_DOWNLOADED: TranslationDownloadState = { kind: "not-downloaded" }

function statesOf(
  entries: Record<string, TranslationDownloadState>,
): (id: string) => TranslationDownloadState {
  return (id) =>
    id === "BSB" ? { kind: "bundled" } : (entries[id] ?? NOT_DOWNLOADED)
}

function downloaded(id: string, sha256?: string): TranslationDownloadState {
  const translation = CATALOG.byId.get(id)
  if (!translation) throw new Error(`no ${id} in the catalog`)
  return {
    kind: "downloaded",
    sha256: sha256 ?? translation.sha256,
    books: translation.books,
    bytes: translation.downloadBytes,
  }
}

const SPANISH_COUNT = CATALOG.translations.filter(
  (translation) => translation.language === "spa",
).length

describe("viewerLanguageCodes", () => {
  it("maps the audio and phone codes to catalog languages, once each", () => {
    expect(viewerLanguageCodes(["spa", "es"])).toEqual(["spa"])
    expect(viewerLanguageCodes(["rus", "en"])).toEqual(["rus", "eng"])
  })

  it("drops a code with no catalog Bible", () => {
    expect(viewerLanguageCodes([null, undefined, "zz", "xx-YY"])).toEqual([])
  })
})

describe("buildTranslationList", () => {
  it("lists Spanish entries first for a Spanish viewer", () => {
    expect(SPANISH_COUNT).toBeGreaterThan(1)
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: ["spa"],
      onDeviceOnly: false,
      getState: statesOf({}),
    })
    const head = list.slice(0, SPANISH_COUNT)
    expect(head.every((translation) => translation.language === "spa")).toBe(
      true,
    )
    expect(list[SPANISH_COUNT]?.language).not.toBe("spa")
    // The language's default translation leads its group.
    expect(list[0]?.id).toBe(LANGUAGE_DEFAULT_TRANSLATIONS.spa)
  })

  it("lists every catalog translation exactly once online", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: ["spa"],
      onDeviceOnly: false,
      getState: statesOf({}),
    })
    expect(list).toHaveLength(CATALOG.translations.length)
    expect(new Set(list.map((translation) => translation.id)).size).toBe(
      CATALOG.translations.length,
    )
  })

  it("puts the audio language before the phone language", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: ["rus", "spa"],
      onDeviceOnly: false,
      getState: statesOf({}),
    })
    const russian = CATALOG.translations.filter(
      (translation) => translation.language === "rus",
    ).length
    expect(list.slice(0, russian).map((t) => t.language)).toEqual(
      Array(russian).fill("rus"),
    )
    expect(
      list.slice(russian, russian + SPANISH_COUNT).map((t) => t.language),
    ).toEqual(Array(SPANISH_COUNT).fill("spa"))
  })

  it("orders the rest by the language's English name", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: [],
      onDeviceOnly: false,
      getState: statesOf({}),
    })
    const names = list.map((translation) => translation.languageEnglishName)
    const sorted = [...names].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    )
    expect(names).toEqual(sorted)
  })

  // KTD15: names sort in the UI tag's collation, so one tag gives one order
  // on every device. Russian collation puts Cyrillic first; English puts it last.
  it("orders translation names by the UI tag it gets", () => {
    const base = CATALOG.byId.get("BSB")
    if (!base) throw new Error("no BSB in the catalog")
    const named = (id: string, name: string) => ({
      ...base,
      id,
      name,
      language: "xyz",
    })
    const translations = [
      named("t-en", "English Bible"),
      named("t-ru", "Русская Библия"),
      named("t-de", "Deutsche Bibel"),
    ]
    const catalog: Catalog = {
      translations,
      byId: new Map(translations.map((t) => [t.id, t])),
    }
    const order = (uiTag: string) =>
      buildTranslationList({
        catalog,
        uiTag,
        viewerLanguages: [],
        onDeviceOnly: false,
        getState: statesOf({}),
        languageDefaults: {},
      }).map((translation) => translation.id)
    expect(order("ru")).toEqual(["t-ru", "t-de", "t-en"])
    expect(order("en")).toEqual(["t-de", "t-en", "t-ru"])
  })

  it("puts a complete Bible before a partial one in one language", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: ["eng"],
      onDeviceOnly: false,
      getState: statesOf({}),
    })
    const english = list.filter((translation) => translation.language === "eng")
    const firstPartial = english.findIndex(
      (translation) => !translation.complete,
    )
    expect(firstPartial).toBeGreaterThan(0)
    expect(english.slice(firstPartial).every((t) => !t.complete)).toBe(true)
    // English's default is BSB.
    expect(english[0]?.id).toBe("BSB")
  })

  it("offline, lists only BSB and downloaded translations", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
      uiTag: "en",
      viewerLanguages: ["spa"],
      onDeviceOnly: true,
      getState: statesOf({
        rus_syn: downloaded("rus_syn"),
        spa_r09: downloaded("spa_r09", "0".repeat(64)),
        spa_bes: {
          kind: "downloading",
          phase: "transfer",
          percent: 40,
          bytesWritten: 1,
          totalBytes: 2,
        },
        spa_pdt: { kind: "failed", reason: "network" },
        spa_blm: { kind: "checking" },
      }),
    })
    expect(list.map((translation) => translation.id)).toEqual([
      "spa_r09",
      "BSB",
      "rus_syn",
    ])
  })
})

describe("isOnDevice", () => {
  const installing: TranslationDownloadState = {
    kind: "downloading",
    phase: "install",
    percent: 100,
    bytesWritten: 2,
    totalBytes: 2,
  }
  it.each<[string, boolean, TranslationDownloadState]>([
    ["bundled", true, { kind: "bundled" }],
    ["downloaded", true, downloaded("rus_syn")],
    ["checking", false, { kind: "checking" }],
    ["not-downloaded", false, NOT_DOWNLOADED],
    ["downloading", false, installing],
    ["failed", false, { kind: "failed", reason: "network" }],
  ])("reads %s as on the device: %s", (_kind, expected, state) => {
    expect(isOnDevice(state)).toBe(expected)
  })
})

describe("row labels", () => {
  const synodal = CATALOG.byId.get("rus_syn")!
  const bsb = CATALOG.byId.get("BSB")!

  it("lets search find the Synodal Bible by its English name", () => {
    const values = translationSearchValues(synodal).map((value) =>
      value.toLowerCase(),
    )
    expect(values.some((value) => value.includes("synodal"))).toBe(true)
    expect(values).toContain("russian")
    expect(values).toContain(synodal.languageName.toLowerCase())
  })

  it("names the language in its own words and in English", () => {
    expect(translationLanguageLabel(synodal)).toBe("русский · Russian")
    expect(translationLanguageLabel(bsb)).toBe("English")
  })

  it("says whether the Bible is complete, and whether it is on the device", () => {
    expect(translationStatusLabel(T, bsb, { kind: "bundled" })).toBe(
      "Complete Bible, On this device",
    )
    expect(translationStatusLabel(T, synodal, NOT_DOWNLOADED)).toBe(
      "Complete Bible",
    )
    expect(
      translationStatusLabel(T, synodal, {
        kind: "downloading",
        phase: "transfer",
        percent: 45,
        bytesWritten: 1,
        totalBytes: 2,
      }),
    ).toBe("Complete Bible, Downloading 45%")
    expect(
      translationStatusLabel(T, synodal, { kind: "failed", reason: "network" }),
    ).toBe("Complete Bible, Download stopped")
    // A partial Bible says which books it has (owner, 2026-09-28).
    const newTestament = CATALOG.byId.get("cpc_wbt")!
    expect(translationStatusLabel(T, newTestament, NOT_DOWNLOADED)).toBe(
      "New Testament only",
    )
  })

  it("offers an update when the kept copy has an old hash", () => {
    const old = downloaded("rus_syn", "0".repeat(64))
    expect(isUpdateAvailable(synodal, old)).toBe(true)
    expect(isUpdateAvailable(synodal, downloaded("rus_syn"))).toBe(false)
    expect(isUpdateAvailable(bsb, { kind: "bundled" })).toBe(false)
    expect(translationStatusLabel(T, synodal, old)).toBe(
      "Complete Bible, On this device, Update available",
    )
  })
})

describe("coverageLabel", () => {
  const books = (...ids: UsfmBookId[]) => new Set<UsfmBookId>(ids)
  const testament = (key: "old" | "new") =>
    BIBLE_BOOKS.filter((book) => book.testament === key).map((b) => b.usfm)

  it("names a whole testament as a unit", () => {
    expect(coverageLabel(T, books(...testament("new")))).toBe(
      "New Testament only",
    )
    expect(coverageLabel(T, books(...testament("old")))).toBe(
      "Old Testament only",
    )
  })

  it("names up to two books added to a testament, and counts more", () => {
    const nt = testament("new")
    expect(coverageLabel(T, books(...nt, "GEN"))).toBe(
      "New Testament and Genesis",
    )
    expect(coverageLabel(T, books(...nt, "PSA", "GEN"))).toBe(
      "New Testament, Genesis, and Psalms",
    )
    expect(coverageLabel(T, books(...nt, "GEN", "RUT", "PSA"))).toBe(
      "New Testament and 3 other books",
    )
    expect(coverageLabel(T, books(...testament("old"), "MAT"))).toBe(
      "Old Testament and Matthew",
    )
  })

  it("names up to three books in canon order, and counts more", () => {
    expect(coverageLabel(T, books("MRK"))).toBe("Only Mark")
    expect(coverageLabel(T, books("LUK", "PSA"))).toBe("Only Psalms and Luke")
    expect(coverageLabel(T, books("JHN", "RUT", "LUK"))).toBe(
      "Only Ruth, Luke, and John",
    )
    expect(coverageLabel(T, books("RUT", "PRO", "LUK", "JHN", "ACT"))).toBe(
      "5 of 66 books",
    )
  })

  it("labels every partial Bible in the catalog", () => {
    for (const translation of CATALOG.translations) {
      if (translation.complete) continue
      expect(coverageLabel(T, translation.books)).not.toBe("")
    }
  })
})
