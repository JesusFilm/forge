/**
 * The default translation (feat-551 U5, R22, R25, R41, KTD7, KTD8). The rules
 * read the bundled catalog and the generated language table. The AE16 cases
 * check the device through a real U4 repository on jest-expo's file system.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// The position store binds AsyncStorage at import; these cases never reach it.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { Directory, Paths } from "expo-file-system"

import { parseCatalog, type Catalog } from "../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../data/languageDefaults.generated"
import {
  chooseViewerTranslation,
  isNoNetworkFailure,
  languageDefaultTranslationId,
  resolveShownTranslation,
  type ShownTranslationInput,
} from "../language/defaultTranslation"
import {
  ISO_639_1_TO_639_3,
  catalogLanguageCode,
  readPhoneLanguageCode,
} from "../language/phoneLanguage"
import { createReadingPositionStore } from "../position/store"
import { parseStoredReadingPosition } from "../position/snapshot"
import { createChapterCache } from "../repository/chapterCache"
import {
  CHAPTER_FAILURE_REASONS,
  type ChapterFailureReason,
} from "../repository/errors"
import type { ChapterFetchResult } from "../repository/fetchChapter"
import { createChapterRepository } from "../repository/resolveChapter"
import { createTranslationDownloads } from "../repository/translationDownloads"
import { normalizeChapterFile } from "../text/normalize"
import type { VerseRef } from "../versification/convert"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const SPANISH = "spa_bes"
const FRENCH = "fra_ncl"
/** An NT-only default (MAT-REV): its language has no Genesis. */
const NT_ONLY_LANGUAGE = "aai"
const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
const JOHN_3_17: VerseRef = { book: "JHN", chapter: 3, verse: 17 }
const GENESIS_1_1: VerseRef = { book: "GEN", chapter: 1, verse: 1 }

const NO_CHOICE = {
  catalog: CATALOG,
  sessionTranslationId: null,
  explicitTranslationId: null,
  audioLanguage: null,
  phoneLanguage: null,
} as const

