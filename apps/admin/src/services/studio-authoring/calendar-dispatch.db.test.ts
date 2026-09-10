import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest"
import { calendarPublicationFixture } from "./calendar-publication.test-support"
import { StudioCalendarDispatcher } from "./calendar-dispatch"
import { publishPreparedStudioProject } from "./scheduled-publication-adapter"
import { studioScheduledPublicationPreparationSchema } from "@forge/studio-contracts/publication"
vi.mock("@/config/env", async (original) => {
  const { generateKeyPairSync } = await import("node:crypto")
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  return {
    env: {
      ...(await original<typeof import("@/config/env")>()).env,
      STUDIO_ENVIRONMENT: "local",
      STUDIO_PUBLIC_PLAYBACK_ORIGIN: "http://127.0.0.1:3462",
      STUDIO_MUX_SIGNING_KEY: "owned-calendar-fixture",
      STUDIO_MUX_PRIVATE_KEY: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
  }
})
const url = process.env.STUDIO_CALENDAR_TEST_DATABASE_URL
;(url ? describe : describe.skip)(
  "durable calendar publication dispatch",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (
        url !== "postgresql://tataihono@127.0.0.1:55461/forge_studio_461_test"
      )
        throw new Error("Owned calendar database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      })
    })
    afterAll(async () => db?.$disconnect())
    it("does not authorize a guidance-only pack as source-ready publication", async () => {
      await expect(
        calendarPublicationFixture(db, false).then(() => "authorized"),
      ).rejects.toMatchObject({ code: "UNREADY" })
    })
    it("claims once, stores before submission, and recovers an ambiguous accepted receipt after restart/unpublish", async () => {
      const f = await calendarPublicationFixture(db)
      let preparations = 0,
        submissions = 0
      let unblock: () => void = () => {},
        entered: () => void = () => {}
      const waiting = new Promise<void>((r) => (entered = r)),
        hold = new Promise<void>((r) => (unblock = r))
      const services = {
        prepare: async (raw: unknown) => {
          preparations++
          entered()
          await hold
          return {
            ...studioScheduledPublicationPreparationSchema.parse(raw),
            readinessId: f.readiness.id,
          }
        },
        publish: async (
          ...args: Parameters<typeof publishPreparedStudioProject>
        ) => {
          submissions++
          const row = await db.shortScheduleAuthorization.findUniqueOrThrow({
            where: { id: f.authorized.authorizationId },
          })
          expect(row.submission).toEqual(args[2])
          const receipt = await publishPreparedStudioProject(...args)
          if (submissions === 1) throw new Error("Lost committed response")
          return receipt
        },
      }
      const dispatcher = new StudioCalendarDispatcher(db, services),
        first = dispatcher.dispatch(f.authorized.authorizationId)
      await waiting
      expect(
        await dispatcher.dispatch(f.authorized.authorizationId),
      ).toMatchObject({ status: "UNCHANGED" })
      unblock()
      expect(await first).toMatchObject({
        status: "RETRY",
        error: "SUBMISSION_UNKNOWN",
      })
      expect(preparations).toBe(1)
      expect(
        await db.short.findUnique({ where: { id: f.projectId } }),
      ).toMatchObject({ lifecycle: "PUBLISHED" })
      await f.commands.unpublish(f.user, {
        projectId: f.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      })
      await db.shortScheduleDispatch.update({
        where: { authorizationId: f.authorized.authorizationId },
        data: { nextAttemptAt: new Date(0) },
      })
      expect(
        await new StudioCalendarDispatcher(db, services).dispatch(
          f.authorized.authorizationId,
        ),
      ).toMatchObject({ status: "ACCEPTED" })
      expect(preparations).toBe(1)
      expect(submissions).toBe(2)
      expect(
        await db.short.findUnique({ where: { id: f.projectId } }),
      ).toMatchObject({ lifecycle: "UNPUBLISHED" })
    })
    it("leaves cancelled, revoked, edited and expired authorizations unpublished without preparing", async () => {
      for (const change of [
        "cancel",
        "membership",
        "revision",
        "deadline",
      ] as const) {
        const f = await calendarPublicationFixture(db)
        const prepare = vi.fn(),
          publish = vi.fn()
        if (change === "cancel")
          await f.publication.cancel(f.user, {
            calendarId: f.calendarId,
            expectedVersion: f.authorized.binding.version,
            idempotencyKey: randomUUID(),
            authorizationId: f.authorized.authorizationId,
          })
        if (change === "membership")
          await db.managerMembership.update({
            where: { userId: f.user.id },
            data: { revokedAt: new Date() },
          })
        if (change === "revision")
          await f.commands.apply(f.user, {
            projectId: f.projectId,
            expectedRevision: 1,
            idempotencyKey: randomUUID(),
            operations: [
              {
                kind: "set-metadata",
                title: "Still editable after scheduling",
              },
            ],
          })
        if (change === "deadline") {
          vi.useFakeTimers({ toFake: ["Date"] })
          vi.setSystemTime(Date.parse(f.authorized.binding.latestAllowedAt) + 1)
        }
        try {
          expect(
            await new StudioCalendarDispatcher(db, {
              prepare,
              publish,
            }).dispatch(f.authorized.authorizationId),
          ).toMatchObject({ status: "BLOCKED" })
          expect(prepare).not.toHaveBeenCalled()
          expect(publish).not.toHaveBeenCalled()
          expect(
            (
              await db.shortScheduleAuthorization.findUniqueOrThrow({
                where: { id: f.authorized.authorizationId },
              })
            ).consumedAt,
          ).toBeNull()
        } finally {
          vi.useRealTimers()
        }
      }
    })
    it("rejects cancellation during preparation without consuming the authorization", async () => {
      const f = await calendarPublicationFixture(db)
      const result = await new StudioCalendarDispatcher(db, {
        prepare: async (raw) => {
          await f.publication.cancel(f.user, {
            calendarId: f.calendarId,
            expectedVersion: f.authorized.binding.version,
            idempotencyKey: randomUUID(),
            authorizationId: f.authorized.authorizationId,
          })
          return {
            ...studioScheduledPublicationPreparationSchema.parse(raw),
            readinessId: f.readiness.id,
          }
        },
        publish: publishPreparedStudioProject,
      }).dispatch(f.authorized.authorizationId)
      expect(result).toMatchObject({ status: "BLOCKED", error: "CANCELLED" })
      expect(
        await db.shortScheduleAuthorization.findUniqueOrThrow({
          where: { id: f.authorized.authorizationId },
        }),
      ).toMatchObject({ consumedAt: null })
      expect(
        await db.short.findUniqueOrThrow({
          where: { id: f.projectId },
        }),
      ).toMatchObject({ lifecycle: "DRAFT", firstPublishedAt: null })
    })
    it("recovers an expired dispatcher lease and fences the old preparer from publication and ledger writes", async () => {
      const f = await calendarPublicationFixture(db)
      let release: () => void = () => {},
        entered: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const waiting = new Promise<void>((resolve) => (entered = resolve))
      let preparations = 0
      const publish = vi.fn(publishPreparedStudioProject)
      const services = {
        prepare: async (raw: unknown) => {
          preparations++
          if (preparations === 1) {
            entered()
            await held
          }
          return {
            ...studioScheduledPublicationPreparationSchema.parse(raw),
            readinessId: f.readiness.id,
          }
        },
        publish,
      }
      const first = new StudioCalendarDispatcher(db, services).dispatch(
        f.authorized.authorizationId,
      )
      await waiting
      await db.shortScheduleDispatch.update({
        where: { authorizationId: f.authorized.authorizationId },
        data: { leaseExpiresAt: new Date(0) },
      })
      expect(
        await new StudioCalendarDispatcher(db, services).dispatch(
          f.authorized.authorizationId,
        ),
      ).toMatchObject({ status: "ACCEPTED" })
      release()
      expect(await first).toMatchObject({
        status: "BLOCKED",
        error: "STALE_BINDING",
      })
      expect(publish).toHaveBeenCalledTimes(1)
      expect(
        await db.shortScheduleDispatch.findUniqueOrThrow({
          where: { authorizationId: f.authorized.authorizationId },
        }),
      ).toMatchObject({ state: "ACCEPTED", attempts: 2, lastError: null })
    })
  },
)
