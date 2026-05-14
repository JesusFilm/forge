import { resolve } from "node:path"
import { describe, expect, it, beforeEach } from "vitest"
import {
  assertNotProdUrl,
  loadFixtures,
  seedWebFixtures,
  type WebFixtures,
} from "./seed-web-fixtures"

// ---------------------------------------------------------------------------
// In-memory Prisma fake. Models the unique-key behavior the seed relies
// on (`coreId` UNIQUE on Language/Country/Keyword/Video;
// `(videoId, locale)` UNIQUE on VideoLocale; `(parentId, childId)`
// UNIQUE on VideoRelation; `(experienceId, locale)` UNIQUE on
// ExperienceLocale). Insufficient for full Prisma semantics but
// exercises the seed's idempotence + coverage contracts.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function makeKeyedTable<K extends string>(keyOf: (row: Row) => string) {
  const store = new Map<string, Row>()
  return {
    store,
    keyOf,
    async upsert(args: {
      where: Record<K, unknown>
      create: Row
      update: Row
    }): Promise<Row> {
      const k = JSON.stringify(args.where)
      const existing = store.get(k)
      if (existing) {
        const merged: Row = { ...existing, ...args.update }
        store.set(k, merged)
        return merged
      }
      // Create — synthesize an id if absent.
      const created: Row = {
        id: `gen-${store.size + 1}`,
        ...args.create,
      }
      store.set(k, created)
      return created
    },
    async findFirst(args: { where: Row; select?: Row }): Promise<Row | null> {
      for (const r of store.values()) {
        let match = true
        for (const [field, value] of Object.entries(args.where)) {
          if (r[field] !== value) {
            match = false
            break
          }
        }
        if (match) return r
      }
      return null
    },
    async update(args: { where: Record<K, unknown>; data: Row }): Promise<Row> {
      const k = JSON.stringify(args.where)
      const existing = store.get(k)
      if (!existing) throw new Error(`update miss: ${k}`)
      const merged: Row = { ...existing, ...args.data }
      store.set(k, merged)
      return merged
    },
    async create(args: { data: Row }): Promise<Row> {
      const created: Row = {
        id: `gen-${store.size + 1}`,
        ...args.data,
      }
      // Composite-key shaped storage: a parent create with nested locales
      // is exercised below in the experience flow with a stable key.
      store.set(`__create-${store.size + 1}`, created)
      return created
    },
  }
}

function makePrisma() {
  // Track relations that fold a nested create on Experience into the
  // top-level locales table.
  const language = makeKeyedTable<"coreId">((r) =>
    JSON.stringify({ coreId: r.coreId }),
  )
  const country = makeKeyedTable<"coreId">((r) =>
    JSON.stringify({ coreId: r.coreId }),
  )
  const keyword = makeKeyedTable<"coreId">((r) =>
    JSON.stringify({ coreId: r.coreId }),
  )
  const video = makeKeyedTable<"coreId">((r) =>
    JSON.stringify({ coreId: r.coreId }),
  )
  const videoLocale = makeKeyedTable<"videoId_locale">((r) =>
    JSON.stringify({
      videoId_locale: { videoId: r.videoId, locale: r.locale },
    }),
  )
  const videoRelation = makeKeyedTable<"parentId_childId">((r) =>
    JSON.stringify({
      parentId_childId: { parentId: r.parentId, childId: r.childId },
    }),
  )
  const experienceLocale = makeKeyedTable<"experienceId_locale">((r) =>
    JSON.stringify({
      experienceId_locale: {
        experienceId: r.experienceId,
        locale: r.locale,
      },
    }),
  )

  // experience.create handles nested locale creation by inserting into
  // the experienceLocale table directly.
  const experience = {
    store: new Map<string, Row>(),
    async create(args: { data: Row }): Promise<Row> {
      const id = `exp-${experience.store.size + 1}`
      experience.store.set(id, { id, ...args.data })
      const locales = args.data.locales as { create: Row | Row[] } | undefined
      if (locales?.create) {
        const list = Array.isArray(locales.create)
          ? locales.create
          : [locales.create]
        for (const loc of list) {
          await experienceLocale.upsert({
            where: {
              experienceId_locale: {
                experienceId: id,
                locale: loc.locale as string,
              },
            },
            create: { experienceId: id, ...loc },
            update: { ...loc },
          })
        }
      }
      return { id, ...args.data }
    },
    async update(args: { where: { id: string }; data: Row }): Promise<Row> {
      const row = experience.store.get(args.where.id)
      if (!row) throw new Error(`experience.update miss: ${args.where.id}`)
      const merged = { ...row, ...args.data }
      experience.store.set(args.where.id, merged)
      return merged
    },
  }

  return {
    language,
    country,
    keyword,
    video,
    videoLocale,
    videoRelation,
    experience,
    experienceLocale,
  }
}

// ---------------------------------------------------------------------------
// assertNotProdUrl — safety guard
// ---------------------------------------------------------------------------

