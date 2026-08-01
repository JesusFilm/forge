#!/usr/bin/env tsx
/**
 * Seed a curated admin DB with the fixtures apps/web needs to render
 * every page locally. Includes Languages / Countries / Keywords (small
 * reference set), Videos with parents/children relations, a homepage
 * Experience, a few slug Experiences (multiple locales), and a default
 * template Experience (so `WatchSettingService.get` resolves both
 * homepage + defaultTemplate).
 *
 * Idempotent: rerun against the same DB produces no duplicates.
 *  - Reference rows keyed by `coreId` (UNIQUE in schema).
 *  - Videos keyed by `coreId` (UNIQUE) → upsert by coreId.
 *  - VideoLocale keyed by `(videoId, languageId)` (UNIQUE since migration
 *    0027 dropped the old `(videoId, locale)` key). Fixtures reference the
 *    language by `languageCoreId`; `locale` / `languageSlug` /
 *    `languageCoreId` are derived from the resolved Language row, mirroring
 *    core-sync's `toVideoLocales` convention. Reruns against DBs seeded
 *    before 0026 still converge: 0026's backfill populated `language_id`
 *    from the bcp47 join, so legacy fixture rows match the new upsert key.
 *  - VideoRelation keyed by `(parentId, childId)` (UNIQUE).
 *  - Experiences keyed by the FIRST locale's `(slug, locale)` — that
 *    pair uniquely identifies a fixture experience and lets a rerun
 *    find the existing parent without storing fixture metadata in the
 *    DB. The script's per-fixture flow: find an ExperienceLocale by
 *    (slug, locale); if found, reuse its experienceId for all locales
 *    in the fixture; otherwise create the parent + first locale, then
 *    add remaining locales as upserts.
 *
 * Safety: refuses to run when DATABASE_URL points at a known prod host.
 * The check is fail-closed — a URL that won't parse is also refused.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin seed-web-fixtures
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
// Type-only import — erased at runtime, so the PrismaLike seam below still
// accepts the test fake. The `satisfies` checks on the videoLocale upsert
// payloads keep the literals aligned with the GENERATED client types, so an
// identity-migration rename (the bug class this script was broken by) fails
// `tsc` instead of failing at runtime against a real DB.
import type { Prisma } from "@prisma/client"

// ---------------------------------------------------------------------------
// Prod-URL guard — fail-closed.
//
// Refuses any DATABASE_URL whose host:
//   - ends with `.railway.app` (Railway's PG endpoints)
//   - matches `admin.jesusfilm.org` (admin's prod marketing surface)
//   - is on the explicit prod-host deny set below
// or fails to parse at all.
//
// Local hosts (`localhost`, `127.0.0.1`, container hostnames like `db`)
// and devcontainer mDNS hosts are allowed.
// ---------------------------------------------------------------------------

const PROD_HOST_DENY_SET = new Set<string>([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])

function isProdDatabaseUrl(rawUrl: string): {
  isProd: boolean
  reason: string
} {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    // Fail-closed: if we can't parse the URL we can't prove it's local.
    return { isProd: true, reason: "DATABASE_URL is not a parseable URL" }
  }
  const host = parsed.hostname.toLowerCase()
  if (host.endsWith(".railway.app")) {
    return { isProd: true, reason: `host ${host} ends with .railway.app` }
  }
  if (host.endsWith(".jesusfilm.org")) {
    return { isProd: true, reason: `host ${host} ends with .jesusfilm.org` }
  }
  if (PROD_HOST_DENY_SET.has(host)) {
    return { isProd: true, reason: `host ${host} is on the prod deny set` }
  }
  return { isProd: false, reason: "" }
}

// ---------------------------------------------------------------------------
// Fixture shape — mirrors web-fixtures.json.
// ---------------------------------------------------------------------------

type LanguageFixture = {
  coreId: string
  bcp47: string
  iso3: string
  slug: string
  name: Record<string, string>
}

type CountryFixture = {
  coreId: string
  name: Record<string, string>
}

type KeywordFixture = {
  coreId: string
  value: string
}

type VideoLocaleFixture = {
  languageCoreId: string
  title: string
  description: string
}

type VideoDubFixture = {
  fixtureId: string
  languageCoreId: string
  hls: string
  duration: number
}

type VideoStudyQuestionFixture = {
  fixtureId: string
  languageCoreId: string
  text: string
  order: number
}

type VideoGeneratedQuestionFixture = {
  fixtureId: string
  sourceStudyQuestionFixtureId: string
  languageCoreId: string
  question: string
  answer: string
  order: number
}

type VideoFixture = {
  coreId: string
  slug: string
  label: string
  publishedAt: string
  locales: VideoLocaleFixture[]
  dubs?: VideoDubFixture[]
  studyQuestions?: VideoStudyQuestionFixture[]
  generatedQuestions?: VideoGeneratedQuestionFixture[]
  parents?: string[]
}

type ExperienceLocaleFixture = {
  locale: string
  slug: string
  title: string
  metaDescription: string
  blocks: unknown[]
}

type ExperienceFixture = {
  fixtureId: string
  isTemplate: boolean
  isHomepage: boolean
  locales: ExperienceLocaleFixture[]
}

export type WebFixtures = {
  languages: LanguageFixture[]
  countries: CountryFixture[]
  keywords: KeywordFixture[]
  videos: VideoFixture[]
  experiences: ExperienceFixture[]
}

export type SeedSummary = {
  languages: number
  countries: number
  keywords: number
  videos: number
  videoLocales: number
  videoDubs: number
  videoRelations: number
  videoStudyQuestions: number
  videoGeneratedQuestions: number
  experiences: number
  experienceLocales: number
}

function normalizeFixtureBlocks(
  value: unknown,
  args: {
    videoIdByCoreId: Map<string, string>
    fallbackLanguageId: string
  },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFixtureBlocks(item, args))
  }

  if (typeof value !== "object" || value == null) return value

  const record = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    if (key === "streamingUrl" || key === "videoCoreId") continue
    next[key] = normalizeFixtureBlocks(child, args)
  }

  const videoCoreId =
    typeof record.videoCoreId === "string" ? record.videoCoreId : null
  if (videoCoreId) {
    next.videoId = args.videoIdByCoreId.get(videoCoreId)
  }

  if (typeof next.videoId === "string" && typeof next.languageId !== "string") {
    next.languageId = args.fallbackLanguageId
  }

  return next
}

/**
 * A video-locale fixture references a `languageCoreId` that has no matching
 * entry in the fixture `languages` array. Fixtures are a closed set, so a
 * miss is a fixture-authoring bug — fail fast rather than skip.
 */