function translation(id: string) {
  const entry = CATALOG.byId.get(id)
  if (!entry) throw new Error(`${id} is not in the catalog`)
  return entry
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe("the table data this suite relies on", () => {
  it("has the defaults the cases name", () => {
    expect(LANGUAGE_DEFAULT_TRANSLATIONS.spa).toBe(SPANISH)
    expect(LANGUAGE_DEFAULT_TRANSLATIONS.fra).toBe(FRENCH)
    expect(LANGUAGE_DEFAULT_TRANSLATIONS.eng).toBe("BSB")
    const ntOnly = translation(
      LANGUAGE_DEFAULT_TRANSLATIONS[NT_ONLY_LANGUAGE] ?? "",
    )
    expect(ntOnly.books.has("GEN")).toBe(false)
    expect(ntOnly.books.has("JHN")).toBe(true)
  })
})

describe("R22, R41: the viewer's translation", () => {
  it("follows the audio language while no pick is saved", () => {
    expect(
      chooseViewerTranslation({ ...NO_CHOICE, audioLanguage: "spa" }),
    ).toEqual({ translationId: SPANISH, source: "audio" })
    expect(
      chooseViewerTranslation({ ...NO_CHOICE, audioLanguage: "fra" }),
    ).toEqual({ translationId: FRENCH, source: "audio" })
  })

  it("keeps an explicit pick after the audio language changes", () => {
    for (const audioLanguage of ["spa", "fra", "eng", null]) {
      expect(
        chooseViewerTranslation({
          ...NO_CHOICE,
          explicitTranslationId: "rus_syn",
          audioLanguage,
          phoneLanguage: "fr",
        }),
      ).toEqual({ translationId: "rus_syn", source: "explicit" })
    }
  })

  it("puts the R31 session switch before the saved pick", () => {
    expect(
      chooseViewerTranslation({
        ...NO_CHOICE,
        sessionTranslationId: "BSB",
        explicitTranslationId: "rus_syn",
        audioLanguage: "spa",
      }),
    ).toEqual({ translationId: "BSB", source: "session" })
  })

  it("falls back from an unknown audio code to the phone language, then BSB", () => {
    for (const audioLanguage of ["xxx", "", null, "not a code"]) {
      expect(
        chooseViewerTranslation({
          ...NO_CHOICE,
          audioLanguage,
          phoneLanguage: "fr",
        }),
      ).toEqual({ translationId: FRENCH, source: "phone" })
      expect(
        chooseViewerTranslation({
          ...NO_CHOICE,
          audioLanguage,
          phoneLanguage: "xx",
        }),
      ).toEqual({ translationId: "BSB", source: "bsb-default" })
    }
  })

  it("resolves English audio to BSB", () => {
    expect(
      chooseViewerTranslation({ ...NO_CHOICE, audioLanguage: "eng" }),
    ).toEqual({ translationId: "BSB", source: "audio" })
  })

  it("reaches the catalog through a macrolanguage audio code (KTD8)", () => {
    expect(
      chooseViewerTranslation({ ...NO_CHOICE, audioLanguage: "zho" })
        .translationId,
    ).toBe(LANGUAGE_DEFAULT_TRANSLATIONS.cmn)
    expect(
      chooseViewerTranslation({ ...NO_CHOICE, audioLanguage: "ara" })
        .translationId,
    ).toBe(LANGUAGE_DEFAULT_TRANSLATIONS.arb)
  })

  it("skips a pick that the catalog no longer lists", () => {
    expect(
      chooseViewerTranslation({
        ...NO_CHOICE,
        sessionTranslationId: "gone_one",
        explicitTranslationId: "gone_two",
        audioLanguage: "spa",
      }),
    ).toEqual({ translationId: SPANISH, source: "audio" })
  })

  it("gives no default for a language outside the catalog", () => {
    expect(languageDefaultTranslationId("xxx", CATALOG)).toBeNull()
    expect(languageDefaultTranslationId(null, CATALOG)).toBeNull()
    expect(languageDefaultTranslationId("spa", CATALOG)).toBe(SPANISH)
  })
})

describe("R41: the offline stand-in, against real repository state", () => {
  const OFFLINE: ChapterFetchResult = { status: "failed", reason: "offline" }

  beforeEach(() => {
    for (const root of [Paths.document, Paths.cache]) {
      const bible = new Directory(root, "bible")
      if (bible.exists) bible.delete()
    }
  })

  function repositoryParts() {
    const cache = createChapterCache()
    const fetchChapter = jest.fn(async () => OFFLINE)
    const repository = createChapterRepository({
      loadBundledBook: async () => ({
        status: "failed",
        reason: "asset-unavailable",
      }),
      downloads: createTranslationDownloads({
        port: async () => {
          throw new Error("no downloads in this suite")
        },
      }),
      cache,
      fetchChapter,
    })
    return { repository, cache, fetchChapter }
  }

  function memoryStorage() {
    const items = new Map<string, string>()
    return {
      items,
      getItem: jest.fn(async (key: string) => items.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        items.set(key, value)
      }),
    }
  }

  function inputFor(
    parts: ReturnType<typeof repositoryParts>,
    extra: Partial<ShownTranslationInput>,
  ): ShownTranslationInput {
    return {
      ...NO_CHOICE,
      audioLanguage: "spa",
      phoneLanguage: "en",
      ref: JOHN_3_16,
      offline: false,
      isOnDevice: parts.repository.isOnDevice,
      hasBook: parts.repository.translationHasBook,
      ...extra,
    }
  }

  it("covers AE16: shows BSB offline, saves no choice, and shows Spanish online", async () => {
    const parts = repositoryParts()
    const storage = memoryStorage()
    const position = createReadingPositionStore(storage)
    await position.hydrate()
    const spanish = translation(SPANISH)

    // First open with no network: the Spanish chapter cannot load.
    const attempt = await parts.repository.resolve({
      translationId: SPANISH,
      bookId: "JHN",
      chapter: 3,
      sha256: spanish.sha256,
    })
    expect(attempt.status).toBe("failed")
    const offline =
      attempt.status === "failed" && isNoNetworkFailure(attempt.reason)
    expect(offline).toBe(true)

    const shown = await resolveShownTranslation(
      inputFor(parts, {
        explicitTranslationId: position.getSnapshot().translationId,
        offline,
      }),
    )
    expect(shown?.translation.id).toBe("BSB")
    expect(shown?.reason).toBe("offline-stand-in")
    expect(shown?.viewer).toEqual({ translationId: SPANISH, source: "audio" })

    // The viewer reads on in BSB; each move saves only the verse.
    position.moveTo(JOHN_3_17)
    await settle()
    expect(position.getSnapshot().translationId).toBeNull()
    expect(
      parseStoredReadingPosition(
        storage.items.get("bible-reader-position") ?? null,
      ),
    ).toEqual({ ref: JOHN_3_17, translationId: null })

    // The network returns, and the viewer opens the reader again.
    const again = await resolveShownTranslation(
      inputFor(parts, {
        explicitTranslationId: position.getSnapshot().translationId,
        ref: JOHN_3_17,
        offline: false,
      }),
    )
    expect(again?.translation.id).toBe(SPANISH)
    expect(again?.reason).toBe("viewer")
  })

  it("shows a Spanish chapter that is on the device, offline", async () => {
    const parts = repositoryParts()
    const spanish = translation(SPANISH)
    const text = normalizeChapterFile(
      JSON.parse(
        fs.readFileSync(
          `${__dirname}/../repository/__tests__/fixtures/gue_wbt-JHN-3.json`,
          "utf8",
        ),
      ),
    )
    if (text.status !== "ok") throw new Error(text.reason)
    const kept = { ...text.value, translationId: SPANISH }
    const key = {
      translationId: SPANISH,
      bookId: "JHN" as const,
      chapter: 3,
      sha256: spanish.sha256,
    }
    expect(parts.cache.write(key, kept)).toBe(true)

    const shown = await resolveShownTranslation(
      inputFor(parts, { offline: true }),
    )

    expect(shown?.translation.id).toBe(SPANISH)
    expect(shown?.reason).toBe("viewer")
  })

  it("gives an explicit pick no stand-in; R31's message handles it", async () => {
    const parts = repositoryParts()

    const shown = await resolveShownTranslation(
      inputFor(parts, { explicitTranslationId: SPANISH, offline: true }),
    )

    expect(shown?.translation.id).toBe(SPANISH)
    expect(shown?.reason).toBe("viewer")
    expect(shown?.viewer.source).toBe("explicit")
  })

  it("does not check the device while the network answers", async () => {
    const parts = repositoryParts()
    const isOnDevice = jest.fn(parts.repository.isOnDevice)

    const shown = await resolveShownTranslation(
      inputFor(parts, { isOnDevice, offline: false }),
    )

    expect(shown?.translation.id).toBe(SPANISH)
    expect(isOnDevice).not.toHaveBeenCalled()
  })

  it("stands in for a phone default that R25 chose for a missing book", async () => {
    const parts = repositoryParts()

    const shown = await resolveShownTranslation(
      inputFor(parts, {
        audioLanguage: NT_ONLY_LANGUAGE,
        phoneLanguage: "fr",
        ref: GENESIS_1_1,
        offline: true,
      }),
    )

    expect(shown?.translation.id).toBe("BSB")
    expect(shown?.reason).toBe("offline-stand-in")
  })

  it("treats a failed device check as not on the device", async () => {
    const parts = repositoryParts()

    const shown = await resolveShownTranslation(
      inputFor(parts, {
        offline: true,
        isOnDevice: async () => {
          throw new Error("disk")
        },
      }),
    )

    expect(shown?.reason).toBe("offline-stand-in")
  })
})

