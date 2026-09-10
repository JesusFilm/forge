import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { StudioAuthoringService } from "./index"
import { StudioRenderJobs } from "./render-jobs"

const human = {
  id: "assignment-owner",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const worker = { id: null, role: "MANAGER_BACKEND" as const }
const url = env.STUDIO_TEST_DATABASE_URL
class AssignmentFixtureError extends Error {}

;(url ? describe : describe.skip)(
  "immutable outbound render assignment",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (url !== STUDIO_RENDER_TEST_DATABASE_URL)
        throw new AssignmentFixtureError("Owned460 database required")
      db = new PrismaClient({ datasources: { db: { url } } })
    })
    afterAll(async () => {
      await db?.$disconnect()
    })
    async function fixture() {
      const projectId = randomUUID(),
        commands = new StudioAuthoringService(db),
        jobs = new StudioRenderJobs(db)
      await commands.create(human, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Worker assignment",
          language: "english",
          runtimeVersion: STUDIO_RUNTIME_VERSION,
          width: 320,
          height: 180,
          fps: 30,
          durationInFrames: 30,
          tracks: [],
          components: [],
          items: [],
          packRevisionIds: [],
        },
      })
      const request = await commands.request(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "RENDER",
        instructions: [],
      })
      const attemptId = request.attemptId!
      await jobs.enqueue(worker, attemptId)
      return {
        projectId,
        attemptId,
        jobs,
        binding: {
          poolId: randomUUID(),
          workerId: randomUUID(),
          dispatchId: randomUUID(),
        },
      }
    }
    it("replays one immutable lease after a lost response and rejects changed dispatch binding", async () => {
      const { attemptId, jobs, binding } = await fixture()
      const server = createServer(async (_request, response) => {
        await jobs.claimAssigned(worker, attemptId, binding)
        response.destroy()
      })
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
      try {
        const address = server.address()
        if (!address || typeof address === "string")
          throw new AssignmentFixtureError("Owned HTTP port required")
        await expect(
          fetch(`http://127.0.0.1:${address.port}`),
        ).rejects.toThrow()
      } finally {
        server.closeAllConnections()
        await new Promise<void>((done) => server.close(() => done()))
      }
      const committed = (await jobs.read(worker, attemptId)).leases[0]
      const first = await jobs.claimAssigned(worker, attemptId, binding)
      expect(first.leaseId).toBe(committed.leaseId)
      expect(first.execute).toBe(true)
      // Discard the first response: a fresh service instance must find the same committed assignment.
      expect(
        await new StudioRenderJobs(db).claimAssigned(
          worker,
          attemptId,
          binding,
        ),
      ).toEqual(first)
      for (const changed of [
        { workerId: randomUUID() },
        { poolId: randomUUID() },
      ])
        await expect(
          jobs.claimAssigned(worker, attemptId, { ...binding, ...changed }),
        ).rejects.toThrow("CONFLICT")
      const other = await fixture()
      await expect(
        jobs.claimAssigned(worker, other.attemptId, binding),
      ).rejects.toThrow("CONFLICT")
      expect((await jobs.read(worker, attemptId)).leases).toHaveLength(1)
    })
    it("serializes duplicate dispatches and two workers competing for one attempt", async () => {
      const { attemptId, jobs, binding } = await fixture()
      const duplicate = await Promise.all([
        jobs.claimAssigned(worker, attemptId, binding),
        jobs.claimAssigned(worker, attemptId, binding),
      ])
      expect(duplicate[0]).toEqual(duplicate[1])
      const next = await fixture()
      const results = await Promise.all([
        jobs.claimAssigned(worker, next.attemptId, next.binding),
        jobs.claimAssigned(worker, next.attemptId, {
          ...next.binding,
          workerId: randomUUID(),
          dispatchId: randomUUID(),
        }),
      ])
      expect(results.filter((result) => result.execute)).toHaveLength(1)
      expect((await jobs.read(worker, next.attemptId)).leases).toHaveLength(1)
    })
    it("does not assign two live attempts to the same pool worker", async () => {
      const left = await fixture(),
        right = await fixture()
      const results = await Promise.all([
        left.jobs.claimAssigned(worker, left.attemptId, left.binding),
        right.jobs.claimAssigned(worker, right.attemptId, {
          ...left.binding,
          dispatchId: randomUUID(),
        }),
      ])
      expect(results.filter((result) => result.execute)).toHaveLength(1)
    })
    it("finds the original assignment before a broker selects another candidate", async () => {
      const { attemptId, jobs, binding } = await fixture()
      expect(await jobs.assigned(worker, binding)).toBeNull()
      const issued = await jobs.claimAssigned(worker, attemptId, binding)
      expect(
        await new StudioRenderJobs(db).assigned(worker, binding),
      ).toMatchObject({ attemptId, leaseId: issued.leaseId })
      await expect(
        jobs.assigned(worker, { ...binding, workerId: randomUUID() }),
      ).rejects.toThrow("CONFLICT")
      await expect(jobs.assigned(human, binding)).rejects.toThrow(
        "Trusted render worker",
      )
    })
    it("never issues fresh work for an expired or completed dispatch replay", async () => {
      const { attemptId, jobs, binding } = await fixture()
      const first = await jobs.claimAssigned(worker, attemptId, binding, 1000)
      await new Promise((done) => setTimeout(done, 1050))
      expect(
        await jobs.claimAssigned(worker, attemptId, binding),
      ).toMatchObject({ execute: false, leaseId: first.leaseId })
      const replacement = await jobs.claimAssigned(worker, attemptId, {
        ...binding,
        dispatchId: randomUUID(),
      })
      expect(replacement.execute).toBe(true)
      await jobs.finish(worker, {
        attemptId,
        leaseId: replacement.leaseId,
        status: "FAILED",
        result: { assets: [], costMicros: null },
      })
      expect(
        await jobs.claimAssigned(worker, attemptId, binding),
      ).toMatchObject({ execute: false, leaseId: first.leaseId })
      expect((await jobs.read(worker, attemptId)).generation).toBe(2)
    })
    it("stops new assignment and replay execution when production is disabled", async () => {
      const { attemptId, jobs, binding } = await fixture()
      await jobs.claimAssigned(worker, attemptId, binding)
      const next = await fixture()
      vi.stubEnv("STUDIO_PRODUCTION_ENABLED", "false")
      // Configuration is captured when the process starts. Reloading the service
      // models a disabled worker process, rather than mutating live configuration.
      vi.resetModules()
      try {
        const { StudioRenderJobs: DisabledJobs } = await import("./render-jobs")
        const disabled = new DisabledJobs(db)
        await expect(
          disabled.claimAssigned(worker, next.attemptId, next.binding),
        ).rejects.toThrow("PRODUCTION_DISABLED")
        expect(
          await disabled.claimAssigned(worker, attemptId, binding),
        ).toMatchObject({ execute: false, leaseId: expect.any(String) })
        expect((await jobs.read(worker, next.attemptId)).leases).toHaveLength(0)
      } finally {
        vi.unstubAllEnvs()
        vi.resetModules()
      }
    })
    it("rechecks terminalization after the actual project lock wait", async () => {
      const { attemptId, projectId, jobs, binding } = await fixture()
      const applicationName = `studio460-assignment-${randomUUID()}`
      const contender = new PrismaClient({
        datasources: {
          db: { url: `${url}?application_name=${applicationName}` },
        },
      })
      let pending: Promise<unknown> | undefined
      try {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM short WHERE id=${projectId} FOR UPDATE`
          pending = new StudioRenderJobs(contender).claimAssigned(
            worker,
            attemptId,
            binding,
          )
          let blocked = false
          const deadline = Date.now() + 2000
          while (Date.now() < deadline) {
            await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`
            const rows = await tx.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%FROM short%') AS blocked`
            if (rows[0]?.blocked) {
              blocked = true
              break
            }
            await new Promise((done) => setTimeout(done, 10))
          }
          expect(blocked).toBe(true)
          await tx.shortAttempt.update({
            where: { id: attemptId },
            data: {
              status: "CANCELLED",
              completedBy: { kind: "service", id: "system" },
              result: { assets: [], costMicros: null },
            },
          })
        })
        expect(await pending).toEqual({ execute: false, leaseId: null })
        expect((await jobs.read(worker, attemptId)).leases).toHaveLength(0)
      } finally {
        await pending?.catch(() => undefined)
        await contender.$disconnect()
      }
    })
  },
)