export class UnknownLanguageCoreIdError extends Error {
  constructor(
    readonly languageCoreId: string,
    readonly videoCoreId: string,
  ) {
    super(
      `[seed-web-fixtures] Video fixture "${videoCoreId}" references ` +
        `languageCoreId "${languageCoreId}", which is not in the fixture ` +
        `languages array. Add the language to web-fixtures.json.`,
    )
    this.name = "UnknownLanguageCoreIdError"
  }
}

/**
 * Two locale entries on one video fixture resolve to the same language.
 * Under the `(videoId, languageId)` identity the second entry would silently
 * UPDATE the first (one row in the DB, two counted in the summary) — fail
 * fast on the authoring bug instead.
 */
export class DuplicateLanguageCoreIdError extends Error {
  constructor(
    readonly languageCoreId: string,
    readonly videoCoreId: string,
  ) {
    super(
      `[seed-web-fixtures] Video fixture "${videoCoreId}" lists ` +
        `languageCoreId "${languageCoreId}" more than once. Each video ` +
        `locale must reference a distinct language.`,
    )
    this.name = "DuplicateLanguageCoreIdError"
  }
}

// ---------------------------------------------------------------------------
// Seeding — exposed for tests.
//
// Idempotence:
//  - Reference rows: `prisma.<model>.upsert({ where: { coreId }, ... })`.
//  - Videos: `prisma.video.upsert({ where: { coreId }, ... })`.
//  - Locales: `prisma.<model>.upsert({ where: { <unique-composite> }, ... })`.
//  - VideoRelations: `prisma.videoRelation.upsert({ where: { parentId_childId }, ... })`.
//  - Experiences: lookup by FIRST locale (slug, locale); reuse experienceId
//    if found, otherwise create.
// ---------------------------------------------------------------------------

// Loose Prisma surface — kept untyped here so the script can be called
// from both run-time (PrismaClient) and tests (mocked) without coupling
// to Prisma's generated types at this seam.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any

