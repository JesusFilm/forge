import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioAuthoringService } from "./index"
import { StudioAssetService } from "./assets"
import { publishStudioProject } from "./publication"
import { StudioCommandError } from "./errors"
import type { StudioScheduledPublication } from "./scheduled-publication"

const url = env.STUDIO_TEST_DATABASE_URL
const scheduler = { role: "SYSTEM" as const, id: null }
class PublicationHookHarnessError extends Error {}

;(url ? describe : describe.skip)(
  "internal publication transaction hook",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (
        url !== STUDIO_RENDER_TEST_DATABASE_URL &&
        url !==
          "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_publication_base"
      )
        throw new PublicationHookHarnessError(
          "Dedicated isolated publication database required",
        )
      db = new PrismaClient({ datasources: { db: { url } } })
    })
    afterAll(async () => {
      await db?.$disconnect()
    })

    async function fixture() {
      const projectId = randomUUID()
      const user = {
        id: randomUUID(),
        role: "ADMIN" as const,
        studioAuthority: "interactive" as const,
      }
      const commands = new StudioAuthoringService(db)
      await commands.create(user, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Internal hook fixture",
          language: "en",
          runtimeVersion: "studio-proof-1",
          width: 320,
          height: 180,
          fps: 30,
          durationInFrames: 30,
          tracks: [],
          items: [],
          components: [],
          packRevisionIds: [],
        },
      })
      const requested = await commands.request(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "RENDER",
        instructions: [],
      })
      if (!requested.attemptId)
        throw new PublicationHookHarnessError("Expected render attempt")
      const manifest = await new StudioAssetService(db).register(
        scheduler,
        {
          filename: "hook-fixture.json",
          mimeType: "application/json",
          role: "manifest",
          idempotencyKey: randomUUID(),
          provenance: {
            status: "recorded",
            recorded: { fixture: "internal transaction only" },
          },
        },
        Buffer.from("{}"),
        "LOCAL",
      )
      await commands.complete(scheduler, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId: requested.attemptId,
        status: "SUCCEEDED",
        operations: [],
        result: { assets: [], manifest: manifest.reference, costMicros: 0 },
      })
      const approved = await commands.approve(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "PUBLICATION",
        renderAttemptId: requested.attemptId,
      })
      if (!approved.approvalId)
        throw new PublicationHookHarnessError("Expected approval")
      const input = {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        approvalId: approved.approvalId,
        renderAttemptId: requested.attemptId,
        releaseId: randomUUID(),
        readinessId: randomUUID(),
        schedule: {
          scheduleId: randomUUID(),
          version: 1,
          dueAt: new Date(Date.now() - 1000).toISOString(),
          latestAllowedAt: new Date(Date.now() + 60000).toISOString(),
        },
      }
      return { user, commands, input }
    }

    it("uses the same transaction for consumption and mandatory verification; exact accepted retries skip both after unpublish", async () => {
      const f = await fixture(),
        key = randomUUID()
      let verified = 0,
        consumed = 0
      const delivery: StudioScheduledPublication = {
        input: f.input,
        consume: async (tx, binding, now) => {
          consumed++
          // The outer transaction pins one connection; this independent pool query
          // must fail NOWAIT, proving project lock precedes the calendar callback.
          await expect(
            db.$queryRaw`SELECT id FROM studio_project WHERE id=${binding.projectId} FOR UPDATE NOWAIT`,
          ).rejects.toMatchObject({ meta: { code: "55P03" } })
          expect(binding).toEqual(f.input)
          expect(now.getTime()).toBeGreaterThanOrEqual(
            Date.parse(f.input.schedule.dueAt),
          )
          await tx.studioCommand.create({
            data: {
              projectId: binding.projectId,
              idempotencyKey: key,
              inputHash: "a".repeat(64),
              actor: { kind: "service", id: "system" },
              result: { consumed: true },
            },
          })
        },
      }
      const verify = async () => {
        verified++
      }
      await expect(
        publishStudioProject(db, f.user, f.input, verify, delivery),
      ).rejects.toThrow()
      await expect(
        publishStudioProject(
          db,
          { ...f.user, studioAuthority: "delegated" },
          f.input,
          verify,
          delivery,
        ),
      ).rejects.toThrow()
      await expect(
        publishStudioProject(db, scheduler, f.input, verify),
      ).rejects.toThrow()
      const accepted = await publishStudioProject(
        db,
        scheduler,
        f.input,
        verify,
        delivery,
      )
      expect(accepted).toEqual({
        projectId: f.input.projectId,
        revision: 1,
        outcome: "ACCEPTED",
      })
      await f.commands.unpublish(f.user, {
        projectId: f.input.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      })
      expect(
        await publishStudioProject(db, scheduler, f.input, verify, delivery),
      ).toEqual(accepted)
      expect(consumed).toBe(1)
      expect(verified).toBe(1)
      expect(
        await db.studioCommand.count({
          where: { projectId: f.input.projectId, idempotencyKey: key },
        }),
      ).toBe(1)
      expect(await f.commands.read(f.user, f.input.projectId)).toMatchObject({
        lifecycle: "UNPUBLISHED",
        firstPublishedAt: expect.any(String),
      })
    })

    it("rolls back durable consumption when the final verifier rejects; retains no accepted receipt", async () => {
      const f = await fixture(),
        key = randomUUID()
      const delivery: StudioScheduledPublication = {
        input: f.input,
        consume: async (tx) => {
          await tx.studioCommand.create({
            data: {
              projectId: f.input.projectId,
              idempotencyKey: key,
              inputHash: "a".repeat(64),
              actor: { kind: "service", id: "system" },
              result: { consumed: true },
            },
          })
        },
      }
      await expect(
        publishStudioProject(
          db,
          scheduler,
          f.input,
          async () => {
            throw new StudioCommandError("UNREADY")
          },
          delivery,
        ),
      ).rejects.toMatchObject({ code: "UNREADY" })
      expect(
        await db.studioCommand.count({
          where: {
            projectId: f.input.projectId,
            idempotencyKey: { in: [key, f.input.idempotencyKey] },
          },
        }),
      ).toBe(0)
      expect(await f.commands.read(f.user, f.input.projectId)).toMatchObject({
        lifecycle: "DRAFT",
        firstPublishedAt: null,
      })
    })
    it("fails closed for a missing verifier, mismatched server envelope, or delivery outside the immutable UTC window", async () => {
      const f = await fixture()
      let consumed = 0,
        verified = 0
      const consume: StudioScheduledPublication["consume"] = async () => {
        consumed++
      }
      const verify = async () => {
        verified++
      }
      await expect(
        Reflect.apply(publishStudioProject, null, [
          db,
          scheduler,
          f.input,
          undefined,
          { input: f.input, consume },
        ]),
      ).rejects.toThrow()
      await expect(
        publishStudioProject(
          db,
          scheduler,
          { ...f.input, releaseId: randomUUID() },
          verify,
          { input: f.input, consume },
        ),
      ).rejects.toThrow()
      const future = {
        ...f.input,
        schedule: {
          ...f.input.schedule,
          dueAt: new Date(Date.now() + 60000).toISOString(),
          latestAllowedAt: new Date(Date.now() + 120000).toISOString(),
        },
      }
      await expect(
        publishStudioProject(db, scheduler, future, verify, {
          input: future,
          consume,
        }),
      ).rejects.toMatchObject({ code: "NOT_DUE" })
      const late = {
        ...f.input,
        schedule: {
          ...f.input.schedule,
          dueAt: new Date(Date.now() - 120000).toISOString(),
          latestAllowedAt: new Date(Date.now() - 60000).toISOString(),
        },
      }
      await expect(
        publishStudioProject(db, scheduler, late, verify, {
          input: late,
          consume,
        }),
      ).rejects.toMatchObject({ code: "DELIVERY_EXPIRED" })
      expect(consumed).toBe(0)
      expect(verified).toBe(0)
      expect(await f.commands.read(f.user, f.input.projectId)).toMatchObject({
        lifecycle: "DRAFT",
        firstPublishedAt: null,
      })
    })

    it("validates the full scheduled release and readiness envelope even for an incorrectly typed trusted caller", async () => {
      const f = await fixture()
      const missing = {
        ...f.input,
        releaseId: undefined,
        readinessId: undefined,
      }
      await expect(
        Reflect.apply(publishStudioProject, null, [
          db,
          scheduler,
          missing,
          async () => {},
          { input: missing, consume: async () => {} },
        ]),
      ).rejects.toThrow()
      expect(await f.commands.read(f.user, f.input.projectId)).toMatchObject({
        lifecycle: "DRAFT",
        firstPublishedAt: null,
      })
    })
    it.each(["hook", "verifier"])(
      "rolls back consumption and verifier writes when the %s waits beyond the authorized window",
      async (phase) => {
        const f = await fixture(),
          consumedKey = randomUUID(),
          verifiedKey = randomUUID()
        const input = {
          ...f.input,
          schedule: {
            ...f.input.schedule,
            latestAllowedAt: new Date(Date.now() + 1000).toISOString(),
          },
        }
        const crossDeadline = () =>
          new Promise<void>((resolve) =>
            setTimeout(
              resolve,
              Math.max(
                0,
                Date.parse(input.schedule.latestAllowedAt) - Date.now() + 30,
              ),
            ),
          )
        let consumed = false
        const consume: StudioScheduledPublication["consume"] = async (tx) => {
          consumed = true
          await tx.studioCommand.create({
            data: {
              projectId: input.projectId,
              idempotencyKey: consumedKey,
              inputHash: "a".repeat(64),
              actor: { kind: "service", id: "system" },
              result: { consumed: true },
            },
          })
          if (phase === "hook") await crossDeadline()
        }
        await expect(
          publishStudioProject(
            db,
            scheduler,
            input,
            async (tx) => {
              await tx.studioCommand.create({
                data: {
                  projectId: input.projectId,
                  idempotencyKey: verifiedKey,
                  inputHash: "a".repeat(64),
                  actor: { kind: "service", id: "system" },
                  result: { verified: true },
                },
              })
              if (phase === "verifier") await crossDeadline()
            },
            { input, consume },
          ),
        ).rejects.toMatchObject({ code: "DELIVERY_EXPIRED" })
        expect(consumed).toBe(true)
        expect(
          await db.studioCommand.count({
            where: {
              projectId: input.projectId,
              idempotencyKey: {
                in: [consumedKey, verifiedKey, input.idempotencyKey],
              },
            },
          }),
        ).toBe(0)
        expect(await f.commands.read(f.user, input.projectId)).toMatchObject({
          lifecycle: "DRAFT",
          firstPublishedAt: null,
        })
      },
    )
  },
)
