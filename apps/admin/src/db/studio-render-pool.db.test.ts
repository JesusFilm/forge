import { expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import type { StudioCaller } from "@forge/studio-server"
import { env } from "@/config/env"
import { STUDIO_RENDER_TEST_DATABASE_URL } from "@/services/studio-authoring/database.test-support"
import { executeStudioRender } from "@/services/studio-authoring/render-rpc"
import { StudioAuthoringService } from "@/services/studio-authoring"
import { StudioRenderJobs } from "@/services/studio-authoring/render-jobs"
import { createPrismaClient } from "./client"

it.skipIf(!env.STUDIO_TEST_DATABASE_URL)(
  "canonical ownership and revocation do not wait behind ten occupied main-pool connections",
  async () => {
    if (env.STUDIO_TEST_DATABASE_URL !== STUDIO_RENDER_TEST_DATABASE_URL)
      throw new Error("Owned Studio database required")
    vi.stubEnv("DATABASE_URL", env.STUDIO_TEST_DATABASE_URL)
    const main = createPrismaClient("main")
    const render = createPrismaClient("studio-render")
    let release!: () => void
    let ready!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const occupied = new Promise<void>((resolve) => {
      ready = resolve
    })
    let count = 0
    const holdings = Array.from({ length: 10 }, () =>
      main.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`
          if (++count === 10) ready()
          await held
        },
        { timeout: 10000 },
      ),
    )
    const holdingResults = Promise.all(holdings)
    let blocked: Promise<unknown> | undefined
    try {
      await Promise.race([occupied, holdingResults])
      let mainAnswered = false
      blocked = main.$queryRaw`SELECT 1`.then(() => {
        mainAnswered = true
      })
      const started = performance.now()
      const commands = new StudioAuthoringService(render)
      const jobs = new StudioRenderJobs(render)
      const human = {
        id: randomUUID(),
        role: "ADMIN" as const,
        studioAuthority: "interactive" as const,
      }
      const worker = { id: null, role: "MANAGER_BACKEND" as const }
      const projectId = randomUUID()
      await commands.create(human, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Control pool",
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
      const attemptId = requested.attemptId
      if (!attemptId) throw new Error("Expected render attempt")
      await jobs.enqueue(worker, attemptId)
      const binding = {
        poolId: "pool-isolation",
        workerId: randomUUID(),
        dispatchId: randomUUID(),
      }
      const lease = await jobs.claimAssigned(worker, attemptId, binding)
      expect(lease.execute).toBe(true)
      const caller: StudioCaller = {
        authority: "delegated",
        clientId: "shorts-render",
        sub: "shorts-render-worker",
        scopes: ["shorts:render:execute"],
      }
      const rpc = (command: string, input: unknown) =>
        executeStudioRender(render, caller, {
          action: "render-worker",
          command,
          input,
        })
      const owns = async () => {
        expect(await rpc("assigned", binding)).toMatchObject({
          ...binding,
          attemptId,
          leaseId: lease.leaseId,
        })
        expect(await rpc("context", attemptId)).toMatchObject({
          snapshot: { projectId, revision: 1 },
        })
        return rpc("claim-assigned", { ...binding, attemptId })
      }
      expect(await owns()).toMatchObject({
        execute: true,
        leaseId: lease.leaseId,
      })
      await jobs.cancel(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId,
      })
      expect(await owns()).toMatchObject({
        execute: false,
        leaseId: lease.leaseId,
      })
      expect(mainAnswered).toBe(false)
      expect(performance.now() - started).toBeLessThan(5000)
    } finally {
      release()
      await holdingResults
      await blocked
      await Promise.all([main.$disconnect(), render.$disconnect()])
      vi.unstubAllEnvs()
    }
  },
  15000,
)