export async function seedWebFixtures(
  prisma: PrismaLike,
  fixtures: WebFixtures,
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    languages: 0,
    countries: 0,
    keywords: 0,
    videos: 0,
    videoLocales: 0,
    videoDubs: 0,
    videoRelations: 0,
    videoStudyQuestions: 0,
    videoGeneratedQuestions: 0,
    experiences: 0,
    experienceLocales: 0,
  }

  // ── Languages ──────────────────────────────────────────────────────
  // Keyed by coreId (UNIQUE in schema — no dup-check needed). VideoLocale
  // seeding below resolves languages from this map to derive the
  // `locale` / `languageSlug` / `languageCoreId` columns.
  const languageByCoreId = new Map<
    string,
    { id: string; coreId: string; bcp47: string; slug: string }
  >()
  for (const lang of fixtures.languages) {
    const row = await prisma.language.upsert({
      where: { coreId: lang.coreId },
      create: {
        coreId: lang.coreId,
        bcp47: lang.bcp47,
        iso3: lang.iso3,
        slug: lang.slug,
        name: lang.name,
      },
      update: {
        bcp47: lang.bcp47,
        iso3: lang.iso3,
        slug: lang.slug,
        name: lang.name,
      },
    })
    languageByCoreId.set(lang.coreId, {
      id: row.id,
      coreId: lang.coreId,
      bcp47: lang.bcp47,
      slug: lang.slug,
    })
    summary.languages += 1
  }

  // ── Countries ──────────────────────────────────────────────────────
  for (const country of fixtures.countries) {
    await prisma.country.upsert({
      where: { coreId: country.coreId },
      create: { coreId: country.coreId, name: country.name },
      update: { name: country.name },
    })
    summary.countries += 1
  }

  // ── Keywords ───────────────────────────────────────────────────────
  for (const kw of fixtures.keywords) {
    await prisma.keyword.upsert({
      where: { coreId: kw.coreId },
      create: { coreId: kw.coreId, value: kw.value },
      update: { value: kw.value },
    })
    summary.keywords += 1
  }

  // ── Videos + locales ───────────────────────────────────────────────
  // Map from fixture coreId → DB row id, needed for VideoRelation upserts.
  const videoIdByCoreId = new Map<string, string>()

  for (const v of fixtures.videos) {
    const video = await prisma.video.upsert({
      where: { coreId: v.coreId },
      create: {
        coreId: v.coreId,
        slug: v.slug,
        label: v.label,
        publishedAt: new Date(v.publishedAt),
      },
      update: {
        slug: v.slug,
        label: v.label,
        publishedAt: new Date(v.publishedAt),
      },
    })
    videoIdByCoreId.set(v.coreId, video.id)
    summary.videos += 1

    const seenLanguageCoreIds = new Set<string>()
    for (const loc of v.locales) {
      if (seenLanguageCoreIds.has(loc.languageCoreId)) {
        throw new DuplicateLanguageCoreIdError(loc.languageCoreId, v.coreId)
      }
      seenLanguageCoreIds.add(loc.languageCoreId)
      const lang = languageByCoreId.get(loc.languageCoreId)
      if (!lang) {
        throw new UnknownLanguageCoreIdError(loc.languageCoreId, v.coreId)
      }
      // `locale` / `languageSlug` / `languageCoreId` are derived from the
      // resolved Language row (core-sync's `toVideoLocales` convention) —
      // `videoLocalesFilter` filters and orders by `languageSlug`, so rows
      // missing it would vanish from languageSlug-filtered queries. One
      // shared payload feeds both upsert branches so they cannot drift.
      const localePayload = {
        locale: lang.bcp47,
        languageSlug: lang.slug,
        languageCoreId: lang.coreId,
        title: loc.title,
        description: loc.description,
        status: "PUBLISHED",
        publishedAt: new Date(v.publishedAt),
      } satisfies Prisma.VideoLocaleUncheckedUpdateInput
      // NOTE: `languageId` must be explicit in `create` — Prisma's upsert
      // `create` does NOT inherit fields from the compound `where`, and a
      // NULL languageId row would break idempotence (Postgres treats NULLs
      // as distinct in unique indexes).
      await prisma.videoLocale.upsert({
        where: {
          videoId_languageId: { videoId: video.id, languageId: lang.id },
        } satisfies Prisma.VideoLocaleWhereUniqueInput,
        create: {
          videoId: video.id,
          languageId: lang.id,
          ...localePayload,
        } satisfies Prisma.VideoLocaleUncheckedCreateInput,
        update: localePayload,
      })
      summary.videoLocales += 1
    }

    for (const dub of v.dubs ?? []) {
      const lang = languageByCoreId.get(dub.languageCoreId)
      if (!lang) {
        throw new UnknownLanguageCoreIdError(dub.languageCoreId, v.coreId)
      }
      const dubPayload = {
        source: "CORE",
        slug: lang.slug,
        duration: dub.duration,
        hls: dub.hls,
        published: true,
        videoId: video.id,
        languageId: lang.id,
        deletedAt: null,
      } satisfies Prisma.VideoDubUncheckedUpdateInput
      await prisma.videoDub.upsert({
        where: { coreId: dub.fixtureId },
        create: {
          id: dub.fixtureId,
          coreId: dub.fixtureId,
          ...dubPayload,
        } satisfies Prisma.VideoDubUncheckedCreateInput,
        update: dubPayload,
      })
      summary.videoDubs += 1
    }

    const studyQuestionIdByFixtureId = new Map<string, string>()
    for (const question of v.studyQuestions ?? []) {
      const lang = languageByCoreId.get(question.languageCoreId)
      if (!lang) {
        throw new UnknownLanguageCoreIdError(question.languageCoreId, v.coreId)
      }
      const row = await prisma.videoStudyQuestion.upsert({
        where: { id: question.fixtureId },
        create: {
          id: question.fixtureId,
          coreId: question.fixtureId,
          source: "CORE",
          videoId: video.id,
          locale: lang.bcp47,
          languageId: lang.id,
          languageSlug: lang.slug,
          languageCoreId: lang.coreId,
          text: question.text,
          primary: question.languageCoreId === "529",
          order: question.order,
        } satisfies Prisma.VideoStudyQuestionUncheckedCreateInput,
        update: {
          videoId: video.id,
          locale: lang.bcp47,
          languageId: lang.id,
          languageSlug: lang.slug,
          languageCoreId: lang.coreId,
          text: question.text,
          primary: question.languageCoreId === "529",
          order: question.order,
          deletedAt: null,
        } satisfies Prisma.VideoStudyQuestionUncheckedUpdateInput,
      })
      studyQuestionIdByFixtureId.set(question.fixtureId, row.id)
      summary.videoStudyQuestions += 1
    }

    for (const generated of v.generatedQuestions ?? []) {
      const lang = languageByCoreId.get(generated.languageCoreId)
      if (!lang) {
        throw new UnknownLanguageCoreIdError(generated.languageCoreId, v.coreId)
      }
      const sourceStudyQuestionId = studyQuestionIdByFixtureId.get(
        generated.sourceStudyQuestionFixtureId,
      )
      if (!sourceStudyQuestionId) {
        throw new Error(
          `[seed-web-fixtures] Generated question "${generated.fixtureId}" references missing study question "${generated.sourceStudyQuestionFixtureId}" on video "${v.coreId}".`,
        )
      }
      const generatedPayload = {
        videoId: video.id,
        sourceStudyQuestionId,
        locale: lang.bcp47,
        languageId: lang.id,
        languageSlug: lang.slug,
        question: generated.question,
        answer: generated.answer,
        order: generated.order,
        status: "PUBLISHED",
        publishedAt: new Date(v.publishedAt),
        generationProvider: "fixture",
        generationModel: "fixture-grounded-v1",
        generationMode: "local-demo",
        generatedAt: new Date(v.publishedAt),
        deletedAt: null,
      } satisfies Prisma.VideoGeneratedQuestionUncheckedUpdateInput
      await prisma.videoGeneratedQuestion.upsert({
        where: { id: generated.fixtureId },
        create: {
          id: generated.fixtureId,
          ...generatedPayload,
        } satisfies Prisma.VideoGeneratedQuestionUncheckedCreateInput,
        update: generatedPayload,
      })
      summary.videoGeneratedQuestions += 1
    }
  }

  // ── VideoRelations (second pass — needs all video ids resolved) ────
  for (const v of fixtures.videos) {
    const childId = videoIdByCoreId.get(v.coreId)
    if (!childId || !v.parents) continue
    for (const parentCoreId of v.parents) {
      const parentId = videoIdByCoreId.get(parentCoreId)
      if (!parentId) continue
      await prisma.videoRelation.upsert({
        where: { parentId_childId: { parentId, childId } },
        create: { parentId, childId },
        update: {},
      })
      summary.videoRelations += 1
    }
  }

  // ── Experiences + locales ──────────────────────────────────────────
  const englishLanguageId = languageByCoreId.get("529")?.id
  if (!englishLanguageId) {
    throw new UnknownLanguageCoreIdError("529", "experience blocks")
  }

  const blocksForLocale = (loc: ExperienceLocaleFixture) =>
    normalizeFixtureBlocks(loc.blocks, {
      videoIdByCoreId,
      fallbackLanguageId: englishLanguageId,
    })

  for (const exp of fixtures.experiences) {
    if (exp.locales.length === 0) continue
    const [firstLocale, ...rest] = exp.locales
    const firstLocaleBlocks = blocksForLocale(firstLocale)

    // Look up an existing fixture experience by the first locale's
    // (slug, locale). This lets a rerun find and reuse the parent
    // without persisting fixture metadata in the DB.
    const existingLocale = await prisma.experienceLocale.findFirst({
      where: { slug: firstLocale.slug, locale: firstLocale.locale },
      select: { experienceId: true },
    })

    let experienceId: string
    if (existingLocale) {
      experienceId = existingLocale.experienceId
      // Refresh parent-side flags so rerun applies edits to fixtures.
      await prisma.experience.update({
        where: { id: experienceId },
        data: { isTemplate: exp.isTemplate, archivedAt: null },
      })
      // Refresh the first locale's payload.
      await prisma.experienceLocale.update({
        where: {
          experienceId_locale: {
            experienceId,
            locale: firstLocale.locale,
          },
        },
        data: {
          slug: firstLocale.slug,
          isHomepage: exp.isHomepage,
          title: firstLocale.title,
          metaDescription: firstLocale.metaDescription,
          blocks: firstLocaleBlocks,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      })
    } else {
      const created = await prisma.experience.create({
        data: {
          isTemplate: exp.isTemplate,
          ownerId: null,
          locales: {
            create: {
              locale: firstLocale.locale,
              slug: firstLocale.slug,
              isHomepage: exp.isHomepage,
              title: firstLocale.title,
              metaDescription: firstLocale.metaDescription,
              blocks: firstLocaleBlocks,
              status: "PUBLISHED",
              publishedAt: new Date(),
            },
          },
        },
      })
      experienceId = created.id
    }
    summary.experiences += 1
    summary.experienceLocales += 1

    for (const loc of rest) {
      const localeBlocks = blocksForLocale(loc)
      await prisma.experienceLocale.upsert({
        where: {
          experienceId_locale: { experienceId, locale: loc.locale },
        },
        create: {
          experienceId,
          locale: loc.locale,
          slug: loc.slug,
          isHomepage: false,
          title: loc.title,
          metaDescription: loc.metaDescription,
          blocks: localeBlocks,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        update: {
          slug: loc.slug,
          title: loc.title,
          metaDescription: loc.metaDescription,
          blocks: localeBlocks,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      })
      summary.experienceLocales += 1
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// Boundary helpers — exposed for tests so safety + IO logic stays one path.
// ---------------------------------------------------------------------------

export function assertNotProdUrl(rawUrl: string | undefined): void {
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required (no value set).")
  }
  const verdict = isProdDatabaseUrl(rawUrl)
  if (verdict.isProd) {
    throw new Error(
      `[seed-web-fixtures] Refusing to run: ${verdict.reason}. ` +
        `This script is local-development only. Point DATABASE_URL at a ` +
        `local Postgres (e.g. postgresql://forge:forge@localhost:5433/forge_admin) ` +
        `and try again.`,
    )
  }
}

export function loadFixtures(path: string): WebFixtures {
  const raw = readFileSync(path, "utf8")
  return JSON.parse(raw) as WebFixtures
}

// ---------------------------------------------------------------------------
// Script entry — only runs when invoked directly, not when imported by tests.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertNotProdUrl(process.env.DATABASE_URL)

  const here = dirname(fileURLToPath(import.meta.url))
  const fixturesPath = resolve(here, "web-fixtures.json")
  const fixtures = loadFixtures(fixturesPath)

  // Redact password before logging the URL.
  const redacted = (process.env.DATABASE_URL ?? "").replace(
    /:\/\/[^@]+@/,
    "://***:***@",
  )
  process.stdout.write(
    JSON.stringify({
      event: "seed-web-fixtures.start",
      databaseUrl: redacted,
      fixturesPath,
      counts: {
        languages: fixtures.languages.length,
        countries: fixtures.countries.length,
        keywords: fixtures.keywords.length,
        videos: fixtures.videos.length,
        experiences: fixtures.experiences.length,
      },
    }) + "\n",
  )

  const { prisma } = await import("@/db/client")
  try {
    const summary = await seedWebFixtures(prisma, fixtures)
    process.stdout.write(
      JSON.stringify({
        event: "seed-web-fixtures.complete",
        summary,
      }) + "\n",
    )
  } finally {
    await prisma.$disconnect()
  }
}

// When invoked directly via tsx, run main(). Tests import the named
// exports above without triggering main().
const isDirectInvoke =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectInvoke) {
  main().catch((err) => {
    process.stderr.write(
      `[seed-web-fixtures] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
  })
}
