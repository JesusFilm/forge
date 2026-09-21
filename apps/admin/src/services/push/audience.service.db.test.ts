/**
 * Real-Postgres proof of the audience filter. The mocked suite beside this one
 * pins the Prisma arguments; only a real database proves the rows those
 * arguments actually return, and that a page limit really bounds the read.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/audience.service.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  countPushAudience,
  readPushAudiencePage,
  type PushAudienceCampaign,
} from "./audience.service"

const databaseUrl = process.env.DATABASE_URL
// Sibling database suites run in parallel, so every read is scoped to the ids
// this file created.
const PREFIX = "push_audience_db_"
const mine = { id: { startsWith: PREFIX } }

// Every read here is scoped to two zones no sibling suite writes, because the
// audience is global by design: a sibling's row would otherwise join it.
const ZONE = "Pacific/Chatham"
const OTHER_ZONE = "Indian/Maldives"
const MY_ZONES = [ZONE, OTHER_ZONE]

const EVERYWHERE: PushAudienceCampaign = {
  audienceScope: "EVERYWHERE",
  countries: [],
  languageFilter: [],
}

const SAUDI_ARABIC: PushAudienceCampaign = {
  audienceScope: "COUNTRIES",
  countries: ["SA"],
  languageFilter: ["arabic"],
}

type Phone = {
  suffix: string
  platform: "IOS" | "ANDROID"
  country: string | null
  appLanguageSlug: string
  phoneLanguageSlug: string | null
  timeZone?: string
  status?: "ACTIVE" | "INACTIVE"
}

function row(phone: Phone) {
  return {
    id: `${PREFIX}reg_${phone.suffix}`,
    expoPushToken: `${PREFIX}token_${phone.suffix}`,
    testDeviceId: `${PREFIX}device${phone.suffix}`,
    platform: phone.platform,
    appBuild: "1.0.0",
    appLanguageSlug: phone.appLanguageSlug,
    phoneLocale: "en-NZ",
    phoneLanguageSlug: phone.phoneLanguageSlug,
    timeZone: phone.timeZone ?? ZONE,
    country: phone.country,
    countrySource: "EDGE" as const,
    status: phone.status ?? ("ACTIVE" as const),
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push audience against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await prisma.pushRegistration.deleteMany({ where: mine })
    })

    afterAll(async () => {
      await prisma.pushRegistration.deleteMany({ where: mine })
      await prisma.$disconnect()
    })

    it("keeps a declared-language phone and drops an English one (AE7)", async () => {
      await prisma.pushRegistration.createMany({
        data: [
          row({
            suffix: "1_app_arabic",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "arabic",
            phoneLanguageSlug: "english",
          }),
          row({
            suffix: "2_phone_arabic",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "arabic",
          }),
          row({
            suffix: "3_both_english",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
          }),
          row({
            suffix: "4_arabic_elsewhere",
            platform: "IOS",
            country: "NZ",
            appLanguageSlug: "arabic",
            phoneLanguageSlug: "arabic",
          }),
        ],
      })

      const page = await readPushAudiencePage(prisma, {
        campaign: SAUDI_ARABIC,
        timeZones: MY_ZONES,
      })

      expect(page.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_1_app_arabic`,
        `${PREFIX}reg_2_phone_arabic`,
      ])
    })

    it("drops a phone that is no longer active", async () => {
      await prisma.pushRegistration.createMany({
        data: [
          row({
            suffix: "1_active",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
          }),
          row({
            suffix: "2_inactive",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
            status: "INACTIVE",
          }),
        ],
      })

      const page = await readPushAudiencePage(prisma, {
        campaign: EVERYWHERE,
        timeZones: MY_ZONES,
      })

      expect(page.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_1_active`,
      ])
    })

    it("stops at the page limit and walks the rest with the cursor", async () => {
      await prisma.pushRegistration.createMany({
        data: ["1", "2", "3"].map((suffix) =>
          row({
            suffix,
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
          }),
        ),
      })

      const first = await readPushAudiencePage(prisma, {
        campaign: EVERYWHERE,
        timeZones: MY_ZONES,
        limit: 2,
      })
      const second = await readPushAudiencePage(prisma, {
        campaign: EVERYWHERE,
        timeZones: MY_ZONES,
        limit: 2,
        cursor: first.nextCursor,
      })

      expect(first.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_1`,
        `${PREFIX}reg_2`,
      ])
      expect(first.nextCursor).toBe(`${PREFIX}reg_2`)
      expect(second.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_3`,
      ])
      expect(second.nextCursor).toBeNull()
    })

    it("reads a zone group only", async () => {
      await prisma.pushRegistration.createMany({
        data: [
          row({
            suffix: "1_first_zone",
            platform: "IOS",
            country: "SA",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
            timeZone: ZONE,
          }),
          row({
            suffix: "2_second_zone",
            platform: "IOS",
            country: "NZ",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
            timeZone: OTHER_ZONE,
          }),
        ],
      })

      const page = await readPushAudiencePage(prisma, {
        campaign: EVERYWHERE,
        timeZones: [OTHER_ZONE],
      })

      expect(page.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_2_second_zone`,
      ])
    })

    it("counts the audience apart from the unreachable phones (AE17)", async () => {
      await prisma.pushRegistration.createMany({
        data: [
          row({
            suffix: "1_android_cn",
            platform: "ANDROID",
            country: "CN",
            appLanguageSlug: "chinese-simplified",
            phoneLanguageSlug: "chinese-simplified",
          }),
          row({
            suffix: "2_ios_cn",
            platform: "IOS",
            country: "CN",
            appLanguageSlug: "chinese-simplified",
            phoneLanguageSlug: "chinese-simplified",
          }),
        ],
      })
      const campaign: PushAudienceCampaign = {
        audienceScope: "COUNTRIES",
        countries: ["CN"],
        languageFilter: [],
      }

      const page = await readPushAudiencePage(prisma, {
        campaign,
        timeZones: MY_ZONES,
      })
      const counts = await countPushAudience(prisma, {
        campaign,
        timeZones: MY_ZONES,
      })

      expect(page.audience.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_2_ios_cn`,
      ])
      expect(page.unreachable.map((phone) => phone.id)).toEqual([
        `${PREFIX}reg_1_android_cn`,
      ])
      expect(counts).toEqual({ audience: 1, unreachable: 1 })
    })

    it("counts no unreachable phone in a country the campaign never named", async () => {
      await prisma.pushRegistration.createMany({
        data: [
          row({
            suffix: "1_ios_us",
            platform: "IOS",
            country: "US",
            appLanguageSlug: "english",
            phoneLanguageSlug: "english",
          }),
          row({
            suffix: "2_android_cn",
            platform: "ANDROID",
            country: "CN",
            appLanguageSlug: "chinese-simplified",
            phoneLanguageSlug: "chinese-simplified",
          }),
        ],
      })
      const unitedStates: PushAudienceCampaign = {
        audienceScope: "COUNTRIES",
        countries: ["US"],
        languageFilter: [],
      }

      const scoped = await countPushAudience(prisma, {
        campaign: unitedStates,
        timeZones: MY_ZONES,
      })
      const everywhere = await countPushAudience(prisma, {
        campaign: EVERYWHERE,
        timeZones: MY_ZONES,
      })

      expect(scoped).toEqual({ audience: 1, unreachable: 0 })
      expect(everywhere).toEqual({ audience: 1, unreachable: 1 })
    })
  },
)
