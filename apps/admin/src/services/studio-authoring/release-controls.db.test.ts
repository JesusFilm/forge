import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { StudioTransferService } from "./transfers"
import { StudioAssetService } from "./assets"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { calendarPublicationFixture } from "./calendar-publication.test-support"
import { studioScheduledPublicationPreparationSchema } from "@forge/studio-contracts/publication"
import { StudioCalendarDispatcher } from "./calendar-dispatch"
import { publishPreparedStudioProject } from "./scheduled-publication-adapter"
import { reconcileStudioWatch } from "./watch-delivery"
import { stagedStudioReleaseSchema } from "./catalog-readiness"
import { StudioRenderJobs } from "./render-jobs"
import { StudioMuxJobs } from "./mux-jobs"
import { StudioExecutionService } from "./execution"
import { StudioExperimentService } from "./experiments"
import { executeStudioProduction } from "./production-rpc"
import { StudioCatalogPublicationService } from "./catalog-publication"

const controls = vi.hoisted(() => ({ production: "true", publication: "true" }))
vi.mock("@/config/env", async (original) => {
  const { generateKeyPairSync } = await import("node:crypto")
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  return {
    env: {
      ...(await original<typeof import("@/config/env")>()).env,
      get STUDIO_PRODUCTION_ENABLED() {
        return controls.production
      },
      get STUDIO_PUBLICATION_ENABLED() {
        return controls.publication
      },
      STUDIO_ENVIRONMENT: "local",
      STUDIO_PUBLIC_PLAYBACK_ORIGIN: "http://127.0.0.1:55469",
      STUDIO_MUX_SIGNING_KEY: "owned-release-fixture",
      STUDIO_MUX_PRIVATE_KEY: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
  }
})
const url = process.env.STUDIO_TEST_DATABASE_URL
;(url ? describe : describe.skip)("Studio release admission controls", () => {
  let db: PrismaClient
  beforeAll(() => {
    if (url !== "postgresql://tataihono@127.0.0.1:55462/forge_studio_462_test")
      throw new Error("Owned release database required")
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  })
  afterEach(() => {
    vi.useRealTimers()
    controls.production = "true"
    controls.publication = "true"
  })
  afterAll(async () => db?.$disconnect())
  it("denies a new canonical manual publication while retaining the editable draft", async () => {
    const f = await calendarPublicationFixture(db)
    controls.publication = "false"
    await expect(
      new StudioCatalogPublicationService(db).publish(f.user, {
        projectId: f.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        approvalId: f.authorization.approvalId,
        renderAttemptId: f.authorization.renderAttemptId,
        releaseId: f.authorization.releaseId,
        readinessId: f.readiness.id,
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_DISABLED" })
    expect(await f.commands.read(f.user, f.projectId)).toMatchObject({
      lifecycle: "DRAFT",
    })
  })
  it("holds a stored scheduled envelope while disabled and preserves accepted retry after unpublish", async () => {
    const f = await calendarPublicationFixture(db)
    const prepare = vi.fn(async (raw: unknown) => ({
      ...studioScheduledPublicationPreparationSchema.parse(raw),
      readinessId: f.readiness.id,
    }))
    const dispatcher = new StudioCalendarDispatcher(db, {
      prepare,
      publish: async (
        ...args: Parameters<typeof publishPreparedStudioProject>
      ) => {
        controls.publication = "false"
        return publishPreparedStudioProject(...args)
      },
    })
    expect(
      await dispatcher.dispatch(f.authorized.authorizationId),
    ).toMatchObject({ status: "RETRY", error: "PUBLICATION_DISABLED" })
    const row = await db.studioScheduleAuthorization.findUniqueOrThrow({
      where: { id: f.authorized.authorizationId },
    })
    expect(row.submission).not.toBeNull()
    expect(row.consumedAt).toBeNull()
    await expect(
      publishPreparedStudioProject(
        db,
        f.worker,
        row.submission,
        f.publication.consume,
      ),
    ).rejects.toMatchObject({ code: "PUBLICATION_DISABLED" })
    expect(await f.commands.read(f.user, f.projectId)).toMatchObject({
      lifecycle: "DRAFT",
    })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(row.latestAllowedAt.getTime() + 1)
    await expect(
      publishPreparedStudioProject(
        db,
        f.worker,
        row.submission,
        f.publication.consume,
      ),
    ).rejects.toMatchObject({ code: "DELIVERY_EXPIRED" })
    vi.useRealTimers()
    controls.publication = "true"
    const accepted = await publishPreparedStudioProject(
      db,
      f.worker,
      row.submission,
      f.publication.consume,
    )
    controls.publication = "false"
    controls.production = "false"
    await f.commands.unpublish(f.user, {
      projectId: f.projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    })
    const consume = vi.fn(f.publication.consume)
    expect(
      await publishPreparedStudioProject(db, f.worker, row.submission, consume),
    ).toEqual(accepted)
    expect(consume).not.toHaveBeenCalled()
    const original = z.record(z.string(), z.unknown()).parse(row.submission)
    await expect(
      publishPreparedStudioProject(
        db,
        f.worker,
        { ...original, readinessId: randomUUID() },
        consume,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(await f.commands.read(f.user, f.projectId)).toMatchObject({
      lifecycle: "UNPUBLISHED",
    })
    const emit = vi.fn(async () => ({
      status: "sent" as const,
      httpStatus: 200,
    }))
    await reconcileStudioWatch(db, emit)
    expect(
      await db.studioWatchDelivery.findUnique({
        where: {
          releaseId_phase: {
            releaseId: f.authorization.releaseId,
            phase: "revoked",
          },
        },
      }),
    ).not.toBeNull()
  })

  it("blocks new paid dispatch without consuming budget and settles already consumed outcomes", async () => {
    const f = await calendarPublicationFixture(db)
    const experiments = new StudioExperimentService(db),
      execution = new StudioExecutionService(db)
    const request = {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "elevenlabs",
      model: "music_v1",
      language: "en",
      prompt: "Owned dispatch fixture",
      settings: { lengthMs: 10000 },
      candidateCount: 1,
      estimate: {
        currency: "USD",
        amountMicros: 100,
        basis: "Local test only",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 100,
      confirmed: true,
    }
    const experiment = await experiments.request(f.user, request)
    const run = await execution.admit(f.user, {
      experimentId: experiment.id,
      maxCostMicros: 100,
    })
    const caller = {
      sub: f.user.id,
      authority: "delegated" as const,
      clientId: "shorts-production",
      scopes: ["shorts:production:execute"],
    }
    const claim = {
      runId: run.id,
      key: "already-consumed",
      inputDigest: "a".repeat(64),
      reserveMicros: 40,
    }
    expect(await execution.claim(f.worker, claim)).toMatchObject({
      execute: true,
    })
    controls.production = "false"
    const provider = vi.fn()
    const dispatch = async () => {
      const admitted = await execution.claim(f.worker, {
        ...claim,
        key: "not-dispatched",
        reserveMicros: 0,
      })
      if (admitted.execute) provider()
    }
    await expect(dispatch()).rejects.toMatchObject({
      code: "PRODUCTION_DISABLED",
    })
    expect(provider).not.toHaveBeenCalled()
    expect((await execution.read(f.user, run.id)).calls).toHaveLength(1)
    expect(await execution.claim(f.worker, claim)).toMatchObject({
      execute: false,
      call: { state: "RUNNING" },
    })
    const bytes = Buffer.from("Owned late provider-result fixture")
    const grant = z.object({ path: z.string() }).parse(
      await executeStudioProduction(db, caller, {
        action: "production",
        runId: run.id,
        command: "upload",
        input: {
          metadata: {
            idempotencyKey: randomUUID(),
            filename: "late.txt",
            mimeType: "text/plain",
            role: "document",
            provenance: {
              status: "recorded",
              recorded: { fixture: "late result only" },
            },
          },
          byteSize: bytes.length,
          digest: createHash("sha256").update(bytes).digest("hex"),
        },
      }),
    )
    const retained = await new StudioTransferService(db).upload(
      grant.path.split("/").at(-1)!,
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
    )
    expect(
      await new StudioAssetService(db).readBytes(f.user, retained.reference),
    ).toEqual(bytes)
    await executeStudioProduction(db, caller, {
      action: "production",
      runId: run.id,
      command: "finish",
      input: {
        key: claim.key,
        state: "COMPLETED",
        result: {
          assets: [retained.reference],
          actualCostMicros: 40,
          credits: null,
          requestId: "owned-completion",
          elapsedMs: 5,
        },
      },
    })
    expect(await execution.claim(f.worker, claim)).toMatchObject({
      execute: false,
      call: { state: "COMPLETED" },
    })
    expect(
      await execution.admit(f.user, {
        experimentId: experiment.id,
        maxCostMicros: 100,
      }),
    ).toMatchObject({ id: run.id })
    await expect(
      experiments.request(f.user, { ...request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DISABLED" })
    expect(await experiments.request(f.user, request)).toMatchObject({
      id: experiment.id,
    })
    expect(await execution.cancel(f.user, run.id)).toMatchObject({
      state: "CANCELLED",
    })
  })

  it("pauses queued render and Mux claims without spending their identities or retry budget", async () => {
    const f = await calendarPublicationFixture(db)
    const jobs = new StudioRenderJobs(db),
      mux = new StudioMuxJobs(db)
    const request = {
      projectId: f.projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    }
    const attempt = await f.commands.request(f.user, request)
    await jobs.enqueue(f.worker, attempt.attemptId!)
    // A persisted queued intent, using the same synthetic retained manifest as the transaction fixture.
    const release = await db.studioCatalogRelease.findUniqueOrThrow({
      where: { id: f.authorization.releaseId },
    })
    const snapshot = stagedStudioReleaseSchema.parse(release.snapshot)
    const pending = await db.studioMuxJob.create({
      data: {
        attemptId: f.authorization.renderAttemptId,
        snapshot: {
          manifest: snapshot.manifest,
          codecProof: f.readiness.proof.codecProof,
          leaseId: f.readiness.leaseId,
        },
      },
    })
    controls.production = "false"
    await expect(
      jobs.claim(f.worker, attempt.attemptId!),
    ).rejects.toMatchObject({ code: "PRODUCTION_DISABLED" })
    await expect(mux.claim(f.worker, pending.id)).rejects.toMatchObject({
      code: "PRODUCTION_DISABLED",
    })
    expect(await jobs.read(f.worker, attempt.attemptId!)).toMatchObject({
      state: "QUEUED",
      generation: 0,
      leaseId: null,
    })
    expect(await mux.read(f.worker, pending.attemptId)).toMatchObject({
      state: "PENDING",
      dispatchId: null,
    })
    expect(await f.commands.request(f.user, request)).toEqual(attempt)
    await expect(
      f.commands.request(f.user, { ...request, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DISABLED" })
    controls.production = "true"
    const lease = await jobs.claim(f.worker, attempt.attemptId!),
      creation = await mux.claim(f.worker, pending.id)
    expect(lease.execute).toBe(true)
    expect(creation.execute).toBe(true)
    controls.production = "false"
    expect(await jobs.claim(f.worker, attempt.attemptId!)).toMatchObject({
      execute: false,
    })
    expect(await mux.claim(f.worker, pending.id)).toMatchObject({
      execute: false,
    })
    await mux.created(
      f.worker,
      pending.id,
      creation.dispatchId!,
      `owned-provider-result-${randomUUID()}`,
    )
    await jobs.finish(f.worker, {
      attemptId: attempt.attemptId!,
      leaseId: lease.leaseId!,
      status: "FAILED",
      result: { assets: [], costMicros: null, diagnostic: "Owned late result" },
    })
    expect(
      await f.commands.apply(f.user, {
        projectId: f.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [
          {
            kind: "set-metadata",
            title: "Still editable while production is disabled",
          },
        ],
      }),
    ).toMatchObject({ outcome: "ACCEPTED" })
    expect(await f.calendar.read(f.user, f.calendarId)).toBeDefined()
    expect(
      await f.calendar.beginPlanning(f.user, {
        calendarId: f.calendarId,
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ status: "RUNNING" })
  })

  it("rechecks a terminalized attempt after waiting for the project lock, without blocking consumed replay", async () => {
    const f = await calendarPublicationFixture(db)
    await f.commands.approve(f.user, {
      projectId: f.projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    const attempt = await f.commands.request(f.user, {
      projectId: f.projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const execution = new StudioExecutionService(db),
      run = await execution.admit(f.user, {
        attemptId: attempt.attemptId!,
        maxCostMicros: 100,
      })
    const prior = {
      runId: run.id,
      key: "consumed-before-lock",
      inputDigest: "b".repeat(64),
      reserveMicros: 10,
    }
    await execution.claim(f.worker, prior)
    const other = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    })
    let enter: () => void = () => {},
      release: () => void = () => {}
    const entered = new Promise<void>((r) => {
        enter = r
      }),
      hold = new Promise<void>((r) => {
        release = r
      })
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM studio_project WHERE id=${f.projectId} FOR UPDATE`
        enter()
        await hold
        await tx.studioAttempt.update({
          where: { id: attempt.attemptId },
          data: { status: "FAILED" },
        })
      },
      { timeout: 15000 },
    )
    await entered
    const claim = new StudioExecutionService(other).claim(f.worker, {
      ...prior,
      key: "must-not-dispatch",
    })
    const observed = claim.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    try {
      let waiting = false
      for (let tries = 0; tries < 200; tries++) {
        const rows = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%studio_project%'`
        if (rows[0].count > 0n) {
          waiting = true
          break
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(waiting).toBe(true)
      release()
      await holder
      expect(await observed).toMatchObject({ error: { code: "CONFLICT" } })
      expect((await execution.read(f.user, run.id)).calls).toHaveLength(1)
      controls.production = "false"
      expect(await execution.claim(f.worker, prior)).toMatchObject({
        execute: false,
        call: { state: "RUNNING" },
      })
    } finally {
      release()
      await holder
      await observed
      await other.$disconnect()
    }
  })
})
