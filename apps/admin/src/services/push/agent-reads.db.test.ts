/**
 * Real-Postgres proof of the agent reads (KTD8, KTD9, KTD10, KTD18).
 *
 * Mocked Prisma proves the branch shape. Only Postgres proves the name search
 * in the JSON column, the published parity of each destination, and the
 * per-language counts beside the dashboard's own count.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/agent-reads.db.test.ts
 */
import { PrismaClient, type PushDestinationKind } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  countPushAgentAudience,
  listPushAgentCampaigns,
  searchPushAgentDestinations,
  searchPushAgentLanguages,
} from "./agent-reads.service"
import { countPushAudience, type PushAudienceQuery } from "./audience.service"
import { listPushLanguageOptions } from "./dashboard.service"
import { isPushDestinationPublished } from "./destinations"

const databaseUrl = process.env.DATABASE_URL
// Sibling database suites run in parallel, so every row and every read here
// is scoped to this prefix.
const PREFIX = "push_reads_db_"
const mine = { id: { startsWith: PREFIX } }

const SPANISH = `${PREFIX}spanish`
const RETIRED = `${PREFIX}retired`
const KLINGON = `${PREFIX}klingon`

// The audience is global by design, so the counts read only two zones that no
// sibling suite writes.
const MY_ZONES = ["Pacific/Funafuti", "Pacific/Nauru"]

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushCampaign.deleteMany({ where: mine })
  await prisma.pushRegistration.deleteMany({ where: mine })
  await prisma.video.deleteMany({ where: mine })
  await prisma.experience.deleteMany({ where: mine })
  await prisma.language.deleteMany({ where: mine })
}