describe("assertNotProdUrl", () => {
  it("refuses any Railway-app URL", () => {
    expect(() =>
      assertNotProdUrl("postgresql://user:pass@some-host.railway.app:5432/db"),
    ).toThrow(/railway\.app/)
  })

  it("refuses admin.jesusfilm.org explicitly", () => {
    expect(() =>
      assertNotProdUrl("postgresql://user:pass@admin.jesusfilm.org:5432/db"),
    ).toThrow(/jesusfilm\.org/)
  })

  it("refuses any *.jesusfilm.org suffix", () => {
    expect(() =>
      assertNotProdUrl("postgresql://user:pass@some-pg.jesusfilm.org:5432/db"),
    ).toThrow(/jesusfilm\.org/)
  })

  it("refuses a URL that fails to parse (fail-closed)", () => {
    expect(() => assertNotProdUrl("not a url at all")).toThrow(/parseable URL/i)
  })

  it("refuses an unset URL", () => {
    expect(() => assertNotProdUrl(undefined)).toThrow(/required/i)
  })

  it("allows localhost", () => {
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@localhost:5432/forge_admin"),
    ).not.toThrow()
  })

  it("allows 127.0.0.1", () => {
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@127.0.0.1:5432/forge_admin"),
    ).not.toThrow()
  })

  it("allows container hostnames (e.g. `db`)", () => {
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@db:5432/forge_admin"),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// seedWebFixtures — coverage + idempotence
// ---------------------------------------------------------------------------

const FIXTURES_PATH = resolve(__dirname, "web-fixtures.json")
let FIXTURES: WebFixtures

beforeEach(() => {
  FIXTURES = loadFixtures(FIXTURES_PATH)
})

describe("seedWebFixtures", () => {
  it("creates the expected counts on a clean DB (coverage)", async () => {
    const prisma = makePrisma()
    const summary = await seedWebFixtures(prisma, FIXTURES)

    expect(summary.languages).toBe(FIXTURES.languages.length)
    expect(summary.countries).toBe(FIXTURES.countries.length)
    expect(summary.keywords).toBe(FIXTURES.keywords.length)
    expect(summary.videos).toBe(FIXTURES.videos.length)
    expect(summary.experiences).toBe(FIXTURES.experiences.length)

    const totalVideoLocales = FIXTURES.videos.reduce(
      (acc, v) => acc + v.locales.length,
      0,
    )
    expect(summary.videoLocales).toBe(totalVideoLocales)

    const totalRelations = FIXTURES.videos.reduce(
      (acc, v) => acc + (v.parents?.length ?? 0),
      0,
    )
    expect(summary.videoRelations).toBe(totalRelations)
  })

  it("seeds a homepage Experience reachable as isHomepage=true", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    const homepageRows = [...prisma.experienceLocale.store.values()].filter(
      (r) => r.isHomepage === true,
    )
    expect(homepageRows.length).toBeGreaterThan(0)
  })

  it("seeds a default template Experience (isTemplate=true)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    const templates = [...prisma.experience.store.values()].filter(
      (r) => r.isTemplate === true,
    )
    expect(templates.length).toBeGreaterThan(0)
  })

  it("seeds Videos with at least one parent/child relation (SiblingCarousel coverage)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)
    expect(prisma.videoRelation.store.size).toBeGreaterThan(0)
  })

  it("is idempotent: running twice produces the same final state", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)
    const first = {
      languages: prisma.language.store.size,
      countries: prisma.country.store.size,
      keywords: prisma.keyword.store.size,
      videos: prisma.video.store.size,
      videoLocales: prisma.videoLocale.store.size,
      videoRelations: prisma.videoRelation.store.size,
      experiences: prisma.experience.store.size,
      experienceLocales: prisma.experienceLocale.store.size,
    }

    await seedWebFixtures(prisma, FIXTURES)
    const second = {
      languages: prisma.language.store.size,
      countries: prisma.country.store.size,
      keywords: prisma.keyword.store.size,
      videos: prisma.video.store.size,
      videoLocales: prisma.videoLocale.store.size,
      videoRelations: prisma.videoRelation.store.size,
      experiences: prisma.experience.store.size,
      experienceLocales: prisma.experienceLocale.store.size,
    }
    expect(second).toEqual(first)
  })

  it("seeds at least one Video reachable via slug (videoBySlug coverage)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)
    const rows = [...prisma.video.store.values()]
    expect(rows.some((r) => r.slug === "jesus-feature-film")).toBe(true)
  })

  it("seeds at least one Experience reachable via (slug, locale)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)
    const easterEn = [...prisma.experienceLocale.store.values()].find(
      (r) => r.slug === "easter" && r.locale === "en",
    )
    expect(easterEn).toBeDefined()
    expect(easterEn?.status).toBe("PUBLISHED")
  })
})

// ---------------------------------------------------------------------------
// loadFixtures — JSON-on-disk contract sanity
// ---------------------------------------------------------------------------

describe("loadFixtures (web-fixtures.json contract)", () => {
  it("has a homepage Experience", () => {
    const fixtures = loadFixtures(FIXTURES_PATH)
    expect(fixtures.experiences.some((e) => e.isHomepage === true)).toBe(true)
  })

  it("has a default template Experience", () => {
    const fixtures = loadFixtures(FIXTURES_PATH)
    expect(fixtures.experiences.some((e) => e.isTemplate === true)).toBe(true)
  })

  it("has at least one Video with parents", () => {
    const fixtures = loadFixtures(FIXTURES_PATH)
    expect(fixtures.videos.some((v) => v.parents && v.parents.length > 0)).toBe(
      true,
    )
  })

  it("has multiple locales across at least one Experience", () => {
    const fixtures = loadFixtures(FIXTURES_PATH)
    expect(fixtures.experiences.some((e) => e.locales.length > 1)).toBe(true)
  })
})
