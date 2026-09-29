/**
 * The feed language (R19, KTD7, KTD12): the saved dub preference, else the
 * phone's first language through the default-audio table, else English. One
 * slug serves eligibility, the pool, and the recommendations request.
 */

// The phone's languages reach Explore through the real locale store.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))

import {
  defaultAudioLanguage,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { phoneLocales } from "../../../test-utils/uiLocaleFixture"
import { AUDIO_LANGUAGE_SLUG_PATTERN } from "../../recommendations/context"
import { resolveDefaultSlug } from "../../resolveDefaultLanguage"
import {
  FEED_FALLBACK_LANGUAGE_SLUG,
  readDeviceLocale,
  resolveFeedLanguage,
} from "../feedLanguage"

function setPhone(...tags: string[]) {
  resetLocaleStoreForTests()
  mockGetLocales.mockReturnValue(tags.flatMap((tag) => phoneLocales(tag)))
  startLocaleSync()
}

afterEach(() => {
  jest.restoreAllMocks()
  resetLocaleStoreForTests()
})

/** The feed language for a viewer with no saved pick, as the hook reads it. */
function noPickFeedLanguage(): string {
  return resolveFeedLanguage({
    preferredAudioSlug: null,
    deviceLocale: readDeviceLocale(),
  })
}

describe("resolveFeedLanguage", () => {
  it("uses the saved dub preference first", () => {
    expect(
      resolveFeedLanguage({
        preferredAudioSlug: "swahili",
        deviceLocale: "es-MX",
      }),
    ).toBe("swahili")
  })

  it("maps the phone language when there is no preference", () => {
    expect(
      resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: "es" }),
    ).toBe("spanish-latin-american")
  })

  it("maps a language that the old reviewed map lacked through Admin's tags", () => {
    expect(
      resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: "ha-NG" }),
    ).toBe("hausa")
  })

  it("gives english for an unmapped phone language", () => {
    expect(
      resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: "xx-YY" }),
    ).toBe("english")
    expect(FEED_FALLBACK_LANGUAGE_SLUG).toBe("english")
  })

  it("gives english when the phone language cannot be read", () => {
    expect(
      resolveFeedLanguage({
        preferredAudioSlug: undefined,
        deviceLocale: null,
      }),
    ).toBe("english")
  })

  // A value admin's audioLanguageSlug check would refuse must never reach the
  // recommendations request, so it falls through to the phone language.
  it.each(["", "   ", "Swahili", "swa hili", "a".repeat(65)])(
    "ignores a malformed preference (%j)",
    (preferredAudioSlug) => {
      expect(
        resolveFeedLanguage({ preferredAudioSlug, deviceLocale: "fr-FR" }),
      ).toBe("french")
    },
  )

  it("trims a preference with outer whitespace", () => {
    expect(
      resolveFeedLanguage({
        preferredAudioSlug: " korean ",
        deviceLocale: null,
      }),
    ).toBe("korean")
  })
})

describe("readDeviceLocale", () => {
  it("reads the phone's first language tag, before any catalog fallback", () => {
    setPhone("pt-PT", "en-US")
    expect(readDeviceLocale()).toBe("pt-PT")
  })

  it("gives null for an empty phone list or a failed read", () => {
    setPhone()
    expect(readDeviceLocale()).toBeNull()
    resetLocaleStoreForTests()
    mockGetLocales.mockImplementation(() => {
      throw new Error("Cannot find native module 'ExpoLocalization'")
    })
    startLocaleSync()
    expect(readDeviceLocale()).toBeNull()
    expect(noPickFeedLanguage()).toBe("english")
  })

  it("never reads the Intl default locale", () => {
    setPhone()
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ locale: "pt-PT" }),
        }) as unknown as Intl.DateTimeFormat,
    )
    expect(readDeviceLocale()).toBeNull()
  })
})

