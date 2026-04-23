// Contract tests for the in-memory cms-experience-source fake.
//
// The fake is the test surface for service-level tests in Unit 6
// (experience-content-dump.service). Pinning its contract here so
// service tests can rely on stable seeded behaviour.

import { describe, expect, it } from "vitest"
import { createFakeCmsExperienceSourceRepository } from "./cms-experience-source.fake"
import type {
  CmsDocumentLocaleSummary,
  CmsExperienceRow,
  CmsCta,
} from "./cms-experience-source.types"

const docLocaleEn: CmsDocumentLocaleSummary = {
  document_id: "doc-1",
  locale: "en",
  has_published: true,
  has_draft: true,
  published_at: new Date("2026-04-20T10:00:00Z"),
  draft_updated_at: new Date("2026-04-22T15:00:00Z"),
}
const docLocaleEs: CmsDocumentLocaleSummary = {
  document_id: "doc-1",
  locale: "es",
  has_published: false,
  has_draft: true,
  published_at: null,
  draft_updated_at: new Date("2026-04-21T11:00:00Z"),
}
const publishedRow: CmsExperienceRow = {
  entity_id: 100,
  document_id: "doc-1",
  locale: "en",
  slug: "easter",
  is_homepage: false,
  is_template: false,
  title: "Easter",
  meta_description: null,
  og_title: null,
  og_description: null,
  path_segment: null,
  published_at: new Date("2026-04-20T10:00:00Z"),
  created_at: new Date("2026-04-01T00:00:00Z"),
  updated_at: new Date("2026-04-20T10:00:00Z"),
}
const ctaComponent: CmsCta = {
  componentType: "sections.cta",
  cmp_id: 50,
  section_key: null,
  heading: "Hello",
  body: null,
  button_label: "Go",
  button_link: "/go",
  variant: "primary",
}

describe("createFakeCmsExperienceSourceRepository", () => {
  it("returns the seeded document locales when no filter is supplied", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      documentLocales: [docLocaleEn, docLocaleEs],
    })
    const rows = await repo.enumerateDocumentLocales()
    expect(rows).toEqual([docLocaleEn, docLocaleEs])
  })

  it("filters by documentIds", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      documentLocales: [docLocaleEn, docLocaleEs],
    })
    const rows = await repo.enumerateDocumentLocales({
      documentIds: ["doc-other"],
    })
    expect(rows).toEqual([])
  })

  it("filters by locales", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      documentLocales: [docLocaleEn, docLocaleEs],
    })
    const rows = await repo.enumerateDocumentLocales({ locales: ["es"] })
    expect(rows).toEqual([docLocaleEs])
  })

  it("treats length-0 filter arrays as omitted (parity with R1/R2)", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      documentLocales: [docLocaleEn, docLocaleEs],
    })
    const rows = await repo.enumerateDocumentLocales({
      documentIds: [],
      locales: [],
    })
    expect(rows).toEqual([docLocaleEn, docLocaleEs])
  })

  it("loads experience rows by exact (documentId, locale, prefer) key", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      experienceRows: {
        "doc-1::en::published": publishedRow,
      },
    })
    const got = await repo.loadExperienceRow("doc-1", "en", "published")
    expect(got).toEqual(publishedRow)
  })

  it("returns null for an unseeded experience row lookup", async () => {
    const repo = createFakeCmsExperienceSourceRepository({})
    const got = await repo.loadExperienceRow("doc-missing", "en", "published")
    expect(got).toBeNull()
  })

  it("loads components by (ownerTable, entityId, field) key", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      components: {
        "experiences::100::blocks": [ctaComponent],
      },
    })
    const got = await repo.loadComponents("experiences", 100, "blocks")
    expect(got).toEqual([ctaComponent])
  })

  it("returns empty array for unseeded component lookups", async () => {
    const repo = createFakeCmsExperienceSourceRepository({})
    const got = await repo.loadComponents("experiences", 999, "blocks")
    expect(got).toEqual([])
  })

  it("returns seeded media URLs and null for misses", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      mediaUrls: {
        "api::experience.experience::100::ogImage": "https://cdn/og.jpg",
      },
    })
    expect(
      await repo.loadMediaUrl("api::experience.experience", 100, "ogImage"),
    ).toBe("https://cdn/og.jpg")
    expect(
      await repo.loadMediaUrl("api::experience.experience", 999, "ogImage"),
    ).toBeNull()
  })

  it("supports re-seeding via the seed() mutator", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      documentLocales: [docLocaleEn],
    })
    expect(await repo.enumerateDocumentLocales()).toEqual([docLocaleEn])

    repo.seed({ documentLocales: [docLocaleEs] })
    expect(await repo.enumerateDocumentLocales()).toEqual([docLocaleEs])
  })

  it("re-seeding components merges rather than replaces wholesale", async () => {
    const repo = createFakeCmsExperienceSourceRepository({
      components: { "experiences::1::blocks": [ctaComponent] },
    })
    repo.seed({
      components: { "experiences::2::blocks": [ctaComponent] },
    })
    expect(await repo.loadComponents("experiences", 1, "blocks")).toEqual([
      ctaComponent,
    ])
    expect(await repo.loadComponents("experiences", 2, "blocks")).toEqual([
      ctaComponent,
    ])
  })
})