describe("R25: a book the viewer's translation lacks", () => {
  const onDevice = async () => true

  it("shows the phone language's default when it has the book", async () => {
    const shown = await resolveShownTranslation({
      ...NO_CHOICE,
      audioLanguage: NT_ONLY_LANGUAGE,
      phoneLanguage: "fr",
      ref: GENESIS_1_1,
      offline: false,
      isOnDevice: onDevice,
    })

    expect(shown?.translation.id).toBe(FRENCH)
    expect(shown?.reason).toBe("book-fallback")
    expect(shown?.viewer.source).toBe("audio")
  })

  it("shows BSB when the phone language has no Bible with the book", async () => {
    const shown = await resolveShownTranslation({
      ...NO_CHOICE,
      audioLanguage: NT_ONLY_LANGUAGE,
      phoneLanguage: "xx",
      ref: GENESIS_1_1,
      offline: false,
      isOnDevice: onDevice,
    })

    expect(shown?.translation.id).toBe("BSB")
    expect(shown?.reason).toBe("book-fallback")
  })

  it("keeps the viewer's translation for a book it has", async () => {
    const shown = await resolveShownTranslation({
      ...NO_CHOICE,
      audioLanguage: NT_ONLY_LANGUAGE,
      phoneLanguage: "fr",
      ref: JOHN_3_16,
      offline: false,
      isOnDevice: onDevice,
    })

    expect(shown?.translation.id).toBe(LANGUAGE_DEFAULT_TRANSLATIONS.aai)
    expect(shown?.reason).toBe("viewer")
  })
})

describe("isNoNetworkFailure", () => {
  it("is true only when no answer came, as U4 counts it", () => {
    const noAnswer = CHAPTER_FAILURE_REASONS.filter((reason) =>
      isNoNetworkFailure(reason),
    )
    expect(noAnswer).toEqual<ChapterFailureReason[]>(["offline", "timeout"])
  })
})

