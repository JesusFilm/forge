/**
 * Real-Postgres proof of KTD4's registration rules: the token is the identity
 * of the row, one install's newer token supersedes that install's older one on
 * the same platform, and an invalid token is terminal.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests, and a client
 * constructed there with no URL throws at collection time.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/registration.service.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { PushInputError, PushInvalidTokenStatusError } from "./errors"
import {
  registerPushDevice,
  resetPushLanguageCache,
} from "./registration.service"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_reg_db_"
// A private-use tag no other suite writes, so the derivation is this file's.
const TAG = "qab"
const SLUG = `${PREFIX}language`
const INSTALL = `${PREFIX}install-one`
const OTHER_INSTALL = `${PREFIX}install-two`

function request(overrides: Record<string, unknown> = {}) {
  const { input, ...rest } = overrides as { input?: Record<string, unknown> }
  return {
    input: {
      expoPushToken: `ExponentPushToken[${PREFIX}one]`,
      platform: "IOS",
      appBuild: "1.0.0",
      appLanguageSlug: "english",
      phoneLocale: `${TAG}-NZ`,
      timeZone: "Pacific/Auckland",
      permission: "granted",
      installId: INSTALL,
      ...input,
    },
    edgeCountry: "NZ",
    viewerDigest: null,
    ...rest,
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push registration against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      resetPushLanguageCache()
      await prisma.language.create({
        data: {
          id: `${PREFIX}lang`,
          coreId: `${PREFIX}core`,
          bcp47: TAG,
          slug: SLUG,
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    it("stores a first registration with the derived phone language", async () => {
      const receipt = await registerPushDevice(prisma, request())
      expect(receipt.status).toBe("ACTIVE")

      const row = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(row.phoneLanguageSlug).toBe(SLUG)
      expect(row.country).toBe("NZ")
      expect(row.countrySource).toBe("EDGE")
      expect(row.testDeviceId).toBe(receipt.testDeviceId)
    })

    it("upserts by token and refreshes the row", async () => {
      const first = await registerPushDevice(prisma, request())
      const before = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })

      const second = await registerPushDevice(
        prisma,
        request({ input: { timeZone: "Asia/Riyadh", appBuild: "1.1.0" } }),
      )
      expect(second.testDeviceId).toBe(first.testDeviceId)

      const after = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(after.id).toBe(before.id)
      expect(after.timeZone).toBe("Asia/Riyadh")
      expect(after.appBuild).toBe("1.1.0")
      expect(after.refreshedAt.getTime()).toBeGreaterThanOrEqual(
        before.refreshedAt.getTime(),
      )
      expect(
        await prisma.pushRegistration.count({
          where: {
            expoPushToken: { startsWith: `ExponentPushToken[${PREFIX}` },
          },
        }),
      ).toBe(1)
    })

    it("supersedes the install's older token on the same platform", async () => {
      const digest = "1".repeat(64)
      await registerPushDevice(
        prisma,
        request({ viewerDigest: digest, input: { installId: INSTALL } }),
      )
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: digest,
          input: {
            expoPushToken: `ExponentPushToken[${PREFIX}two]`,
            installId: INSTALL,
          },
        }),
      )

      expect(await statusesByToken(prisma)).toEqual([
        {
          expoPushToken: `ExponentPushToken[${PREFIX}one]`,
          status: "SUPERSEDED",
        },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("keeps both of one viewer's installs active", async () => {
      const digest = "3".repeat(64)
      await registerPushDevice(
        prisma,
        request({ viewerDigest: digest, input: { installId: INSTALL } }),
      )
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: digest,
          input: {
            expoPushToken: `ExponentPushToken[${PREFIX}two]`,
            installId: OTHER_INSTALL,
          },
        }),
      )

      expect(await statusesByToken(prisma)).toEqual([
        { expoPushToken: `ExponentPushToken[${PREFIX}one]`, status: "ACTIVE" },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("refuses a registration with no install id and writes no row", async () => {
      const noInstallId = request()
      delete (noInstallId.input as Record<string, unknown>).installId
      await expect(
        registerPushDevice(prisma, noInstallId),
      ).rejects.toThrowError(PushInputError)
      expect(
        await prisma.pushRegistration.count({
          where: {
            expoPushToken: { startsWith: `ExponentPushToken[${PREFIX}` },
          },
        }),
      ).toBe(0)
    })

    it("leaves another identity's row on the same install active", async () => {
      await registerPushDevice(
        prisma,
        request({ viewerDigest: "6".repeat(64) }),
      )
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: "7".repeat(64),
          input: { expoPushToken: `ExponentPushToken[${PREFIX}two]` },
        }),
      )

      // A restored or copied install id must not let one identity retire
      // another identity's row.
      expect(await statusesByToken(prisma)).toEqual([
        { expoPushToken: `ExponentPushToken[${PREFIX}one]`, status: "ACTIVE" },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("retires an anonymous row on its install", async () => {
      await registerPushDevice(prisma, request())
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: "8".repeat(64),
          input: { expoPushToken: `ExponentPushToken[${PREFIX}two]` },
        }),
      )

      expect(await statusesByToken(prisma)).toEqual([
        {
          expoPushToken: `ExponentPushToken[${PREFIX}one]`,
          status: "SUPERSEDED",
        },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("lets an anonymous request retire an identified row on its install", async () => {
      await registerPushDevice(
        prisma,
        request({ viewerDigest: "9".repeat(64) }),
      )
      await registerPushDevice(
        prisma,
        request({
          input: { expoPushToken: `ExponentPushToken[${PREFIX}two]` },
        }),
      )

      // The documented residual: a request with no handle has no evidence of a
      // conflict, so it retires every candidate row of its install.
      expect(await statusesByToken(prisma)).toEqual([
        {
          expoPushToken: `ExponentPushToken[${PREFIX}one]`,
          status: "SUPERSEDED",
        },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("leaves the other platform's row active", async () => {
      const digest = "2".repeat(64)
      await registerPushDevice(
        prisma,
        request({ viewerDigest: digest, input: { installId: INSTALL } }),
      )
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: digest,
          input: {
            expoPushToken: `ExponentPushToken[${PREFIX}two]`,
            installId: INSTALL,
            platform: "ANDROID",
          },
        }),
      )

      expect(await statusesByToken(prisma)).toEqual([
        { expoPushToken: `ExponentPushToken[${PREFIX}one]`, status: "ACTIVE" },
        { expoPushToken: `ExponentPushToken[${PREFIX}two]`, status: "ACTIVE" },
      ])
    })

    it("brings a superseded token back when its install grants again", async () => {
      const digest = "5".repeat(64)
      await registerPushDevice(
        prisma,
        request({ viewerDigest: digest, input: { installId: INSTALL } }),
      )
      await registerPushDevice(
        prisma,
        request({
          viewerDigest: digest,
          input: {
            expoPushToken: `ExponentPushToken[${PREFIX}two]`,
            installId: INSTALL,
          },
        }),
      )

      const receipt = await registerPushDevice(
        prisma,
        request({ viewerDigest: digest, input: { installId: INSTALL } }),
      )
      expect(receipt.status).toBe("ACTIVE")

      expect(await statusesByToken(prisma)).toEqual([
        { expoPushToken: `ExponentPushToken[${PREFIX}one]`, status: "ACTIVE" },
        {
          expoPushToken: `ExponentPushToken[${PREFIX}two]`,
          status: "SUPERSEDED",
        },
      ])
    })

    it("stores the install id the app sent on every call", async () => {
      await registerPushDevice(prisma, request())
      await registerPushDevice(
        prisma,
        request({ input: { installId: OTHER_INSTALL } }),
      )

      const row = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(row.installId).toBe(OTHER_INSTALL)
    })

    it("refuses a token the provider retired", async () => {
      await registerPushDevice(prisma, request())
      await prisma.pushRegistration.update({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
        data: { status: "INVALID", statusChangedAt: new Date() },
      })

      await expect(registerPushDevice(prisma, request())).rejects.toThrowError(
        PushInvalidTokenStatusError,
      )
      const row = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(row.status).toBe("INVALID")
    })

    it("takes a revoked phone out of the audience and lets a grant bring it back", async () => {
      await registerPushDevice(prisma, request())
      await registerPushDevice(
        prisma,
        request({ input: { permission: "denied" } }),
      )
      const revoked = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(revoked.status).toBe("INACTIVE")

      await registerPushDevice(prisma, request())
      const restored = await prisma.pushRegistration.findUniqueOrThrow({
        where: { expoPushToken: `ExponentPushToken[${PREFIX}one]` },
      })
      expect(restored.status).toBe("ACTIVE")
      expect(restored.statusChangedAt.getTime()).toBeGreaterThan(
        revoked.statusChangedAt.getTime() - 1,
      )
    })

    it("mints a test ID the test-device list can hold", async () => {
      const first = await registerPushDevice(prisma, request())
      const second = await registerPushDevice(
        prisma,
        request({
          input: {
            expoPushToken: `ExponentPushToken[${PREFIX}two]`,
            installId: OTHER_INSTALL,
          },
        }),
      )
      expect(first.testDeviceId).not.toBe(second.testDeviceId)
      expect(
        await prisma.pushRegistration.findUnique({
          where: { testDeviceId: first.testDeviceId },
        }),
      ).not.toBeNull()
    })
  },
)

/**
 * Every row this file writes, by token. Reading by digest instead crosses the
 * suite boundary: `open-report.service.db.test.ts` stores the same digest, and
 * the two suites share one database.
 */
async function statusesByToken(
  prisma: PrismaClient,
): Promise<{ expoPushToken: string; status: string }[]> {
  return prisma.pushRegistration.findMany({
    where: { expoPushToken: { startsWith: `ExponentPushToken[${PREFIX}` } },
    orderBy: { expoPushToken: "asc" },
    select: { expoPushToken: true, status: true },
  })
}

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushRegistration.deleteMany({
    where: { expoPushToken: { startsWith: `ExponentPushToken[${PREFIX}` } },
  })
  await prisma.language.deleteMany({ where: { id: { startsWith: PREFIX } } })
}
