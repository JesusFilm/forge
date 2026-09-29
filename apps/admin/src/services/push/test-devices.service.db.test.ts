/**
 * Real-Postgres proof of the test-device list. The mocked suite beside this one
 * pins the Prisma arguments; only a real database proves the relation filter
 * the test-send audience reads and the unique constraint the duplicate
 * refusal leans on.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/test-devices.service.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { PushDuplicateTestDeviceError } from "./errors"
import {
  addPushTestDevice,
  listPushTestDevices,
  readPushTestDeviceRegistrations,
  removePushTestDevice,
} from "./test-devices.service"

const databaseUrl = process.env.DATABASE_URL
// Sibling database suites run in parallel, so every read is scoped to the ids
// this file created.
const PREFIX = "push_devices_db_"
const mine = { id: { startsWith: PREFIX } }
const LISTED_ID = "pushdevicesdblisted"
const RETIRED_ID = "pushdevicesdbretired"

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push test devices against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await prisma.pushTestDevice.deleteMany({
        where: { registration: mine },
      })
      await prisma.pushRegistration.deleteMany({ where: mine })
      await prisma.pushRegistration.createMany({
        data: [
          {
            id: `${PREFIX}reg_listed`,
            expoPushToken: `${PREFIX}token_listed`,
            testDeviceId: LISTED_ID,
            platform: "IOS" as const,
            appBuild: "1.0.0",
            appLanguageSlug: "english",
            phoneLocale: "en-NZ",
            timeZone: "Pacific/Auckland",
            countrySource: "EDGE" as const,
          },
          {
            id: `${PREFIX}reg_retired`,
            expoPushToken: `${PREFIX}token_retired`,
            testDeviceId: RETIRED_ID,
            platform: "ANDROID" as const,
            appBuild: "1.0.0",
            appLanguageSlug: "english",
            phoneLocale: "en-NZ",
            timeZone: "Pacific/Auckland",
            countrySource: "EDGE" as const,
            status: "INACTIVE" as const,
          },
        ],
      })
    })

    afterAll(async () => {
      await prisma.pushTestDevice.deleteMany({ where: { registration: mine } })
      await prisma.pushRegistration.deleteMany({ where: mine })
      await prisma.$disconnect()
    })

    it("adds, lists, and removes a labelled test phone", async () => {
      const added = await addPushTestDevice(prisma, {
        testDeviceId: LISTED_ID,
        label: "Urim iPhone",
        actorId: `${PREFIX}actor`,
      })

      const listed = await listPushTestDevices(prisma)
      expect(
        listed.filter((row) => row.registrationId.startsWith(PREFIX)),
      ).toEqual([
        {
          id: added.id,
          label: "Urim iPhone",
          testDeviceId: LISTED_ID,
          registrationId: `${PREFIX}reg_listed`,
          platform: "IOS",
          active: true,
          createdAt: expect.any(Date),
          createdById: `${PREFIX}actor`,
        },
      ])
      expect(await removePushTestDevice(prisma, added.id)).toBe(true)
      expect(await removePushTestDevice(prisma, added.id)).toBe(false)
    })

    it("refuses a second listing of the same phone, naming the first label", async () => {
      await addPushTestDevice(prisma, {
        testDeviceId: LISTED_ID,
        label: "Urim iPhone",
        actorId: `${PREFIX}actor`,
      })

      const error = await addPushTestDevice(prisma, {
        testDeviceId: LISTED_ID,
        label: "Second try",
        actorId: `${PREFIX}actor`,
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(PushDuplicateTestDeviceError)
      expect((error as PushDuplicateTestDeviceError).existingLabel).toBe(
        "Urim iPhone",
      )
    })

    it("reads only listed and active phones as the test-send audience", async () => {
      await addPushTestDevice(prisma, {
        testDeviceId: LISTED_ID,
        label: "Urim iPhone",
        actorId: `${PREFIX}actor`,
      })
      await addPushTestDevice(prisma, {
        testDeviceId: RETIRED_ID,
        label: "Retired Pixel",
        actorId: `${PREFIX}actor`,
      })

      const phones = await readPushTestDeviceRegistrations(prisma)

      expect(
        phones.filter((phone) => phone.id.startsWith(PREFIX)).map((p) => p.id),
      ).toEqual([`${PREFIX}reg_listed`])
    })
  },
)
