import {
  adminFormsFor,
  audioSlugForLocaleTag,
  ENGLISH_ADMIN_FORMS,
} from "../adminLanguage"
import {
  ADMIN_LANGUAGE_FORMS,
  REVIEWED_AUDIO_SLUG_BY_TAG,
} from "../adminLanguages.generated"

jest.mock("../localeStore", () => ({
  getCatalogTag: jest.fn(() => "en"),
}))

type StoreMock = { getCatalogTag: jest.Mock<string, []> }

describe("adminFormsFor", () => {
  it("maps zh-Hans to its catalog tag, slug, and Admin's raw tag", () => {
    expect(adminFormsFor("zh-Hans")).toEqual({
      catalogTag: "zh-Hans",
      forYouLocale: "zh-Hans",
      textSlug: "chinese-simplified",
      rawTag: "zh-hans",
    })
  })

  it.each([
    ["ne", "nepali", "npi"],
    ["nb", "norwegian-bokmal", "no"],
    // Not csango, which shares the tag hu.
    ["hu", "hungarian", "hu"],
    // The slugs that hold Admin's text rows, not web's audio table.
    ["es", "spanish-latin-american", "es"],
    ["id", "indonesian-yesus", "id"],
    // Simplified Chinese text; zh audio stays Mandarin (see below).
    ["zh", "chinese-simplified", "zh-hans"],
  ])("maps %s text to %s under Admin's tag %s", (tag, textSlug, rawTag) => {
    expect(adminFormsFor(tag)).toMatchObject({
      catalogTag: tag,
      textSlug,
      rawTag,
    })
  })

  it("gives tl the For You locale fil", () => {
    expect(adminFormsFor("tl")).toEqual({
      catalogTag: "tl",
      forYouLocale: "fil",
      textSlug: "tagalog",
      rawTag: "fil",
    })
  })

  it("gives an unmapped catalog English content with a slug, never null", () => {
    expect(adminFormsFor("ab")).toEqual({
      catalogTag: "ab",
      forYouLocale: "ab",
      textSlug: "english",
      rawTag: "en",
    })
  })

  it("gives English forms to a tag with no catalog", () => {
    expect(adminFormsFor("xx")).toBe(ENGLISH_ADMIN_FORMS)
    expect(adminFormsFor("constructor")).toBe(ENGLISH_ADMIN_FORMS)
    expect(ENGLISH_ADMIN_FORMS).toEqual({
      catalogTag: "en",
      forYouLocale: "en",
      textSlug: "english",
      rawTag: "en",
    })
  })

  it("gives every catalog a non-empty value for each form", () => {
    const rows = Object.entries(ADMIN_LANGUAGE_FORMS)
    expect(rows.length).toBeGreaterThan(200)
    for (const [tag, forms] of rows) {
      expect(forms.catalogTag).toBe(tag)
      expect(forms.forYouLocale).toMatch(/\S/)
      expect(forms.textSlug).toMatch(/^[a-z0-9-]+$/)
      expect(forms.rawTag).toMatch(/\S/)
    }
  })
})

describe("currentAdminForms", () => {
  it("reads the catalog tag at call time, not at import", () => {
    jest.isolateModules(() => {
      const fresh =
        jest.requireActual<typeof import("../adminLanguage")>(
          "../adminLanguage",
        )
      const store = jest.requireMock<StoreMock>("../localeStore")
      expect(store.getCatalogTag).not.toHaveBeenCalled()

      store.getCatalogTag.mockReturnValue("en")
      expect(fresh.currentAdminForms().textSlug).toBe("english")
      store.getCatalogTag.mockReturnValue("zh-Hans")
      expect(fresh.currentAdminForms().textSlug).toBe("chinese-simplified")
      expect(fresh.currentAdminForms()).toBe(fresh.adminFormsFor("zh-Hans"))
    })
  })
})

describe("audioSlugForLocaleTag", () => {
  // U9 precedence: the reviewed exact tag, the reviewed language subtag, then
  // Admin's exact tag, then Admin's language subtag.
  it.each([
    ["ha", "hausa"],
    ["ha-NG", "hausa"],
    ["zh", "mandarin-china"],
    // Any case, an underscore, and outer spaces.
    ["PT_pt", "portuguese-portugal"],
    [" ES-es ", "spanish-castilian"],
    // Phone codes that Admin holds under another name.
    ["nb-NO", "norwegian-bokmal"],
    ["ne-NP", "nepali"],
    ["hu-HU", "hungarian"],
    ["es", "spanish-latin-american"],
    ["id", "indonesian-yesus"],
    // A reviewed language entry beats Admin's own region tag: Admin tags
    // bangla-muslim bn-BD, mandarin-taiwan zh-Hant-TW, and
    // portuguese-mozambique pt-MZ. Explore and the player give the others.
    ["bn-BD", "bangla-2"],
    ["zh-Hant-TW", "mandarin-china"],
    ["zh-Hans-CN", "mandarin-china"],
    ["pt-MZ", "portuguese-brazil"],
    // A reviewed region entry beats the reviewed language entry.
    ["es-ES", "spanish-castilian"],
    ["pt-PT", "portuguese-portugal"],
    // The reviewed language entry serves a region that has none.
    ["es-MX", "spanish-latin-american"],
    ["es-419", "spanish-latin-american"],
    ["pt-BR", "portuguese-brazil"],
    // A script before the region keeps the reviewed region entry.
    ["pt-Latn-PT", "portuguese-portugal"],
    ["es-Latn-ES", "spanish-castilian"],
    // Admin tags "Tigrinya, Ethiopia" as ti-ER, but ER is Eritrea.
    ["ti-ER", "tigrinya-eritrea"],
    ["ti", "tigrinya-eritrea"],
    // An unreviewed language: Admin's exact tag before its language subtag.
    ["fan-GA", "fang-gabon"],
    ["fan-GQ", "fang-equatorial-guinea"],
  ])("maps %j to %s", (tag, slug) => {
    expect(audioSlugForLocaleTag(tag)).toBe(slug)
  })

  it("returns null for an unknown, empty, or missing tag", () => {
    expect(audioSlugForLocaleTag("xx-YY")).toBeNull()
    expect(audioSlugForLocaleTag("constructor")).toBeNull()
    expect(audioSlugForLocaleTag("")).toBeNull()
    expect(audioSlugForLocaleTag(null)).toBeNull()
    expect(audioSlugForLocaleTag(undefined)).toBeNull()
  })

  it("resolves every reviewed entry to its own slug", () => {
    const reviewed = Object.entries(REVIEWED_AUDIO_SLUG_BY_TAG)
    expect(reviewed.length).toBeGreaterThan(30)
    for (const [tag, slug] of reviewed) {
      expect([tag, audioSlugForLocaleTag(tag)]).toEqual([tag, slug])
    }
  })
})