describe("KTD8: the phone language table", () => {
  /**
   * Every ISO 639-1 language with no route to a catalog Bible, today. A
   * catalog update that adds one of these turns this red on purpose.
   */
  const UNREACHABLE = [
    "aa",
    "ab",
    "ae",
    "af",
    "an",
    "av",
    "ay",
    "ba",
    "bg",
    "bh",
    "bi",
    "bm",
    "bs",
    "ca",
    "ce",
    "co",
    "cr",
    "cu",
    "cv",
    "cy",
    "dv",
    "dz",
    "el",
    "eu",
    "fj",
    "fo",
    "fy",
    "ga",
    "gd",
    "gl",
    "gn",
    "gv",
    "hy",
    "hz",
    "ia",
    "ie",
    "ii",
    "io",
    "iu",
    "jv",
    "ka",
    "kg",
    "kj",
    "kk",
    "kl",
    "km",
    "kr",
    "ks",
    "ku",
    "kv",
    "kw",
    "ky",
    "lb",
    "li",
    "lo",
    "lu",
    "lv",
    "mh",
    "mi",
    "mk",
    "mn",
    "mt",
    "na",
    "ng",
    "nn",
    "nr",
    "nv",
    "oc",
    "oj",
    "os",
    "pi",
    "ps",
    "rm",
    "rn",
    "rw",
    "sc",
    "sd",
    "se",
    "sg",
    "si",
    "sl",
    "sm",
    "sq",
    "ss",
    "st",
    "su",
    "ti",
    "tk",
    "ts",
    "tt",
    "ty",
    "uz",
    "ve",
    "vo",
    "wa",
    "xh",
    "za",
    "zu",
  ]

  it("lists every ISO 639-1 code once, each with a 639-3 code", () => {
    const entries = Object.entries(ISO_639_1_TO_639_3)
    expect(entries).toHaveLength(184)
    for (const [two, three] of entries) {
      expect(two).toMatch(/^[a-z]{2}$/)
      expect(three).toMatch(/^[a-z]{3}$/)
    }
  })

  it("maps the KTD8 examples to the catalog's individual languages", () => {
    const expected: Record<string, string> = {
      zh: "cmn",
      ar: "arb",
      fa: "pes",
      sw: "swh",
      ne: "npi",
      or: "ory",
      om: "gaz",
      nb: "nob",
      no: "nob",
      et: "ekk",
      en: "eng",
      es: "spa",
    }
    for (const [code, language] of Object.entries(expected)) {
      expect([code, catalogLanguageCode(code)]).toEqual([code, language])
    }
  })

  it("normalizes a macrolanguage code from admin to a catalog language", () => {
    const expected: Record<string, string> = {
      zho: "cmn",
      ara: "arb",
      fas: "pes",
      swa: "swh",
      nep: "npi",
      ori: "ory",
      orm: "gaz",
      nor: "nob",
      est: "ekk",
      msa: "zlm",
      aka: "twi",
      aze: "azb",
      yid: "ydd",
      que: "quh",
      mlg: "tdx",
      ful: "fuf",
    }
    for (const [code, language] of Object.entries(expected)) {
      expect([code, catalogLanguageCode(code)]).toEqual([code, language])
    }
  })

  it("reads a three-letter locale code, old Android codes, and any case", () => {
    expect(catalogLanguageCode("fil")).toBe("tgl")
    expect(catalogLanguageCode("ckb")).toBe("ckb")
    expect(catalogLanguageCode("iw")).toBe("heb")
    expect(catalogLanguageCode("in")).toBe("ind")
    expect(catalogLanguageCode("ji")).toBe("ydd")
    expect(catalogLanguageCode("ZH")).toBe("cmn")
    for (const bad of ["", "e", "english", "12", "zh-TW"]) {
      expect(catalogLanguageCode(bad)).toBeNull()
    }
  })

  it("reaches a language-table code from each entry whose language has a Bible", () => {
    for (const [two, three] of Object.entries(ISO_639_1_TO_639_3)) {
      const reached = catalogLanguageCode(two)
      if (reached != null) {
        const id = LANGUAGE_DEFAULT_TRANSLATIONS[reached]
        expect([two, id !== undefined && CATALOG.byId.has(id)]).toEqual([
          two,
          true,
        ])
      }
      // A direct match always wins over any member of a macrolanguage.
      if (LANGUAGE_DEFAULT_TRANSLATIONS[three] !== undefined) {
        expect([two, reached]).toEqual([two, three])
      }
    }
  })

  it("names exactly the codes that reach no catalog Bible", () => {
    const unreachable = Object.keys(ISO_639_1_TO_639_3).filter(
      (code) => catalogLanguageCode(code) === null,
    )
    expect(unreachable).toEqual(UNREACHABLE)
  })

  it("reads the phone's language subtag from Intl", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat")
    spy.mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ locale: "zh-Hant-TW" }),
        }) as unknown as Intl.DateTimeFormat,
    )
    expect(readPhoneLanguageCode()).toBe("zh")
    spy.mockImplementation(() => {
      throw new Error("no Intl")
    })
    expect(readPhoneLanguageCode()).toBeNull()
    spy.mockRestore()
  })
})
