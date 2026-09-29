// The phone's languages reach the resolver through the real locale store and a
// mocked expo-localization (KTD12). `es` is a fixture catalog, so a case can
// change the UI language.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      es: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import {
  getCatalogTag,
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import { resolveDefaultSlug } from "../resolveDefaultLanguage"

/** Starts the store on a phone with these languages, in order. */
function setPhone(...tags: string[]) {
  resetLocaleStoreForTests()
  mockGetLocales.mockReturnValue(tags.flatMap((tag) => phoneLocales(tag)))
  startLocaleSync()
}

/** Changes the phone's languages on a running store (a live change). */
function changePhone(...tags: string[]) {
  mockGetLocales.mockReturnValue(tags.flatMap((tag) => phoneLocales(tag)))
  refreshLocale()
}

beforeEach(() => {
  mockGetLocales.mockReset()
  setPhone("en-US")
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => resetLocaleStoreForTests())

const opt = (slug: string, bcp47: string | null) => ({
  slug,
  bcp47,
  languageSlug: null,
})
// For preference tests: an option carrying its unique language-entity slug.
// `variantSlug` is what resolution returns; `languageSlug` is what a persisted
// preference is matched against.
const langOpt = (
  variantSlug: string,
  bcp47: string | null,
  languageSlug: string,
) => ({ slug: variantSlug, bcp47, languageSlug })

describe("resolveDefaultSlug", () => {
  it("returns null for an empty option list", () => {
    expect(resolveDefaultSlug([], "en")).toBeNull()
  })

  it("prefers the phone language match by bcp47 prefix", () => {
    setPhone("es-MX")
    const options = [opt("english", "en"), opt("spanish", "es-419")]
    expect(resolveDefaultSlug(options, "en")).toBe("spanish")
  })

  // REGRESSION GUARD: JESUS carries 2281 dubs, of which TWO have a bcp47
  // starting "en" — "english-north-american-indigenous" (en-nai) at index 266
  // and plain "english" (en) at index 614. First-match-by-prefix handed the
  // viewer "English, North American Indigenous". An exact tag must win.
  const enCollision = () => [
    opt("english-north-american-indigenous", "en-nai"),
    opt("english", "en"),
  ]

  it("prefers the exact tag over a longer one sharing its prefix (phone step)", () => {
    setPhone("en-US")
    expect(resolveDefaultSlug(enCollision(), null)).toBe("english")
  })

  it("prefers the exact tag at the video-primary step", () => {
    setPhone("fr-FR")
    expect(resolveDefaultSlug(enCollision(), "en")).toBe("english")
  })

  it("prefers the exact tag at the English fallback step", () => {
    setPhone("fr-FR")
    expect(resolveDefaultSlug(enCollision(), "de")).toBe("english")
  })

  it("still falls back to a prefix match when no exact tag exists", () => {
    setPhone("en-US")
    // Only the regional tag is offered — it must still be chosen.
    expect(resolveDefaultSlug([opt("en-nai", "en-nai")], null)).toBe("en-nai")
  })

  it("prefers the exact language over a prefix sibling for a phone tag (ko vs ko-kmr)", () => {
    setPhone("ko-KR")
    const options = [opt("kurmanji", "ko-kmr"), opt("korean", "ko")]
    expect(resolveDefaultSlug(options, null)).toBe("korean")
  })

  it("the phone language wins over the video primary language when both match", () => {
    setPhone("en-US")
    const options = [opt("french", "fr"), opt("english", "en")]
    // primary is French, but the phone language (English) takes priority
    expect(resolveDefaultSlug(options, "fr")).toBe("english")
  })

  it("matches the phone language on the language prefix, ignoring region", () => {
    setPhone("pt-BR")
    const options = [opt("english", "en"), opt("portuguese", "pt-PT")]
    expect(resolveDefaultSlug(options, "en")).toBe("portuguese")
  })

  it("falls back to the video primary language when the phone language is absent", () => {
    setPhone("de-DE")
    const options = [opt("english", "en"), opt("french", "fr")]
    expect(resolveDefaultSlug(options, "fr")).toBe("french")
  })

  it("falls back to English when neither the phone language nor the primary match", () => {
    setPhone("de-DE")
    const options = [opt("english", "en"), opt("french", "fr")]
    expect(resolveDefaultSlug(options, "ja")).toBe("english")
  })

  it("falls back to the first option when nothing matches", () => {
    setPhone("de-DE")
    const options = [opt("french", "fr"), opt("italian", "it")]
    expect(resolveDefaultSlug(options, "ja")).toBe("french")
  })

  it("ignores options with a null bcp47 when matching", () => {
    setPhone("en-US")
    const options = [opt("unknown", null), opt("english", "en")]
    expect(resolveDefaultSlug(options, null)).toBe("english")
  })

  describe("the phone language (KTD12)", () => {
    it("matches the phone language's slug before its bcp47 tag", () => {
      // Admin tags bangla-muslim bn-BD, so a tag match would pick it. The
      // reviewed bn entry, which Explore uses too, names bangla-2.
      setPhone("bn-BD")
      const options = [
        langOpt("v-muslim", "bn-BD", "bangla-muslim"),
        langOpt("v-bangla", "bn", "bangla-2"),
      ]
      expect(resolveDefaultSlug(options, null)).toBe("v-bangla")
    })

    it("gives a Russian phone with no pick the Russian dub", () => {
      setPhone("ru-RU")
      const options = [
        langOpt("v-en", "en", "english"),
        langOpt("v-ru", "ru", "russian"),
      ]
      expect(resolveDefaultSlug(options, "en")).toBe("v-ru")
    })

    // AE10: a Hausa phone has no UI catalog, so the UI falls back, but the
    // default audio follows the phone's first language.
    it("gives a Hausa phone the Hausa dub, then the primary language, then English", () => {
      setPhone("ha-NG", "es-MX")
      expect(getCatalogTag()).toBe("es")
      const hausa = langOpt("v-ha", "ha", "hausa")
      const english = langOpt("v-en", "en", "english")
      const french = langOpt("v-fr", "fr", "french")
      const spanish = langOpt("v-es", "es", "spanish-latin-american")
      expect(resolveDefaultSlug([english, spanish, french, hausa], "fr")).toBe(
        "v-ha",
      )
      expect(resolveDefaultSlug([english, spanish, french], "fr")).toBe("v-fr")
      expect(resolveDefaultSlug([spanish, english], "fr")).toBe("v-en")
    })

    it("falls to the primary language, then English, when the phone list is empty", () => {
      setPhone()
      const options = [opt("french", "fr"), opt("english", "en")]
      expect(resolveDefaultSlug(options, "fr")).toBe("french")
      expect(resolveDefaultSlug(options, "ja")).toBe("english")
    })

    it("falls to the primary language when expo-localization cannot be read", () => {
      resetLocaleStoreForTests()
      mockGetLocales.mockImplementation(() => {
        throw new Error("Cannot find native module 'ExpoLocalization'")
      })
      startLocaleSync()
      const options = [opt("french", "fr"), opt("english", "en")]
      expect(resolveDefaultSlug(options, "fr")).toBe("french")
    })

    it("never takes the Intl default locale as the phone language", () => {
      // On iOS, Intl follows the app's resolved language once the app declares
      // localizations, so it is not the phone language (KTD12).
      setPhone()
      jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
        () =>
          ({
            resolvedOptions: () => ({ locale: "ko-KR" }),
          }) as unknown as Intl.DateTimeFormat,
      )
      const options = [opt("english", "en"), opt("korean", "ko")]
      expect(resolveDefaultSlug(options, null)).toBe("english")
    })

    it("follows a live phone change for the next resolution", () => {
      setPhone("ha-NG")
      const options = [
        langOpt("v-ha", "ha", "hausa"),
        langOpt("v-yo", "yo", "yoruba"),
      ]
      expect(resolveDefaultSlug(options, null)).toBe("v-ha")
      changePhone("yo-NG")
      expect(resolveDefaultSlug(options, null)).toBe("v-yo")
    })
  })

  describe("preferred language (app-wide persisted choice, matched by slug)", () => {
    it("prefers the persisted language above the phone language", () => {
      setPhone("en-US")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-spanish", "es-419", "spanish"),
      ]
      // The phone is English, but the user's persisted choice is Spanish.
      expect(resolveDefaultSlug(options, "en", "spanish")).toBe("v-spanish")
    })

    // AE3: the UI language never moves a saved audio pick.
    it("keeps a saved Korean pick after the UI language changes from en to es", () => {
      setPhone("en-US")
      const options = [
        langOpt("v-en", "en", "english"),
        langOpt("v-es", "es", "spanish-latin-american"),
        langOpt("v-ko", "ko", "korean"),
      ]
      expect(resolveDefaultSlug(options, "en", "korean")).toBe("v-ko")
      changePhone("es-MX")
      expect(getCatalogTag()).toBe("es")
      expect(getLocaleEpoch()).toBe(1)
      expect(resolveDefaultSlug(options, "en", "korean")).toBe("v-ko")
      // The same video with no pick now takes the new phone language.
      expect(resolveDefaultSlug(options, "en", null)).toBe("v-es")
    })

    // The reported bug: bcp47 prefixes collide across distinct languages. An
    // exact languageSlug match must pick the right sibling, not the first by tag.
    it("picks the exact language, not a bcp47-prefix sibling (Korean vs Kurmanji)", () => {
      setPhone("en-US")
      // Kurmanji Standard's tag "ko-kmr" shares the "ko" prefix with Korean and
      // is listed FIRST — a prefix match would wrongly return it.
      const options = [
        langOpt("v-kurmanji", "ko-kmr", "kurmanji-standard"),
        langOpt("v-korean", "ko", "korean"),
      ]
      expect(resolveDefaultSlug(options, "en", "korean")).toBe("v-korean")
    })

    it("picks plain English, not English North American Indigenous (en vs en-nai)", () => {
      setPhone("de-DE")
      const options = [
        langOpt("v-en-nai", "en-nai", "english-north-american-indigenous"),
        langOpt("v-en", "en", "english"),
      ]
      expect(resolveDefaultSlug(options, "en", "english")).toBe("v-en")
    })

    it("falls through to the phone language when no option matches the preference", () => {
      setPhone("en-US")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-french", "fr", "french"),
      ]
      // Preferred Japanese isn't offered → the phone language (English) wins.
      expect(resolveDefaultSlug(options, "fr", "japanese")).toBe("v-english")
    })

    it("ignores a null/empty preference and uses the existing chain", () => {
      setPhone("es-MX")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-spanish", "es-419", "spanish"),
      ]
      expect(resolveDefaultSlug(options, "en", null)).toBe("v-spanish")
      expect(resolveDefaultSlug(options, "en", "")).toBe("v-spanish")
    })
  })
})
