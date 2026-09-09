import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, it, expect } from "vitest"
import { env } from "@/config/env"
import { StudioAuthoringService } from "./index"
import { executeStudioRender } from "./render-rpc"
import { StudioRenderJobs } from "./render-jobs"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
const url = env.STUDIO_TEST_DATABASE_URL
const human = {
  id: "render-owner",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const worker = { id: null, role: "MANAGER_BACKEND" as const }
class RenderFixtureError extends Error {}
;(url ? describe : describe.skip)("durable render leases", () => {
  let db: PrismaClient
  beforeAll(() => {
    if (
      url !== STUDIO_RENDER_TEST_DATABASE_URL &&
      url !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_test"
    )
      throw new RenderFixtureError("Owned460 database required")
    db = new PrismaClient({ datasources: { db: { url } } })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("atomically retains registered partial output for its exact lease before terminal recording", async () => {
    const { StudioAssetService } = await import("./assets")
    const { STUDIO_RENDER_PROFILE } =
      await import("@forge/studio-contracts/render")
    const commands = new StudioAuthoringService(db),
      jobs = new StudioRenderJobs(db),
      projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Partial retention",
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
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attemptId = attempt.attemptId!
    await jobs.enqueue(worker, attemptId)
    const lease = await jobs.claim(worker, attemptId)
    const asset = await new StudioAssetService(db).register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "partial.mp4",
        mimeType: "video/mp4",
        role: "render",
        provenance: {
          status: "recorded",
          recorded: {
            attemptId,
            leaseId: lease.leaseId,
            profileId: STUDIO_RENDER_PROFILE.id,
          },
        },
      },
      Buffer.from("partial transport fixture"),
    )
    const rows = await db.$queryRaw<
      Array<{ asset_version_id: string }>
    >`SELECT asset_version_id FROM studio_render_retained_asset WHERE attempt_id=${attemptId} AND lease_id=${lease.leaseId}`
    expect(rows.map((row) => row.asset_version_id)).toEqual([
      asset.reference.versionId,
    ])
    // Simulate a lost finish request: the canonical attempt is still running,
    // but asset identity is already durable and recoverable by the exact lease.
    expect(
      (await db.studioAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
        .status,
    ).toBe("RUNNING")
    const provenance = {
      status: "recorded",
      recorded: {
        attemptId,
        leaseId: lease.leaseId,
        profileId: STUDIO_RENDER_PROFILE.id,
      },
    }
    await expect(
      new StudioAssetService(db).register(
        human,
        {
          idempotencyKey: randomUUID(),
          filename: "forged.mp4",
          mimeType: "video/mp4",
          role: "render",
          provenance,
        },
        Buffer.from("forged edge"),
      ),
    ).rejects.toThrow("Trusted render producer")
    await expect(
      new StudioAssetService(db).register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "unknown.mp4",
          mimeType: "video/mp4",
          role: "render",
          provenance: {
            ...provenance,
            recorded: { ...provenance.recorded, leaseId: randomUUID() },
          },
        },
        Buffer.from("unknown lease"),
      ),
    ).rejects.toThrow("Issued render lease")
    // Real lost HTTP response after the canonical registration commits. The
    // caller never receives a reference; restart discovery uses the lease edge.
    const lostServer = createServer(async (_req, res) => {
      await new StudioAssetService(db).register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "lost-response.mp4",
          mimeType: "video/mp4",
          role: "render",
          provenance,
        },
        Buffer.from("registered but response lost"),
      )
      res.destroy()
    })
    await new Promise<void>((done) => lostServer.listen(0, "127.0.0.1", done))
    try {
      const address = lostServer.address()
      if (!address || typeof address === "string")
        throw new RenderFixtureError("Owned test port required")
      await expect(fetch(`http://127.0.0.1:${address.port}`)).rejects.toThrow()
    } finally {
      lostServer.closeAllConnections()
      await new Promise<void>((done) => lostServer.close(() => done()))
    }
    const registered = await new StudioRenderJobs(db).read(worker, attemptId)
    expect(registered.leases[0].retainedAssets).toHaveLength(2)
    expect(registered.executions).toEqual([])
    const next = await jobs.claim(
      worker,
      attemptId,
      1000,
      new Date(Date.now() + STUDIO_RENDER_PROFILE.leaseMs + 1000),
    )
    expect(next.execute).toBe(true)
    const late = await new StudioAssetService(db).register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "late.mp4",
        mimeType: "video/mp4",
        role: "render",
        provenance,
      },
      Buffer.from("late losing output"),
    )
    const recovered = await new StudioRenderJobs(db).read(worker, attemptId)
    expect(
      recovered.leases
        .find((row) => row.leaseId === lease.leaseId)
        ?.retainedAssets.map((row) => row.assetVersionId)
        .sort(),
    ).toEqual(
      [
        ...registered.leases[0].retainedAssets.map((row) => row.assetVersionId),
        late.reference.versionId,
      ].sort(),
    )
    expect(
      recovered.leases.find((row) => row.leaseId === next.leaseId)
        ?.retainedAssets,
    ).toEqual([])
    expect(recovered.executions).toEqual([])
    expect(
      await jobs.finish(worker, {
        attemptId,
        leaseId: lease.leaseId,
        status: "FAILED",
        result: {
          assets: [asset.reference, late.reference],
          costMicros: null,
          diagnostic: "Partial recovery",
        },
      }),
    ).toEqual({ admitted: false })
    expect(
      (await db.studioAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
        .status,
    ).toBe("RUNNING")
  })
  it("only one dispatcher owns an admitted render; expired leases are fenced on restart", async () => {
    const commands = new StudioAuthoringService(db),
      projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Lease proof",
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
    const requested = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const jobs = new StudioRenderJobs(db)
    await jobs.enqueue(worker, requested.attemptId!)
    const claims = await Promise.all([
      jobs.claim(worker, requested.attemptId!, 1000, new Date(10000)),
      jobs.claim(worker, requested.attemptId!, 1000, new Date(10000)),
    ])
    expect(claims.filter((c) => c.execute)).toHaveLength(1)
    const first = claims.find((c) => c.execute)!
    const restarted = new StudioRenderJobs(db)
    const next = await restarted.claim(
      worker,
      requested.attemptId!,
      1000,
      new Date(12000),
    )
    expect(next.execute).toBe(true)
    expect(next.leaseId).not.toBe(first.leaseId)
    expect(
      await restarted.owns(
        worker,
        requested.attemptId!,
        first.leaseId!,
        new Date(12001),
      ),
    ).toBe(false)
    expect(
      await restarted.owns(
        worker,
        requested.attemptId!,
        next.leaseId!,
        new Date(12001),
      ),
    ).toBe(true)
    expect(
      (await restarted.read(worker, requested.attemptId!)).generation,
    ).toBe(2)
  })
  it("retains a superseded execution without allowing its late callback to complete the winning lease", async () => {
    const commands = new StudioAuthoringService(db),
      projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Fenced result",
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
    const requested = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attemptId = requested.attemptId!,
      jobs = new StudioRenderJobs(db)
    await jobs.enqueue(worker, attemptId)
    const old = await jobs.claim(worker, attemptId, 1000, new Date(10000))
    const winner = await jobs.claim(worker, attemptId, 1000, new Date(12000))
    const result = {
      assets: [],
      costMicros: null,
      diagnostic: "retained worker diagnostic",
    }
    const late = await jobs.finish(
      worker,
      { attemptId, leaseId: old.leaseId!, status: "FAILED", result },
      new Date(12001),
    )
    expect(late.admitted).toBe(false)
    expect((await jobs.read(worker, attemptId)).state).toBe("RUNNING")
    expect(
      (await commands.readAttempt(worker, projectId, attemptId)).status,
    ).toBe("RUNNING")
    const accepted = await jobs.finish(
      worker,
      { attemptId, leaseId: winner.leaseId!, status: "FAILED", result },
      new Date(12002),
    )
    expect(accepted.admitted).toBe(true)
    expect(
      (await commands.readAttempt(worker, projectId, attemptId)).status,
    ).toBe("FAILED")
    expect((await jobs.read(worker, attemptId)).state).toBe("COMPLETED")
    expect(
      await jobs.finish(
        worker,
        { attemptId, leaseId: winner.leaseId!, status: "FAILED", result },
        new Date(13000),
      ),
    ).toEqual(accepted)
    expect((await jobs.read(worker, attemptId)).executions).toHaveLength(2)
    await expect(
      jobs.finish(
        worker,
        {
          attemptId,
          leaseId: winner.leaseId!,
          status: "FAILED",
          result: { ...result, diagnostic: "changed" },
        },
        new Date(13000),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
  it("exhausted leases terminally fail the admitted attempt without inventing an execution result", async () => {
    const commands = new StudioAuthoringService(db),
      projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Exhaustion",
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
    const requested = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attemptId = requested.attemptId!,
      jobs = new StudioRenderJobs(db)
    await jobs.enqueue(worker, attemptId)
    for (const time of [10000, 12000, 14000])
      expect(
        (await jobs.claim(worker, attemptId, 1000, new Date(time))).execute,
      ).toBe(true)
    expect(
      (await jobs.claim(worker, attemptId, 1000, new Date(16000))).execute,
    ).toBe(false)
    expect(
      (await commands.readAttempt(worker, projectId, attemptId)).status,
    ).toBe("FAILED")
    expect((await jobs.read(worker, attemptId)).executions).toHaveLength(0)
    expect((await jobs.read(worker, attemptId)).state).toBe("FAILED")
  })
  it("retains a finish that waits across lease expiry without admitting it", async () => {
    const commands = new StudioAuthoringService(db),
      projectId = randomUUID(),
      jobs = new StudioRenderJobs(db)
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Expired waiting finish",
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
    const requested = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attemptId = requested.attemptId!
    await jobs.enqueue(worker, attemptId)
    const lease = await jobs.claim(worker, attemptId, 1000)
    const applicationName = `studio460-expiry-${randomUUID()}`
    const contender = new PrismaClient({
      datasources: {
        db: { url: `${url}?application_name=${applicationName}` },
      },
    })
    let pending: Promise<unknown> | undefined
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM studio_project WHERE id=${projectId} FOR UPDATE`
        pending = new StudioRenderJobs(contender).finish(worker, {
          attemptId,
          leaseId: lease.leaseId!,
          status: "FAILED",
          result: {
            assets: [],
            costMicros: null,
            diagnostic: "late after lock",
          },
        })
        let blocked = false
        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`
          const rows = await tx.$queryRaw<
            { blocked: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%FROM studio_project%') AS blocked`
          if (rows[0]?.blocked) {
            blocked = true
            break
          }
          await new Promise((done) => setTimeout(done, 10))
        }
        expect(blocked).toBe(true)
        await new Promise((done) =>
          setTimeout(done, Math.max(0, lease.expiresAt! - Date.now() + 30)),
        )
      })
      expect(await pending).toEqual({ admitted: false })
      expect((await jobs.read(worker, attemptId)).executions).toHaveLength(1)
      expect((await jobs.read(worker, attemptId)).state).toBe("RUNNING")
      expect(
        (await commands.readAttempt(worker, projectId, attemptId)).status,
      ).toBe("RUNNING")
    } finally {
      await pending?.catch(() => undefined)
      await contender.$disconnect()
    }
  })
  for (const operation of ["claim", "finish"] as const)
    it(`${operation} rechecks terminal attempt after waiting on another connection's project lock`, async () => {
      const commands = new StudioAuthoringService(db),
        projectId = randomUUID()
      await commands.create(human, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Contended terminal state",
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
      const requested = await commands.request(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "RENDER",
        instructions: [],
      })
      const attemptId = requested.attemptId!,
        jobs = new StudioRenderJobs(db)
      await jobs.enqueue(worker, attemptId)
      const initial = await jobs.claim(worker, attemptId, 1000, new Date(10000))
      const applicationName = `studio460-race-${randomUUID()}`
      const contender = new PrismaClient({
        datasources: {
          db: { url: `${url}?application_name=${applicationName}` },
        },
      })
      const waiting = new StudioRenderJobs(contender)
      let pending: Promise<unknown> | undefined
      try {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM studio_project WHERE id=${projectId} FOR UPDATE`
          pending = (
            operation === "claim"
              ? waiting.claim(worker, attemptId, 1000, new Date(12000))
              : waiting.finish(
                  worker,
                  {
                    attemptId,
                    leaseId: initial.leaseId!,
                    status: "FAILED",
                    result: {
                      assets: [],
                      costMicros: null,
                      diagnostic: "late retained diagnostic",
                    },
                  },
                  new Date(10001),
                )
          ).then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
          // Observe the actual lock wait, not a sleep guessing whether the initial
          // attempt read happened. Both observations use the lock holder connection.
          let blocked = false
          const deadline = Date.now() + 2000
          while (Date.now() < deadline) {
            await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`
            const rows = await tx.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%FROM studio_project%') AS blocked`
            if (rows[0]?.blocked) {
              blocked = true
              break
            }
            await new Promise((done) => setTimeout(done, 10))
          }
          expect(blocked).toBe(true)
          // Model an already-authorized terminal writer while it owns the same lock.
          // Leaving the ledger untouched isolates the mutable-attempt read ordering.
          await tx.studioAttempt.update({
            where: { id: attemptId },
            data: {
              status: "CANCELLED",
              completedBy: { kind: "service", id: "system" },
              result: { assets: [], costMicros: null },
            },
          })
        })
        expect(await pending).toEqual({
          value:
            operation === "claim"
              ? { execute: false, leaseId: null }
              : { admitted: false },
        })
        expect(
          (await commands.readAttempt(worker, projectId, attemptId)).status,
        ).toBe("CANCELLED")
        const retained = await jobs.read(worker, attemptId)
        expect(retained.generation).toBe(1)
        expect(retained.state).toBe("RUNNING")
        expect(retained.executions).toHaveLength(operation === "finish" ? 1 : 0)
        if (operation === "finish")
          expect(retained.executions[0]?.result).toMatchObject({
            diagnostic: "late retained diagnostic",
          })
      } finally {
        await pending
        await contender.$disconnect()
      }
    })

  it("restart discovers admission before enqueue and cancellation fences an active lease permanently", async () => {
    const commands = new StudioAuthoringService(db),
      projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Recover admission",
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
    const requested = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attemptId = requested.attemptId!,
      jobs = new StudioRenderJobs(db)
    expect(await jobs.pending(worker)).toContain(attemptId)
    await jobs.enqueue(worker, attemptId)
    const active = await jobs.claim(worker, attemptId)
    expect(await jobs.pending(worker)).not.toContain(attemptId)
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId,
    }
    const cancelled = await jobs.cancel(human, input)
    expect(await jobs.cancel(human, input)).toEqual(cancelled)
    expect(
      (await commands.readAttempt(worker, projectId, attemptId)).status,
    ).toBe("CANCELLED")
    expect((await jobs.read(worker, attemptId)).state).toBe("CANCELLED")
    expect(await jobs.owns(worker, attemptId, active.leaseId!)).toBe(false)
    expect(await jobs.pending(worker)).not.toContain(attemptId)
    expect(
      await jobs.finish(worker, {
        attemptId,
        leaseId: active.leaseId!,
        status: "FAILED",
        result: {
          assets: [],
          costMicros: null,
          diagnostic: "cancelled worker teardown",
        },
      }),
    ).toEqual({ admitted: false })
    expect((await jobs.read(worker, attemptId)).executions).toHaveLength(1)
    expect(
      (await commands.readAttempt(worker, projectId, attemptId)).status,
    ).toBe("CANCELLED")
  })
  it("accepts only the dedicated server render capability and never dispatches review commands", async () => {
    const caller = {
      sub: "shorts-render-worker",
      authority: "delegated" as const,
      clientId: "shorts-render",
      scopes: ["shorts:render:execute"],
    }
    for (const untrusted of [
      { ...caller, authority: "interactive" as const },
      { ...caller, clientId: "shorts-hosted" },
      { ...caller, sub: "render-owner" },
      { ...caller, scopes: ["shorts:author"] },
    ])
      await expect(
        executeStudioRender(db, untrusted, {
          action: "render-worker",
          command: "pending",
          input: null,
        }),
      ).rejects.toThrow("Trusted render execution required")
    expect(
      Array.isArray(
        await executeStudioRender(db, caller, {
          action: "render-worker",
          command: "pending",
          input: null,
        }),
      ),
    ).toBe(true)
    await expect(
      executeStudioRender(db, caller, {
        action: "render-worker",
        command: "approve",
        input: {},
      }),
    ).rejects.toThrow()
    await expect(
      executeStudioRender(db, caller, {
        action: "render-worker",
        command: "publish",
        input: {},
      }),
    ).rejects.toThrow()
  })
})