function language(slug: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${PREFIX}lang_${slug}`,
    coreId: `${PREFIX}core_${slug}`,
    slug,
    ...extra,
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push agent reads against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.language.createMany({
        data: [
          language(SPANISH, {
            bcp47: "es",
            name: { en: "Spanish Pushreads", es: "Español Pushreads" },
          }),
          language(RETIRED, {
            name: { en: "Retired Pushreads" },
            deletedAt: new Date("2026-09-01T00:00:00Z"),
          }),
        ],
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    describe("language search (KTD8)", () => {
      it("returns the known slugs and lists an unknown or deleted one", async () => {
        const result = await searchPushAgentLanguages(prisma, {
          slugs: [SPANISH, KLINGON, RETIRED],
        })

        expect(result.languages).toEqual([
          {
            slug: SPANISH,
            englishName: "Spanish Pushreads",
            nativeName: "Español Pushreads",
            bcp47: "es",
          },
        ])
        expect([...result.unknown].sort()).toEqual([KLINGON, RETIRED].sort())
      })

      it("finds a language by its English name in any case", async () => {
        const result = await searchPushAgentLanguages(prisma, {
          q: "spanish pushREADS",
        })

        expect(result.languages.map((row) => row.slug)).toEqual([SPANISH])
      })

      it("does not return a deleted language", async () => {
        const result = await searchPushAgentLanguages(prisma, {
          q: "Retired Pushreads",
        })

        expect(result.languages).toEqual([])
      })

      it("finds a language outside the dashboard picker's first 2,000 rows", async () => {
        const target = `${PREFIX}zz_target`
        await prisma.language.createMany({
          data: [
            ...Array.from({ length: 2_000 }, (_, index) =>
              language(`${PREFIX}filler_${String(index).padStart(4, "0")}`),
            ),
            language(target, { name: { en: "Faraway Pushreads" } }),
          ],
        })
        // Precondition: the picker's unordered 2,000-row read misses the row,
        // so the search below cannot pass by reading the same window.
        const picker = await listPushLanguageOptions(prisma)
        expect(picker.map((option) => option.slug)).not.toContain(target)

        const result = await searchPushAgentLanguages(prisma, {
          q: "faraway pushreads",
        })

        expect(result.languages).toEqual([
          {
            slug: target,
            englishName: "Faraway Pushreads",
            nativeName: null,
            bcp47: null,
          },
        ])
      })
    })

    describe("destination search (KTD9)", () => {
      async function seedVideo(input: {
        slug: string
        label: "FEATURE_FILM" | "COLLECTION"
        localeStatus: "PUBLISHED" | "DRAFT"
        restricted?: boolean
        deleted?: boolean
      }) {
        await prisma.video.create({
          data: {
            id: `${PREFIX}video_${input.slug}`,
            coreId: `${PREFIX}core_video_${input.slug}`,
            slug: input.slug,
            label: input.label,
            restrictViewPlatforms: input.restricted ? ["watch"] : [],
            deletedAt: input.deleted ? new Date("2026-09-01T00:00:00Z") : null,
            locales: {
              create: {
                locale: "en",
                title: `Title of ${input.slug}`,
                status: input.localeStatus,
              },
            },
          },
        })
      }

      async function seedExperience(input: {
        slug: string
        archived?: boolean
        locales: ReadonlyArray<{
          locale: string
          title: string
          status: "PUBLISHED" | "DRAFT"
        }>
      }) {
        await prisma.experience.create({
          data: {
            id: `${PREFIX}experience_${input.slug}`,
            archivedAt: input.archived
              ? new Date("2026-09-01T00:00:00Z")
              : null,
            locales: {
              create: input.locales.map((locale) => ({
                slug: input.slug,
                ...locale,
              })),
            },
          },
        })
      }

      const PUBLISHED_FILM = `${PREFIX}published-film`
      const DRAFT_FILM = `${PREFIX}draft-film`
      const RESTRICTED_FILM = `${PREFIX}restricted-film`
      const DELETED_FILM = `${PREFIX}deleted-film`
      const COLLECTION = `${PREFIX}collection`
      const LIVE_EXPERIENCE = `${PREFIX}live-experience`
      const DRAFT_EXPERIENCE = `${PREFIX}draft-experience`
      const ARCHIVED_EXPERIENCE = `${PREFIX}archived-experience`

      beforeEach(async () => {
        await seedVideo({
          slug: PUBLISHED_FILM,
          label: "FEATURE_FILM",
          localeStatus: "PUBLISHED",
        })
        await seedVideo({
          slug: DRAFT_FILM,
          label: "FEATURE_FILM",
          localeStatus: "DRAFT",
        })
        await seedVideo({
          slug: RESTRICTED_FILM,
          label: "FEATURE_FILM",
          localeStatus: "PUBLISHED",
          restricted: true,
        })
        await seedVideo({
          slug: DELETED_FILM,
          label: "FEATURE_FILM",
          localeStatus: "PUBLISHED",
          deleted: true,
        })
        await seedVideo({
          slug: COLLECTION,
          label: "COLLECTION",
          localeStatus: "PUBLISHED",
        })
        await seedExperience({
          slug: LIVE_EXPERIENCE,
          locales: [
            { locale: "es", title: "Pascua", status: "PUBLISHED" },
            { locale: "en", title: "Easter", status: "PUBLISHED" },
          ],
        })
        await seedExperience({
          slug: DRAFT_EXPERIENCE,
          locales: [{ locale: "en", title: "Draft", status: "DRAFT" }],
        })
        await seedExperience({
          slug: ARCHIVED_EXPERIENCE,
          archived: true,
          locales: [{ locale: "en", title: "Archived", status: "PUBLISHED" }],
        })
      })

      it("flags each destination exactly as the send path's published check does", async () => {
        const result = await searchPushAgentDestinations(prisma, {
          q: PREFIX,
        })

        const bySlug = new Map(
          result.destinations.map((row) => [
            row.slug,
            { kind: row.kind, published: row.published, reason: row.reason },
          ]),
        )
        expect(Object.fromEntries(bySlug)).toEqual({
          [PUBLISHED_FILM]: { kind: "VIDEO", published: true, reason: null },
          [DRAFT_FILM]: {
            kind: "VIDEO",
            published: false,
            reason: "no_published_locale",
          },
          [RESTRICTED_FILM]: {
            kind: "VIDEO",
            published: false,
            reason: "watch_restricted",
          },
          [COLLECTION]: { kind: "SERIES", published: true, reason: null },
          [LIVE_EXPERIENCE]: {
            kind: "EXPERIENCE",
            published: true,
            reason: null,
          },
          [DRAFT_EXPERIENCE]: {
            kind: "EXPERIENCE",
            published: false,
            reason: "no_published_locale",
          },
          [ARCHIVED_EXPERIENCE]: {
            kind: "EXPERIENCE",
            published: false,
            reason: "archived",
          },
        })

        for (const row of result.destinations) {
          await expect(
            isPushDestinationPublished(prisma, {
              kind: row.kind as PushDestinationKind,
              slug: row.slug,
            }),
            row.slug,
          ).resolves.toBe(row.published)
        }
      })

      it("leaves out a deleted video", async () => {
        const result = await searchPushAgentDestinations(prisma, {
          q: DELETED_FILM,
        })

        expect(result.destinations).toEqual([])
      })

      it("returns an experience once, with its English title", async () => {
        const result = await searchPushAgentDestinations(prisma, {
          q: LIVE_EXPERIENCE,
          kind: "EXPERIENCE",
        })

        expect(result.destinations).toEqual([
          {
            kind: "EXPERIENCE",
            slug: LIVE_EXPERIENCE,
            title: "Easter",
            published: true,
            reason: null,
          },
        ])
      })
    })

    describe("audience counts (KTD10)", () => {
      type Phone = {
        suffix: string
        platform: "IOS" | "ANDROID"
        country: string
        appLanguageSlug: string
        status?: "ACTIVE" | "INACTIVE"
      }

      function registration(phone: Phone, index: number) {
        return {
          id: `${PREFIX}reg_${phone.suffix}`,
          expoPushToken: `ExponentPushToken[${PREFIX}${phone.suffix}]`,
          testDeviceId: `${PREFIX}device_${phone.suffix}`,
          installId: `${PREFIX}install_${phone.suffix}`,
          platform: phone.platform,
          appBuild: "1.0.0",
          appLanguageSlug: phone.appLanguageSlug,
          phoneLocale: "en-TV",
          phoneLanguageSlug: null,
          timeZone: MY_ZONES[index % MY_ZONES.length],
          country: phone.country,
          countrySource: "EDGE" as const,
          status: phone.status ?? ("ACTIVE" as const),
        }
      }

      const PHONES: Phone[] = [
        {
          suffix: "1",
          platform: "IOS",
          country: "TV",
          appLanguageSlug: SPANISH,
        },
        {
          suffix: "2",
          platform: "ANDROID",
          country: "TV",
          appLanguageSlug: SPANISH,
        },
        {
          suffix: "3",
          platform: "IOS",
          country: "CN",
          appLanguageSlug: SPANISH,
        },
        {
          suffix: "4",
          platform: "ANDROID",
          country: "CN",
          appLanguageSlug: SPANISH,
        },
        {
          suffix: "5",
          platform: "IOS",
          country: "CN",
          appLanguageSlug: KLINGON,
        },
        {
          suffix: "6",
          platform: "ANDROID",
          country: "CN",
          appLanguageSlug: RETIRED,
        },
        {
          suffix: "7",
          platform: "IOS",
          country: "FR",
          appLanguageSlug: SPANISH,
        },
        {
          suffix: "8",
          platform: "IOS",
          country: "TV",
          appLanguageSlug: SPANISH,
          status: "INACTIVE",
        },
      ]

      const QUERY: PushAudienceQuery = {
        campaign: {
          audienceScope: "COUNTRIES",
          countries: ["TV", "CN"],
          languageFilter: [],
        },
        timeZones: MY_ZONES,
      }

      beforeEach(async () => {
        await prisma.pushRegistration.createMany({
          data: PHONES.map(registration),
        })
      })

      it("counts one entry per app language with the dashboard's totals (AE8)", async () => {
        const counts = await countPushAgentAudience(prisma, QUERY)

        // Phones 1–3 and 5 are reachable; 4 and 6 are Android in China; 7 is
        // outside the countries and 8 is inactive.
        expect(counts).toEqual({
          total: 4,
          unreachable: 2,
          byAppLanguage: [
            { slug: SPANISH, name: "Spanish Pushreads", count: 3 },
            { slug: KLINGON, name: null, count: 1 },
          ],
        })
        const dashboard = await countPushAudience(prisma, QUERY)
        expect(counts.total).toBe(dashboard.audience)
        expect(counts.unreachable).toBe(dashboard.unreachable)
      })

      it("carries counts only, with no device data", async () => {
        const counts = await countPushAgentAudience(prisma, QUERY)

        const serialized = JSON.stringify(counts)
        for (const phone of PHONES.map(registration)) {
          expect(serialized).not.toContain(phone.expoPushToken)
          expect(serialized).not.toContain(phone.installId)
          expect(serialized).not.toContain(phone.timeZone)
          expect(serialized).not.toContain(phone.testDeviceId)
        }
        const keys = new Set<string>()
        JSON.parse(serialized, (key, value) => {
          if (key !== "" && !/^\d+$/.test(key)) keys.add(key)
          return value
        })
        expect([...keys].sort()).toEqual([
          "byAppLanguage",
          "count",
          "name",
          "slug",
          "total",
          "unreachable",
        ])
      })
    })

    describe("campaign list", () => {
      it("lists newest first and finds a campaign by its English title in any case", async () => {
        const campaign = (id: string, title: string, createdAt: string) =>
          prisma.pushCampaign.create({
            data: {
              id: `${PREFIX}${id}`,
              createdAt: new Date(createdAt),
              copies: {
                create: [
                  { languageSlug: "english", title, body: "Watch tonight" },
                  { languageSlug: SPANISH, title: "Pascua", body: "Mira" },
                ],
              },
            },
          })
        await campaign(
          "older",
          "Pushreads Easter older",
          "2026-10-01T00:00:00Z",
        )
        await campaign(
          "newer",
          "Pushreads Easter newer",
          "2026-10-03T00:00:00Z",
        )
        await campaign("other", "Pushreads Christmas", "2026-10-02T00:00:00Z")

        const found = await listPushAgentCampaigns(prisma, {
          q: "pushreads EASTER",
        })
        const bySpanish = await listPushAgentCampaigns(prisma, {
          q: "Pascua",
        })

        expect(found.campaigns.map((row) => row.campaignId)).toEqual([
          `${PREFIX}newer`,
          `${PREFIX}older`,
        ])
        expect(found.campaigns[0]).toMatchObject({
          englishTitle: "Pushreads Easter newer",
          languageCount: 2,
        })
        expect(
          bySpanish.campaigns.filter((row) =>
            row.campaignId.startsWith(PREFIX),
          ),
        ).toEqual([])
      })
    })
  },
)