// KTD12: Explore and the player read one default, so they never disagree.
describe("the feed language and the player's default", () => {
  function playerPick(options: { slug: string; languageSlug: string }[]) {
    const withTags = options.map((o) => ({ ...o, bcp47: null }))
    const slug = resolveDefaultSlug(withTags, "en")
    return withTags.find((o) => o.slug === slug)?.languageSlug
  }

  const DUBS = [
    { slug: "v-en", languageSlug: "english" },
    { slug: "v-ru", languageSlug: "russian" },
    { slug: "v-latam", languageSlug: "spanish-latin-american" },
    { slug: "v-castilian", languageSlug: "spanish-castilian" },
  ]

  it("gives a no-pick Russian phone russian, the slug the player picks", () => {
    setPhone("ru-RU")
    expect(noPickFeedLanguage()).toBe("russian")
    expect(defaultAudioLanguage()?.slug).toBe("russian")
    expect(playerPick(DUBS)).toBe("russian")
  })

  it.each([
    ["es-MX", "spanish-latin-american"],
    ["es-ES", "spanish-castilian"],
  ])("agrees with the player for a %s phone", (tag, slug) => {
    setPhone(tag)
    expect(noPickFeedLanguage()).toBe(slug)
    expect(playerPick(DUBS)).toBe(slug)
  })
})

// A frozen copy of the retired src/lib/explore/deviceLanguageMap.ts (checked on
// production 2026-09-25). Its entries now live in the `audio` section of
// i18n/admin-language-overrides.json; the new table must answer the same.
const RETIRED_LANGUAGE_SLUGS: Readonly<Record<string, string>> = {
  am: "amharic",
  ar: "arabic-modern-standard",
  bn: "bangla-2",
  de: "german-standard",
  en: "english",
  es: "spanish-latin-american",
  fa: "farsi-western",
  fil: "tagalog",
  fr: "french",
  hi: "hindi",
  id: "indonesian-yesus",
  it: "italian",
  ja: "japanese",
  ko: "korean",
  ms: "malay",
  ne: "nepali",
  nl: "dutch",
  pl: "polish",
  pt: "portuguese-brazil",
  ru: "russian",
  sw: "swahili-tanzania",
  th: "thai",
  tl: "tagalog",
  tr: "turkish",
  uk: "ukrainian",
  ur: "urdu",
  vi: "vietnamese",
  zh: "mandarin-china",
}
const RETIRED_REGION_SLUGS: Readonly<Record<string, string>> = {
  "es-es": "spanish-castilian",
  "pt-pt": "portuguese-portugal",
}

/** The retired `languageSlugForLocale`, kept as the oracle. */
function retiredSlugForLocale(locale: string): string | null {
  const own = (map: Readonly<Record<string, string>>, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
  const parts = locale.trim().toLowerCase().split(/[-_]/)
  const language = parts[0]
  if (!language) return null
  const region = parts
    .slice(1)
    .find((part) => /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part))
  if (region != null) {
    const refined = own(RETIRED_REGION_SLUGS, `${language}-${region}`)
    if (refined != null) return refined
  }
  return own(RETIRED_LANGUAGE_SLUGS, language)
}

describe("the retired reviewed map", () => {
  it("resolves every old entry to the same slug", () => {
    const entries = [
      ...Object.entries(RETIRED_LANGUAGE_SLUGS),
      ...Object.entries(RETIRED_REGION_SLUGS),
    ]
    expect(entries).toHaveLength(30)
    for (const [tag, slug] of entries) {
      expect(slug).toMatch(AUDIO_LANGUAGE_SLUG_PATTERN)
      expect([
        tag,
        resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: tag }),
      ]).toEqual([tag, slug])
    }
  })

  // Admin's own region tags (bn-BD, zh-Hant-TW, pt-MZ, and others) must not
  // move a language that the old map named.
  it("gives the same slug for each old language under any region or script", () => {
    const suffixes = ["", "-US", "-GB", "-BD", "-IN", "-MZ", "-CN", "-TW"]
    const tags = [
      ...Object.keys(RETIRED_LANGUAGE_SLUGS).flatMap((language) =>
        suffixes.map((suffix) => `${language}${suffix}`),
      ),
      "zh-Hant-TW",
      "zh-Hans-CN",
      "es-419",
      "es-Latn-ES",
      "pt-Latn-PT",
      "EN_us",
      "ES-es",
      "sr-Latn-RS",
    ]
    let compared = 0
    for (const tag of tags) {
      const old = retiredSlugForLocale(tag)
      if (old == null) continue
      compared += 1
      expect([
        tag,
        resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: tag }),
      ]).toEqual([tag, old])
    }
    expect(compared).toBeGreaterThan(200)
  })
})
