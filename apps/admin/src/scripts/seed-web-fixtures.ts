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
 *  - VideoLocale keyed by `(videoId, locale)` (UNIQUE).
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
  locale: string
  title: string
  description: string
}

type VideoFixture = {
  coreId: string
  slug: string
  label: string
  publishedAt: string
  locales: VideoLocaleFixture[]
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
  videoRelations: number
  experiences: number
  experienceLocales: number
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
    videoRelations: 0,
    experiences: 0,
    experienceLocales: 0,
  }

  // ── Languages ──────────────────────────────────────────────────────
  for (const lang of fixtures.languages) {
    await prisma.language.upsert({
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

    for (const loc of v.locales) {
      await prisma.videoLocale.upsert({
        where: { videoId_locale: { videoId: video.id, locale: loc.locale } },
        create: {
          videoId: video.id,
          locale: loc.locale,
          title: loc.title,
          description: loc.description,
          status: "PUBLISHED",
          publishedAt: new Date(v.publishedAt),
        },
        update: {
          title: loc.title,
          description: loc.description,
          status: "PUBLISHED",
          publishedAt: new Date(v.publishedAt),
        },
      })
      summary.videoLocales += 1
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
  for (const exp of fixtures.experiences) {
    if (exp.locales.length === 0) continue
    const [firstLocale, ...rest] = exp.locales

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
          blocks: firstLocale.blocks,
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
              blocks: firstLocale.blocks,
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
          blocks: loc.blocks,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        update: {
          slug: loc.slug,
          title: loc.title,
          metaDescription: loc.metaDescription,
          blocks: loc.blocks,
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
