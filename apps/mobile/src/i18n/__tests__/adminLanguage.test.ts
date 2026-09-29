import {
  DEVICE_LANGUAGE_SLUGS,
  DEVICE_REGION_LANGUAGE_SLUGS,
  languageSlugForLocale,
} from "../../lib/explore/deviceLanguageMap"
import {
  adminFormsFor,
  audioSlugForLocaleTag,
  currentAdminForms,
  ENGLISH_ADMIN_FORMS,
} from "../adminLanguage"
import { ADMIN_LANGUAGE_FORMS } from "../adminLanguages.generated"
import { getCatalogTag } from "../localeStore"

jest.mock("../localeStore", () => ({
  getCatalogTag: jest.fn(() => "en"),
}))

type StoreMock = { getCatalogTag: jest.Mock<string, []> }

const mockGetCatalogTag = getCatalogTag as unknown as jest.Mock<string, []>

beforeEach(() => {
  mockGetCatalogTag.mockReset()
  mockGetCatalogTag.mockReturnValue("en")
})

describe("adminFormsFor", () => {
  it("maps zh-Hans to its catalog tag, slug, and Admin's raw tag", () => {
    expect(adminFormsFor("zh-Hans")).toEqual({
      catalogTag: "zh-Hans",
      forYouLocale: "zh-Hans",
      textSlug: "chinese-simplified",
      rawTag: "zh-hans",
    })
  })

  it("maps ne to nepali under Admin's tag npi", () => {
    expect(adminFormsFor("ne")).toMatchObject({
      textSlug: "nepali",
      rawTag: "npi",
    })
  })

  it("maps hu to hungarian, not csango, which shares the tag", () => {
    expect(adminFormsFor("hu")).toMatchObject({
      textSlug: "hungarian",
      rawTag: "hu",
    })
  })

  it("maps nb to norwegian-bokmal, which Admin tags as no", () => {
    expect(adminFormsFor("nb")).toMatchObject({
      textSlug: "norwegian-bokmal",
      rawTag: "no",
    })
  })

  it("reads es and id text from the slugs that hold Admin's text rows", () => {
    expect(adminFormsFor("es")).toMatchObject({
      textSlug: "spanish-latin-american",
      rawTag: "es",
    })
    expect(adminFormsFor("id")).toMatchObject({
      textSlug: "indonesian-yesus",
      rawTag: "id",
    })
  })

  it("reads zh text as Simplified Chinese while zh audio stays Mandarin", () => {
    expect(adminFormsFor("zh")).toMatchObject({
      catalogTag: "zh",
      textSlug: "chinese-simplified",
      rawTag: "zh-hans",
    })
    expect(audioSlugForLocaleTag("zh")).toBe("mandarin-china")
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
    })
  })

  it("returns the forms of the catalog in use", () => {
    mockGetCatalogTag.mockReturnValue("ne")
    expect(currentAdminForms()).toBe(adminFormsFor("ne"))
  })
})

describe("audioSlugForLocaleTag", () => {
  it("maps ha to the Hausa slug", () => {
    expect(audioSlugForLocaleTag("ha")).toBe("hausa")
    expect(audioSlugForLocaleTag("ha-NG")).toBe("hausa")
  })

  it("matches the exact tag before the language subtag", () => {
    expect(audioSlugForLocaleTag("es-ES")).toBe("spanish-castilian")
    expect(audioSlugForLocaleTag("es-MX")).toBe("spanish-latin-american")
    expect(audioSlugForLocaleTag("es")).toBe("spanish-latin-american")
    // Admin's own region tag names another Language.
    expect(audioSlugForLocaleTag("zh-Hant-TW")).toBe("mandarin-taiwan")
    expect(audioSlugForLocaleTag("zh-Hans-CN")).toBe("mandarin-china")
  })

  it("ignores case and accepts an underscore separator", () => {
    expect(audioSlugForLocaleTag("PT_pt")).toBe("portuguese-portugal")
    expect(audioSlugForLocaleTag(" ES-es ")).toBe("spanish-castilian")
  })

  it("maps a phone code that Admin holds under another name", () => {
    expect(audioSlugForLocaleTag("nb-NO")).toBe("norwegian-bokmal")
    expect(audioSlugForLocaleTag("ne-NP")).toBe("nepali")
    expect(audioSlugForLocaleTag("hu-HU")).toBe("hungarian")
  })

  it("keeps es audio and es text apart", () => {
    expect(audioSlugForLocaleTag("es")).toBe("spanish-latin-american")
    expect(audioSlugForLocaleTag("id")).toBe("indonesian-yesus")
    expect(adminFormsFor("es").textSlug).toBe("spanish-latin-american")
  })

  it("returns null for an unknown, empty, or missing tag", () => {
    expect(audioSlugForLocaleTag("xx-YY")).toBeNull()
    expect(audioSlugForLocaleTag("constructor")).toBeNull()
    expect(audioSlugForLocaleTag("")).toBeNull()
    expect(audioSlugForLocaleTag(null)).toBeNull()
    expect(audioSlugForLocaleTag(undefined)).toBeNull()
  })

  it("resolves every reviewed Explore entry to the same slug", () => {
    const reviewed = {
      ...DEVICE_LANGUAGE_SLUGS,
      ...DEVICE_REGION_LANGUAGE_SLUGS,
    }
    expect(Object.keys(reviewed).length).toBeGreaterThan(25)
    for (const [tag, slug] of Object.entries(reviewed)) {
      expect([tag, audioSlugForLocaleTag(tag)]).toEqual([tag, slug])
    }
  })

  it("agrees with Explore on common phone tags", () => {
    const phoneTags = [
      "en-US",
      "es-MX",
      "es-ES",
      "pt-BR",
      "pt-PT",
      "zh-Hans-CN",
      "fr-CA",
      "ar-EG",
      "ko-KR",
      "ja-JP",
      "ru-RU",
      "hi-IN",
      "id-ID",
      "fil-PH",
      "sw-KE",
      "de-DE",
      "vi-VN",
      "th-TH",
      "tr-TR",
      "uk-UA",
      "ur-PK",
      "fa-IR",
      "am-ET",
      "ne-NP",
      "nl-NL",
      "pl-PL",
      "it-IT",
      "ms-MY",
    ]
    for (const tag of phoneTags) {
      expect([tag, audioSlugForLocaleTag(tag)]).toEqual([
        tag,
        languageSlugForLocale(tag),
      ])
    }
  })
})
