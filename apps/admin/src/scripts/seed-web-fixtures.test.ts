import { resolve } from "node:path"
import { describe, expect, it, beforeEach } from "vitest"
import {
  assertNotProdUrl,
  DuplicateLanguageCoreIdError,
  loadFixtures,
  seedWebFixtures,
  UnknownLanguageCoreIdError,
  type WebFixtures,
} from "./seed-web-fixtures"

// ---------------------------------------------------------------------------
// In-memory Prisma fake. Models the unique-key behavior the seed relies
// on (`coreId` UNIQUE on Language/Country/Keyword/Video;
// `(videoId, languageId)` UNIQUE on VideoLocale — the post-0026/0027
// Language-FK identity; `(parentId, childId)` UNIQUE on VideoRelation;
// `(experienceId, locale)` UNIQUE on ExperienceLocale). Insufficient for
// full Prisma semantics but exercises the seed's idempotence + coverage
// contracts.
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
  const videoLocale = makeKeyedTable<"videoId_languageId">((r) =>
    JSON.stringify({
      videoId_languageId: { videoId: r.videoId, languageId: r.languageId },
    }),
  )
  const videoDub = makeKeyedTable<"coreId">((r) =>
    JSON.stringify({ coreId: r.coreId }),
  )
  const videoRelation = makeKeyedTable<"parentId_childId">((r) =>
    JSON.stringify({
      parentId_childId: { parentId: r.parentId, childId: r.childId },
    }),
  )
  const videoStudyQuestion = makeKeyedTable<"id">((r) =>
    JSON.stringify({ id: r.id }),
  )
  const videoGeneratedQuestion = makeKeyedTable<"id">((r) =>
    JSON.stringify({ id: r.id }),
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
    videoDub,
    videoRelation,
    videoStudyQuestion,
    videoGeneratedQuestion,
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
    expect(summary.videoDubs).toBe(
      FIXTURES.videos.reduce(
        (total, video) => total + (video.dubs?.length ?? 0),
        0,
      ),
    )

    const totalRelations = FIXTURES.videos.reduce(
      (acc, v) => acc + (v.parents?.length ?? 0),
      0,
    )
    expect(summary.videoRelations).toBe(totalRelations)
    expect(summary.videoStudyQuestions).toBe(
      FIXTURES.videos.reduce(
        (total, video) => total + (video.studyQuestions?.length ?? 0),
        0,
      ),
    )
    expect(summary.videoGeneratedQuestions).toBe(
      FIXTURES.videos.reduce(
        (total, video) => total + (video.generatedQuestions?.length ?? 0),
        0,
      ),
    )
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
      videoDubs: prisma.videoDub.store.size,
      videoRelations: prisma.videoRelation.store.size,
      videoStudyQuestions: prisma.videoStudyQuestion.store.size,
      videoGeneratedQuestions: prisma.videoGeneratedQuestion.store.size,
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
      videoDubs: prisma.videoDub.store.size,
      videoRelations: prisma.videoRelation.store.size,
      videoStudyQuestions: prisma.videoStudyQuestion.store.size,
      videoGeneratedQuestions: prisma.videoGeneratedQuestion.store.size,
      experiences: prisma.experience.store.size,
      experienceLocales: prisma.experienceLocale.store.size,
    }
    expect(second).toEqual(first)
  })

  // Contract assertions (mocked-shape-vs-real-contract remedy): the fake's
  // storage key proves the upsert SHAPE; these prove the stored rows carry
  // the derived columns the real read path filters on (`videoLocalesFilter`
  // orders/filters by `languageSlug`).
  it("stores videoLocale rows with a resolved languageId + derived locale/languageSlug/languageCoreId", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    const languagesByCoreId = new Map(
      [...prisma.language.store.values()].map((l) => [l.coreId as string, l]),
    )
    const rows = [...prisma.videoLocale.store.values()]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.languageId).toBeTruthy()
      expect(row.languageSlug).toBeTruthy()
      expect(row.languageCoreId).toBeTruthy()
      const lang = languagesByCoreId.get(row.languageCoreId as string)
      expect(lang).toBeDefined()
      expect(row.languageId).toBe(lang?.id)
      expect(row.locale).toBe(lang?.bcp47)
      expect(row.languageSlug).toBe(lang?.slug)
    }
  })

  it("throws UnknownLanguageCoreIdError when a video locale references an unknown languageCoreId", async () => {
    const prisma = makePrisma()
    const fixtures: WebFixtures = {
      ...FIXTURES,
      videos: [
        {
          coreId: "fixt-bad-lang",
          slug: "fixt-bad-lang",
          label: "SHORT_FILM",
          publishedAt: "2026-01-06T00:00:00.000Z",
          locales: [
            {
              languageCoreId: "not-a-real-core-id",
              title: "Bad Language",
              description:
                "References a languageCoreId outside the fixture set.",
            },
          ],
        },
      ],
    }
    await expect(seedWebFixtures(prisma, fixtures)).rejects.toThrow(
      UnknownLanguageCoreIdError,
    )
    await expect(seedWebFixtures(prisma, fixtures)).rejects.toThrow(
      /not-a-real-core-id/,
    )
  })

  it("throws DuplicateLanguageCoreIdError when one video lists the same languageCoreId twice", async () => {
    const prisma = makePrisma()
    const fixtures: WebFixtures = {
      ...FIXTURES,
      videos: [
        {
          coreId: "fixt-dup-lang",
          slug: "fixt-dup-lang",
          label: "SHORT_FILM",
          publishedAt: "2026-01-07T00:00:00.000Z",
          locales: [
            {
              languageCoreId: "529",
              title: "First English Entry",
              description: "First entry.",
            },
            {
              languageCoreId: "529",
              title: "Second English Entry",
              description: "Would silently overwrite the first.",
            },
          ],
        },
      ],
    }
    await expect(seedWebFixtures(prisma, fixtures)).rejects.toThrow(
      DuplicateLanguageCoreIdError,
    )
  })

  it("refreshes derived columns on rerun when a fixture language changes (update branch)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    // Simulate a fixture edit between runs: the English language's slug and
    // bcp47 change. The rerun must push the new derived values onto the
    // EXISTING videoLocale rows via the upsert's update branch — stale
    // derived columns on pre-seeded DBs are an idempotence divergence the
    // count-based test above cannot see.
    const english = FIXTURES.languages.find((l) => l.coreId === "529")
    expect(english).toBeDefined()
    if (!english) return
    english.slug = "english-us"
    english.bcp47 = "en-US"
    await seedWebFixtures(prisma, FIXTURES)

    const englishRows = [...prisma.videoLocale.store.values()].filter(
      (r) => r.languageCoreId === "529",
    )
    expect(englishRows.length).toBeGreaterThan(0)
    for (const row of englishRows) {
      expect(row.languageSlug).toBe("english-us")
      expect(row.locale).toBe("en-US")
    }
  })

  it("seeds at least one Video reachable via slug (videoBySlug coverage)", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)
    const rows = [...prisma.video.store.values()]
    expect(rows.some((r) => r.slug === "jesus-feature-film")).toBe(true)
  })

  it("seeds playable dubs for every route used by the generated-Q&A demo", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    const demoCoreIds = new Set([
      "fixt-jesus-feature",
      "fixt-easter-explained",
      "fixt-my-last-day",
    ])
    const demoVideoIds = new Set(
      [...prisma.video.store.values()]
        .filter((video) => demoCoreIds.has(String(video.coreId)))
        .map((video) => video.id),
    )
    const playableDemoVideoIds = new Set(
      [...prisma.videoDub.store.values()]
        .filter(
          (dub) =>
            dub.published === true &&
            typeof dub.hls === "string" &&
            dub.hls.length > 0,
        )
        .map((dub) => dub.videoId),
    )

    expect(playableDemoVideoIds).toEqual(demoVideoIds)
  })

  it("seeds distinct grounded generated Q&A for two videos and leaves another empty", async () => {
    const prisma = makePrisma()
    await seedWebFixtures(prisma, FIXTURES)

    const videosByCoreId = new Map(
      [...prisma.video.store.values()].map((video) => [
        video.coreId as string,
        video,
      ]),
    )
    const generatedRows = [...prisma.videoGeneratedQuestion.store.values()]
    const featureId = videosByCoreId.get("fixt-jesus-feature")?.id
    const easterId = videosByCoreId.get("fixt-easter-explained")?.id
    const noDataId = videosByCoreId.get("fixt-my-last-day")?.id

    expect(
      generatedRows.filter((row) => row.videoId === featureId),
    ).not.toHaveLength(0)
    expect(
      generatedRows.filter((row) => row.videoId === easterId),
    ).not.toHaveLength(0)
    expect(generatedRows.filter((row) => row.videoId === noDataId)).toEqual([])
    expect(new Set(generatedRows.map((row) => row.question)).size).toBe(
      generatedRows.length,
    )
    expect(
      generatedRows.every(
        (row) =>
          row.status === "PUBLISHED" &&
          typeof row.sourceStudyQuestionId === "string",
      ),
    ).toBe(true)
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

  it("uses an invitation, questions, and two question CTAs for the local default template example", () => {
    const fixtures = loadFixtures(FIXTURES_PATH)
    const template = fixtures.experiences.find((e) => e.isTemplate === true)
    const blocks = template?.locales[0]?.blocks as
      | Array<Record<string, unknown>>
      | undefined

    expect(blocks?.map((block) => block.t)).toEqual([
      "text",
      "relatedQuestions",
      "container",
    ])
    expect(blocks?.[0]).toMatchObject({
      sectionKey: "single-video-question-invitation",
      variant: "promotional",
    })
    expect(blocks?.[1]).toMatchObject({
      sectionKey: "single-video-shared-questions",
      questionsSource: "routeVideoGeneratedQuestions",
      questions: expect.any(Array),
    })

    const ctaContent = blocks?.[2]?.content as
      | Array<Record<string, unknown>>
      | undefined
    expect(ctaContent?.filter((block) => block.t === "cta")).toMatchObject([
      {
        buttonLabel: "Chat with a person",
        buttonLink:
          "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch",
      },
      {
        buttonLabel: "Ask a Bible question",
        buttonLink:
          "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch",
      },
    ])
    expect(
      blocks?.some((block) =>
        ["video", "videoHero", "videoCarousel"].includes(String(block.t)),
      ),
    ).toBe(false)
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
