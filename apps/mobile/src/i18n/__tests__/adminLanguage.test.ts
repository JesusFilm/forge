import {
  adminFormsFor,
  audioSlugForLocaleTag,
  currentAdminForms,
  ENGLISH_ADMIN_FORMS,
} from "../adminLanguage"
import {
  ADMIN_LANGUAGE_FORMS,
  REVIEWED_AUDIO_SLUG_BY_TAG,
} from "../adminLanguages.generated"
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

  it("resolves every reviewed entry to its own slug", () => {
    const reviewed = Object.entries(REVIEWED_AUDIO_SLUG_BY_TAG)
    expect(reviewed.length).toBeGreaterThan(30)
    for (const [tag, slug] of reviewed) {
      expect([tag, audioSlugForLocaleTag(tag)]).toEqual([tag, slug])
    }
  })
})

// U9 rule: a reviewed audio entry beats an Admin tag that nobody reviewed.
// Order: reviewed exact tag, reviewed language subtag, then Admin's exact tag,
// then Admin's language subtag.
describe("audioSlugForLocaleTag precedence", () => {
  it("lets a reviewed language entry beat Admin's own region tag", () => {
    // Admin tags bangla-muslim bn-BD, mandarin-taiwan zh-Hant-TW, and
    // portuguese-mozambique pt-MZ. Explore and the player give the others.
    expect(audioSlugForLocaleTag("bn-BD")).toBe("bangla-2")
    expect(audioSlugForLocaleTag("zh-Hant-TW")).toBe("mandarin-china")
    expect(audioSlugForLocaleTag("zh-Hans-CN")).toBe("mandarin-china")
    expect(audioSlugForLocaleTag("pt-MZ")).toBe("portuguese-brazil")
  })

  it("lets a reviewed region entry beat the reviewed language entry", () => {
    expect(audioSlugForLocaleTag("es-ES")).toBe("spanish-castilian")
    expect(audioSlugForLocaleTag("pt-PT")).toBe("portuguese-portugal")
  })

  it("uses the reviewed language entry for a region that has none", () => {
    expect(audioSlugForLocaleTag("es-MX")).toBe("spanish-latin-american")
    expect(audioSlugForLocaleTag("es-419")).toBe("spanish-latin-american")
    expect(audioSlugForLocaleTag("pt-BR")).toBe("portuguese-brazil")
  })

  it("keeps a reviewed region entry when a script comes before the region", () => {
    expect(audioSlugForLocaleTag("pt-Latn-PT")).toBe("portuguese-portugal")
    expect(audioSlugForLocaleTag("es-Latn-ES")).toBe("spanish-castilian")
  })

  it("maps ti-ER to Tigrinya, Eritrea, not to Admin's mis-tagged ti-ER", () => {
    // Admin tags "Tigrinya, Ethiopia" as ti-ER, but ER is Eritrea.
    expect(audioSlugForLocaleTag("ti-ER")).toBe("tigrinya-eritrea")
    expect(audioSlugForLocaleTag("ti")).toBe("tigrinya-eritrea")
  })

  it("uses Admin's exact tag before its language subtag for an unreviewed language", () => {
    expect(audioSlugForLocaleTag("fan-GA")).toBe("fang-gabon")
    expect(audioSlugForLocaleTag("fan-GQ")).toBe("fang-equatorial-guinea")
  })
})
