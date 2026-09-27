/**
 * The translation picker's list (feat-553 U10, R23, R30, R41) over the real
 * bundled catalog: the viewer's language first, the offline filter, search
 * values, and the status line each row shows.
 */
import { parseCatalog, type Catalog } from "../../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../../data/languageDefaults.generated"
import type { TranslationDownloadState } from "../../repository/translationDownloads"
import {
  buildTranslationList,
  isUpdateAvailable,
  isOnDevice,
  translationLanguageLabel,
  translationSearchValues,
  translationStatusLabel,
  viewerLanguageCodes,
} from "../translationList"

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

  it("puts a complete Bible before a partial one in one language", () => {
    const list = buildTranslationList({
      catalog: CATALOG,
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
    expect(translationStatusLabel(bsb, { kind: "bundled" })).toBe(
      "Complete Bible, On this device",
    )
    expect(translationStatusLabel(synodal, NOT_DOWNLOADED)).toBe(
      "Complete Bible",
    )
    expect(
      translationStatusLabel(synodal, {
        kind: "downloading",
        phase: "transfer",
        percent: 45,
        bytesWritten: 1,
        totalBytes: 2,
      }),
    ).toBe("Complete Bible, Downloading 45%")
    expect(
      translationStatusLabel(synodal, { kind: "failed", reason: "network" }),
    ).toBe("Complete Bible, Download stopped")
    const partial = CATALOG.translations.find((t) => !t.complete)!
    expect(translationStatusLabel(partial, NOT_DOWNLOADED)).toBe(
      "Partial Bible",
    )
  })

  it("offers an update when the kept copy has an old hash", () => {
    const old = downloaded("rus_syn", "0".repeat(64))
    expect(isUpdateAvailable(synodal, old)).toBe(true)
    expect(isUpdateAvailable(synodal, downloaded("rus_syn"))).toBe(false)
    expect(isUpdateAvailable(bsb, { kind: "bundled" })).toBe(false)
    expect(translationStatusLabel(synodal, old)).toBe(
      "Complete Bible, On this device, Update available",
    )
  })
})
