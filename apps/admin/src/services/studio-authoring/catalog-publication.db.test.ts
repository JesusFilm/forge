import {
  STUDIO_RENDER_TEST_DATABASE_URL,
  SHORTS_MODEL_TEST_DATABASE_URL,
} from "./database.test-support"
import { publishPreparedStudioProject } from "./scheduled-publication-adapter"
import { StudioPublicationReadinessResolver } from "./publication-readiness-resolver"
import { StudioPublicationRejected } from "./errors"
import { executeStudioInteractive } from "./interactive"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { STUDIO_CODEC_VERIFIER_VERSION } from "@forge/studio-contracts/render"
import { StudioAuthoringService } from "./index"
import { StudioRenderJobs } from "./render-jobs"
import { StudioAssetService } from "./assets"
import { StudioCatalogService } from "./catalog"
import { authorizeStudioPublicPlayback } from "./public-playback"
import { StudioMuxJobs } from "./mux-jobs"
import { StudioCatalogReadinessService } from "./catalog-readiness"
import { StudioCatalogPublicationService } from "./catalog-publication"
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>()
  const { generateKeyPairSync } = await import("node:crypto")
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  return {
    env: {
      ...original.env,
      STUDIO_ENVIRONMENT: "local",
      STUDIO_PUBLIC_PLAYBACK_ORIGIN: "http://127.0.0.1:4260",
      STUDIO_MUX_SIGNING_KEY: "local-fixture",
      STUDIO_MUX_PRIVATE_KEY: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
  }
})
const url = env.STUDIO_TEST_DATABASE_URL
const worker = { id: null, role: "MANAGER_BACKEND" as const }
class PublicationFixtureError extends Error {}
;(url ? describe : describe.skip)(
  "canonical catalog publication transaction",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (
        url !== SHORTS_MODEL_TEST_DATABASE_URL &&
        url !== STUDIO_RENDER_TEST_DATABASE_URL &&
        url !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_test"
      )
        throw new PublicationFixtureError("Owned460 database required")
      db = new PrismaClient({ datasources: { db: { url } } })
    })
    afterAll(async () => {
      await db?.$disconnect()
    })
    it("bounds a blocked playback authorization query at PostgreSQL and recovers", async () => {
      let locked: () => void = () => {},
        unlock: () => void = () => {}
      const acquired = new Promise<void>((resolve) => {
        locked = resolve
      })
      const release = new Promise<void>((resolve) => {
        unlock = resolve
      })
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`LOCK TABLE "short_release" IN ACCESS EXCLUSIVE MODE`
          locked()
          await release
        },
        { timeout: 10000 },
      )
      await Promise.race([acquired, blocker])
      const started = performance.now()
      try {
        await expect(
          authorizeStudioPublicPlayback(db, randomUUID()),
        ).rejects.toThrow()
        expect(performance.now() - started).toBeLessThan(3000)
      } finally {
        unlock()
        await blocker
      }
      expect(await authorizeStudioPublicPlayback(db, randomUUID())).toBeNull()
    })
    async function fixture(
      beforeStage?: (context: {
        projectId: string
        attemptId: string
        ownerId: string
        assetId: string
      }) => Promise<void>,
    ) {
      const id = randomUUID(),
        user = {
          id,
          role: "ADMIN" as const,
          studioAuthority: "interactive" as const,
        }
      await db.user.create({
        data: {
          id,
          name: "Publication operator",
          email: `${id}@example.invalid`,
          role: "ADMIN",
          managerMembership: { create: { role: "OPERATOR" } },
        },
      })
      const language = await db.language.create({
        data: { coreId: id, slug: id, bcp47: "en", name: { en: "English" } },
      })
      const commands = new StudioAuthoringService(db),
        jobs = new StudioRenderJobs(db),
        assets = new StudioAssetService(db)
      const document = {
        version: 1,
        title: "Publication transaction fixture",
        language: language.coreId!,
        runtimeVersion: STUDIO_RUNTIME_VERSION,
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 30,
        tracks: [],
        components: [],
        items: [],
        packRevisionIds: [],
      }
      await commands.create(user, {
        projectId: id,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document,
      })
      const requested = await commands.request(user, {
          projectId: id,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          kind: "RENDER",
          instructions: [],
        }),
        attemptId = requested.attemptId!
      await jobs.enqueue(worker, attemptId)
      const lease = await jobs.claim(worker, attemptId),
        attempt = await db.shortAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        })
      // Database transaction fixture only. Actual codec and Mux acceptance have
      // separate native/browser/provider evidence; these bytes make no such claim.
      const output = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "fixture.mp4",
          mimeType: "video/mp4",
          role: "render",
          provenance: {
            status: "recorded",
            recorded: { fixture: "transaction-only" },
          },
        },
        Buffer.from("transaction fixture bytes"),
        "LOCAL",
      )
      const codec = {
        version: 1,
        verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
        outputDigest: output.reference.digest,
        decoded: true,
        video: {
          codec: "h264",
          width: 320,
          height: 180,
          fps: 30,
          frames: 30,
          durationMs: 1000,
        },
        audio: {
          codec: "aac",
          sampleRate: 48000,
          channels: 2,
          durationMs: 1000,
        },
      }
      const proofAsset = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "codec.json",
          mimeType: "application/json",
          role: "manifest",
          provenance: {
            status: "recorded",
            recorded: { fixture: "transaction-only" },
          },
        },
        Buffer.from(JSON.stringify(codec)),
        "LOCAL",
      )
      const manifest = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "manifest.json",
          mimeType: "application/json",
          role: "manifest",
          provenance: { status: "recorded", recorded: {} },
          dependencies: [output.reference, proofAsset.reference],
        },
        Buffer.from(
          JSON.stringify({
            version: 1,
            projectId: id,
            revision: 1,
            renderAttemptId: attemptId,
            inputHash: attempt.inputHash,
            output: output.reference,
            language: document.language,
            runtimeVersion: document.runtimeVersion,
            width: 320,
            height: 180,
            fps: 30,
            durationInFrames: 30,
            verification: {
              status: "verified",
              verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
              outputDigest: output.reference.digest,
            },
          }),
        ),
        "LOCAL",
      )
      await jobs.finish(worker, {
        attemptId,
        leaseId: lease.leaseId!,
        status: "SUCCEEDED",
        result: {
          assets: [output.reference, proofAsset.reference],
          manifest: manifest.reference,
          costMicros: 0,
        },
      })
      const mux = {
        assetId: randomUUID(),
        playbackId: randomUUID(),
        policy: "signed",
        status: "ready",
      }
      await beforeStage?.({
        projectId: id,
        attemptId,
        ownerId: user.id,
        assetId: mux.assetId,
      })
      const release = await new StudioCatalogService(db).stage(worker, {
        projectId: id,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        renderAttemptId: attemptId,
        mux,
      })
      const approval = await commands.approve(user, {
        projectId: id,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "PUBLICATION",
        renderAttemptId: attemptId,
      })
      const readiness = {
        id: randomUUID(),
        releaseId: release.id,
        attemptId,
        leaseId: lease.leaseId!,
        proof: {
          output: output.reference,
          codecProof: proofAsset.reference,
          observedAt: new Date().toISOString(),
          mux: {
            assetId: mux.assetId,
            playbackId: mux.playbackId,
            status: "ready",
            playbackPolicies: ["signed"],
            width: 320,
            height: 180,
            fps: 30,
            durationMs: 1000,
            audio: true,
          },
        },
      }
      await new StudioCatalogReadinessService(db).record(worker, readiness)
      return {
        user,
        commands,
        release,
        readiness,
        input: {
          projectId: id,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          renderAttemptId: attemptId,
          approvalId: approval.approvalId!,
          releaseId: release.id,
          readinessId: readiness.id,
        },
      }
    }
    it("rejects readiness that expires while publication waits on current membership", async () => {
      const f = await fixture(),
        id = randomUUID()
      await new StudioCatalogReadinessService(db).record(worker, {
        ...f.readiness,
        id,
        proof: {
          ...f.readiness.proof,
          observedAt: new Date(Date.now() - 58000).toISOString(),
        },
      })
      const waitingUrl = new URL(url!)
      waitingUrl.searchParams.set("application_name", "shorts_readiness_wait")
      const waiting = new PrismaClient({
        datasources: { db: { url: waitingUrl.toString() } },
      })
      let entered: () => void = () => {},
        release: () => void = () => {}
      const locked = new Promise<void>((r) => (entered = r)),
        hold = new Promise<void>((r) => (release = r))
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT user_id FROM manager_membership WHERE user_id=${f.user.id} FOR UPDATE`
          entered()
          await hold
        },
        { timeout: 10000 },
      )
      await Promise.race([locked, blocker])
      const attempt = new StudioCatalogPublicationService(waiting).publish(
        f.user,
        { ...f.input, readinessId: id },
      )
      const observed = attempt.then(
        (result) => ({ result }),
        (error) => ({ error }),
      )
      try {
        const deadline = Date.now() + 1500
        let blocked = false
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            { blocked: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='shorts_readiness_wait' AND wait_event_type='Lock') AS blocked`
          if (rows[0].blocked) {
            blocked = true
            break
          }
          await new Promise((r) => setTimeout(r, 10))
        }
        expect(blocked).toBe(true)
        await new Promise((r) => setTimeout(r, 2100))
        release()
        await blocker
        expect(await observed).toMatchObject({ error: { code: "UNREADY" } })
        expect(
          await db.shortPublication.findUnique({
            where: { releaseId: f.release.id },
          }),
        ).toBeNull()
      } finally {
        release()
        await blocker
        await waiting.$disconnect()
      }
    })
    it("rolls scheduled consumption back when readiness expires during final receipt persistence", async () => {
      const f = await fixture(),
        readinessId = randomUUID(),
        key = randomUUID(),
        consumed = randomUUID()
      await new StudioCatalogReadinessService(db).record(worker, {
        ...f.readiness,
        id: readinessId,
        proof: {
          ...f.readiness.proof,
          observedAt: new Date(Date.now() - 59000).toISOString(),
        },
      })
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION studio460_delay_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key='${key}' THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$`,
      )
      await db.$executeRawUnsafe(
        "CREATE TRIGGER studio460_delay_receipt BEFORE INSERT ON short_command FOR EACH ROW EXECUTE FUNCTION studio460_delay_receipt()",
      )
      try {
        await expect(
          publishPreparedStudioProject(
            db,
            worker,
            {
              ...f.input,
              idempotencyKey: key,
              readinessId,
              schedule: {
                scheduleId: randomUUID(),
                version: 1,
                dueAt: new Date(Date.now() - 1000).toISOString(),
                latestAllowedAt: new Date(Date.now() + 60000).toISOString(),
              },
            },
            async (tx) => {
              await tx.shortCommand.create({
                data: {
                  projectId: f.input.projectId,
                  idempotencyKey: consumed,
                  inputHash: "consume",
                  actor: { kind: "service", id: "fixture" },
                  result: {
                    projectId: f.input.projectId,
                    revision: 1,
                    outcome: "ACCEPTED",
                  },
                },
              })
            },
          ),
        ).rejects.toMatchObject({ code: "UNREADY" })
        expect(
          await db.shortCommand.count({
            where: {
              projectId: f.input.projectId,
              idempotencyKey: { in: [key, consumed] },
            },
          }),
        ).toBe(0)
        expect(
          await db.shortPublication.findUnique({
            where: { releaseId: f.release.id },
          }),
        ).toBeNull()
      } finally {
        await db.$executeRawUnsafe(
          "DROP TRIGGER studio460_delay_receipt ON short_command",
        )
        await db.$executeRawUnsafe("DROP FUNCTION studio460_delay_receipt()")
      }
    })
    it("resolves only the exact currently approved release and rejects revoked approval membership", async () => {
      const f = await fixture(),
        resolver = new StudioPublicationReadinessResolver(db)
      const binding = {
        projectId: f.input.projectId,
        expectedRevision: 1,
        approvalId: f.input.approvalId,
        renderAttemptId: f.input.renderAttemptId,
        releaseId: f.input.releaseId,
      }
      const candidate = await resolver.candidate(worker, binding)
      expect(candidate).toMatchObject({
        ...binding,
        readiness: { state: "ready", id: f.readiness.id },
      })
      await expect(
        resolver.candidate(worker, { ...binding, releaseId: randomUUID() }),
      ).rejects.toMatchObject({ code: "STALE_BINDING" })
      await expect(
        resolver.candidate(
          { ...f.user, studioAuthority: "delegated" },
          binding,
        ),
      ).rejects.toThrow()
      await db.managerMembership.update({
        where: { userId: f.user.id },
        data: { revokedAt: new Date() },
      })
      await expect(resolver.candidate(worker, binding)).rejects.toMatchObject({
        code: "AUTHORIZATION_REVOKED",
      })
    })
    it("consumes one durable Mux dispatch and reconciles an ambiguous response without another create", async () => {
      const jobs = new StudioMuxJobs(db)
      let intentId = ""
      const f = await fixture(async (context) => {
        // A page of completed obsolete revisions must not hide a valid later
        // render. These are retained historical attempts, never paid admissions.
        const base = await db.shortRevision.findUniqueOrThrow({
          where: {
            projectId_number: { projectId: context.projectId, number: 1 },
          },
        })
        const obsolete: string[] = []
        for (let index = 0; index < 100; index++) {
          const projectId = randomUUID(),
            attemptId = randomUUID()
          obsolete.push(attemptId)
          await db.short.create({
            data: {
              id: projectId,
              ownerId: context.ownerId,
              currentRevision: 2,
              revisions: {
                create: [
                  {
                    number: 1,
                    document: base.document!,
                    actor: base.actor!,
                    attempts: {
                      create: {
                        id: attemptId,
                        kind: "RENDER",
                        status: "SUCCEEDED",
                        inputHash: "a".repeat(64),
                        actor: base.actor!,
                        instructions: [],
                        createdAt: new Date(0),
                      },
                    },
                  },
                  { number: 2, document: base.document!, actor: base.actor! },
                ],
              },
            },
          })
        }
        const candidates = await jobs.pending(worker)
        expect(candidates.map((row) => row.id)).toContain(context.attemptId)
        expect(candidates.some((row) => obsolete.includes(row.id))).toBe(false)
        const intent = await jobs.enqueue(worker, context.attemptId)
        intentId = intent.id
        const claims = await Promise.all([
          jobs.claim(worker, intent.id),
          jobs.claim(worker, intent.id),
        ])
        expect(claims.filter((claim) => claim.execute)).toHaveLength(1)
        const dispatched = claims.find((claim) => claim.execute)!
        await jobs.ambiguous(worker, intent.id, dispatched.dispatchId!)
        expect((await jobs.claim(worker, intent.id)).execute).toBe(false)
        await expect(
          jobs.created(worker, intent.id, randomUUID(), "wrong-asset"),
        ).rejects.toThrow()
        const uploadId = `upload-${randomUUID()}`
        await expect(
          jobs.uploadCreated(worker, intent.id, randomUUID(), uploadId),
        ).rejects.toThrow()
        expect(
          (
            await jobs.uploadCreated(
              worker,
              intent.id,
              dispatched.dispatchId!,
              uploadId,
            )
          ).state,
        ).toBe("UPLOADING")
        expect(
          (
            await jobs.uploadCreated(
              worker,
              intent.id,
              dispatched.dispatchId!,
              uploadId,
            )
          ).uploadId,
        ).toBe(uploadId)
        await expect(
          jobs.uploadCreated(
            worker,
            intent.id,
            dispatched.dispatchId!,
            "replacement-upload",
          ),
        ).rejects.toThrow()
        await expect(
          db.shortMuxJob.update({
            where: { id: intent.id },
            data: { uploadId: "changed-upload" },
          }),
        ).rejects.toThrow("immutable")
        const created = await jobs.created(
          worker,
          intent.id,
          dispatched.dispatchId!,
          context.assetId,
        )
        expect(created.state).toBe("PROCESSING")
        expect(
          (
            await jobs.created(
              worker,
              intent.id,
              dispatched.dispatchId!,
              context.assetId,
            )
          ).id,
        ).toBe(intent.id)
        await expect(
          jobs.created(
            worker,
            intent.id,
            dispatched.dispatchId!,
            "replacement-asset",
          ),
        ).rejects.toThrow()
        expect((await jobs.claim(worker, intent.id)).execute).toBe(false)
      })
      const evidence = {
        observedAt: new Date().toISOString(),
        proof: f.readiness.proof.mux,
      }
      const publication = new StudioCatalogPublicationService(db)
      await publication.publish(f.user, f.input)
      await f.commands.unpublish(f.user, {
        projectId: f.input.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      })
      expect(
        (await jobs.pending(worker)).some(
          (row) => row.id === f.input.renderAttemptId,
        ),
      ).toBe(true)
      expect(
        (await new StudioMuxJobs(db).ready(worker, intentId, evidence)).state,
      ).toBe("READY")
      await expect(
        jobs.ready(worker, intentId, {
          ...evidence,
          proof: { ...evidence.proof, playbackId: "replacement-playback" },
        }),
      ).rejects.toThrow()
      await expect(
        jobs.ready(worker, intentId, {
          ...evidence,
          proof: { ...evidence.proof, playbackPolicies: ["public"] },
        }),
      ).rejects.toThrow()
      // Late provider observations are retained operationally; they cannot lift
      // the publication latch or restore public access.
      await jobs.ready(worker, intentId, {
        ...evidence,
        observedAt: new Date().toISOString(),
      })
      expect(
        (
          await db.short.findUniqueOrThrow({
            where: { id: f.input.projectId },
          })
        ).lifecycle,
      ).toBe("UNPUBLISHED")
      expect(await authorizeStudioPublicPlayback(db, f.release.id)).toBeNull()
    })
    it("publishes the exact Short release, revokes permanently and retains the original receipt", async () => {
      const f = await fixture(),
        publication = new StudioCatalogPublicationService(db)
      const before = await db.shortRelease.findUniqueOrThrow({
        where: { id: f.release.id },
      })
      const renderState = await executeStudioInteractive(db, f.user, {
        action: "render-state",
        input: f.input.projectId,
      })
      expect(renderState).toMatchObject({
        project: { revision: 1, lifecycle: "DRAFT" },
        attempts: expect.arrayContaining([
          expect.objectContaining({
            id: f.input.renderAttemptId,
            catalogRelease: expect.objectContaining({
              id: f.release.id,
              title: before.title,
            }),
          }),
        ]),
      })
      expect(await authorizeStudioPublicPlayback(db, f.release.id)).toBeNull()
      await expect(
        executeStudioInteractive(db, f.user, {
          action: "publish",
          input: { ...f.input, readinessId: "missing-readiness" },
        }),
      ).rejects.toBeInstanceOf(StudioPublicationRejected)
      const accepted = await executeStudioInteractive(db, f.user, {
        action: "publish",
        input: f.input,
      })
      await expect(
        executeStudioInteractive(db, f.user, {
          action: "publish",
          input: { ...f.input, readinessId: "other-readiness" },
        }),
      ).rejects.not.toBeInstanceOf(StudioPublicationRejected)
      expect(await authorizeStudioPublicPlayback(db, f.release.id)).toEqual({
        playbackId: f.readiness.proof.mux.playbackId,
      })
      await expect(
        db.shortRelease.update({
          where: { id: f.release.id },
          data: { title: "Correction bypass" },
        }),
      ).rejects.toThrow()
      await f.commands.unpublish(f.user, {
        projectId: f.input.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      })
      const revoked = await db.shortPublication.findUniqueOrThrow({
        where: { releaseId: f.release.id },
      })
      expect(revoked.revokedAt).not.toBeNull()
      expect(await authorizeStudioPublicPlayback(db, f.release.id)).toBeNull()
      expect(await publication.publish(f.user, f.input)).toEqual(accepted)
      expect(
        await db.shortRelease.findUniqueOrThrow({
          where: { id: f.release.id },
        }),
      ).toEqual(before)
      await expect(
        publication.publish(f.user, {
          ...f.input,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "IMMUTABLE" })
      await expect(
        db.shortPublication.update({
          where: { releaseId: f.release.id },
          data: { revokedAt: null },
        }),
      ).rejects.toThrow()
    })
    it("rejects delegated human publication and revoked approval membership without changing visibility", async () => {
      const f = await fixture(),
        publication = new StudioCatalogPublicationService(db)
      await expect(
        publication.publish(
          { ...f.user, studioAuthority: "delegated" },
          f.input,
        ),
      ).rejects.toThrow()
      await db.managerMembership.update({
        where: { userId: f.user.id },
        data: { revokedAt: new Date() },
      })
      await expect(publication.publish(f.user, f.input)).rejects.toMatchObject({
        code: "AUTHORIZATION_REVOKED",
      })
      expect(
        await db.shortPublication.findUnique({
          where: { releaseId: f.release.id },
        }),
      ).toBeNull()
      expect(
        (
          await db.short.findUniqueOrThrow({
            where: { id: f.input.projectId },
          })
        ).firstPublishedAt,
      ).toBeNull()
    })
    it("consumes a trusted schedule hook in the publication transaction and skips it for exact retries after unpublish", async () => {
      const f = await fixture(),
        scheduleId = randomUUID(),
        key = `schedule-consumed:${scheduleId}`
      const schedule = {
        scheduleId,
        version: 1,
        dueAt: new Date(Date.now() - 1000).toISOString(),
        latestAllowedAt: new Date(Date.now() + 60000).toISOString(),
      }
      const input = { ...f.input, schedule }
      // Calendar owns real slot/authorization storage. This hook exercises the
      // common transaction using a durable receipt; it does not implement slots.
      const publication = new StudioCatalogPublicationService(
        db,
        async (tx, binding, now) => {
          expect(binding).toEqual(input)
          expect(Date.parse(binding.schedule.dueAt)).toBeLessThanOrEqual(
            now.getTime(),
          )
          await tx.shortCommand.create({
            data: {
              projectId: binding.projectId,
              idempotencyKey: key,
              inputHash: "a".repeat(64),
              actor: { kind: "service", id: "system" },
              result: {
                projectId: binding.projectId,
                revision: 1,
                outcome: "ACCEPTED",
              },
            },
          })
        },
      )
      await expect(publication.publish(f.user, input)).rejects.toThrow()
      const accepted = await publication.publish(worker, input)
      await f.commands.unpublish(f.user, {
        projectId: f.input.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      })
      expect(await publication.publish(worker, input)).toEqual(accepted)
      expect(
        await db.shortCommand.count({
          where: { projectId: f.input.projectId, idempotencyKey: key },
        }),
      ).toBe(1)
      expect(
        (
          await db.shortPublication.findUniqueOrThrow({
            where: { releaseId: f.release.id },
          })
        ).revokedAt,
      ).not.toBeNull()
    })
    it("rolls schedule consumption back when publication readiness is stale", async () => {
      const f = await fixture(),
        key = `schedule-consumed:${randomUUID()}`
      const publication = new StudioCatalogPublicationService(
        db,
        async (tx) => {
          await tx.shortCommand.create({
            data: {
              projectId: f.input.projectId,
              idempotencyKey: key,
              inputHash: "a".repeat(64),
              actor: { kind: "service", id: "system" },
              result: {
                projectId: f.input.projectId,
                revision: 1,
                outcome: "ACCEPTED",
              },
            },
          })
        },
      )
      await expect(
        publication.publish(worker, {
          ...f.input,
          readinessId: "stale",
          schedule: {
            scheduleId: randomUUID(),
            version: 1,
            dueAt: new Date(Date.now() - 1000).toISOString(),
            latestAllowedAt: new Date(Date.now() + 60000).toISOString(),
          },
        }),
      ).rejects.toMatchObject({ code: "UNREADY" })
      expect(
        await db.shortCommand.count({
          where: { projectId: f.input.projectId, idempotencyKey: key },
        }),
      ).toBe(0)
      expect(
        await db.shortPublication.findUnique({
          where: { releaseId: f.release.id },
        }),
      ).toBeNull()
    })
  },
)
