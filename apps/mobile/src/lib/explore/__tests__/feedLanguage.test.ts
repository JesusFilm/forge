/**
 * The feed language (R19, KTD7): the saved dub preference, else the reviewed
 * device-language map, else English. One slug serves eligibility, the pool,
 * and the recommendations request.
 */

import { AUDIO_LANGUAGE_SLUG_PATTERN } from "../../recommendations/context"
import {
  DEVICE_LANGUAGE_SLUGS,
  DEVICE_REGION_LANGUAGE_SLUGS,
  languageSlugForLocale,
} from "../deviceLanguageMap"
import {
  FEED_FALLBACK_LANGUAGE_SLUG,
  readDeviceLocale,
  resolveFeedLanguage,
} from "../feedLanguage"

describe("resolveFeedLanguage", () => {
  it("uses the saved dub preference first", () => {
    expect(
      resolveFeedLanguage({
        preferredAudioSlug: "swahili",
        deviceLocale: "es-MX",
      }),
    ).toBe("swahili")
  })

  it("maps the device language when there is no preference", () => {
    expect(
      resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: "es" }),
    ).toBe("spanish-latin-american")
  })

  it("gives english for an unmapped device language", () => {
    expect(
      resolveFeedLanguage({ preferredAudioSlug: null, deviceLocale: "xx-YY" }),
    ).toBe("english")
    expect(FEED_FALLBACK_LANGUAGE_SLUG).toBe("english")
  })

  it("gives english when the device language cannot be read", () => {
    expect(
      resolveFeedLanguage({
        preferredAudioSlug: undefined,
        deviceLocale: null,
      }),
    ).toBe("english")
  })

  // A value admin's audioLanguageSlug check would refuse must never reach the
  // recommendations request, so it falls through to the device language.
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

describe("languageSlugForLocale", () => {
  it("keys on the language subtag, whatever the region or script", () => {
    expect(languageSlugForLocale("fr-CA")).toBe("french")
    expect(languageSlugForLocale("zh-Hans-CN")).toBe("mandarin-china")
    expect(languageSlugForLocale("es-419")).toBe("spanish-latin-american")
    expect(languageSlugForLocale("EN_us")).toBe("english")
  })

  it("uses a region refinement where one exists", () => {
    expect(languageSlugForLocale("es-ES")).toBe("spanish-castilian")
    expect(languageSlugForLocale("pt-PT")).toBe("portuguese-portugal")
    expect(languageSlugForLocale("pt-BR")).toBe("portuguese-brazil")
  })

  it("maps both OS codes for Filipino", () => {
    expect(languageSlugForLocale("fil-PH")).toBe("tagalog")
    expect(languageSlugForLocale("tl")).toBe("tagalog")
  })

  it("gives null for an unmapped or empty tag", () => {
    expect(languageSlugForLocale("xx")).toBeNull()
    expect(languageSlugForLocale("")).toBeNull()
    expect(languageSlugForLocale(null)).toBeNull()
    // An inherited key is not a mapping.
    expect(languageSlugForLocale("constructor")).toBeNull()
  })

  it("holds only well-formed slugs and lowercase keys", () => {
    const entries = [
      ...Object.entries(DEVICE_LANGUAGE_SLUGS),
      ...Object.entries(DEVICE_REGION_LANGUAGE_SLUGS),
    ]
    expect(entries.length).toBeGreaterThan(0)
    for (const [key, slug] of entries) {
      expect(key).toBe(key.toLowerCase())
      expect(slug).toMatch(AUDIO_LANGUAGE_SLUG_PATTERN)
    }
  })
})

describe("readDeviceLocale", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function stubLocale(locale: string | (() => never)): void {
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({
            locale: typeof locale === "string" ? locale : locale(),
          }),
        }) as unknown as Intl.DateTimeFormat,
    )
  }

  it("reads the full locale tag from Intl", () => {
    stubLocale("pt-PT")
    expect(readDeviceLocale()).toBe("pt-PT")
  })

  it("gives null when Intl throws", () => {
    stubLocale(() => {
      throw new Error("no Intl")
    })
    expect(readDeviceLocale()).toBeNull()
  })
})
