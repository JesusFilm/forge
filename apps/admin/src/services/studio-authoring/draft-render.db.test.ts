import { StudioInspectionService } from "./inspection"
import { STUDIO_INSPECTION_VERSION } from "@forge/studio-contracts/inspection"
import { StudioRenderPreparation } from "./render-preparation"
import { randomUUID, createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { expect, test } from "vitest"
import { z } from "zod"
import { env } from "@/config/env"
import { studioCommandResultSchema } from "@forge/studio-contracts"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { executeStudioDelegated } from "./delegated"
import { StudioAuthoringService } from "./index"
import { StudioRenderJobs } from "./render-jobs"
import { StudioAssetService } from "./assets"
import { StudioTransferService } from "./transfers"

const url = env.STUDIO_TEST_DATABASE_URL
;(url ? test : test.skip)(
  "delegated render scope, retry, worker completion, scoped refresh and stale history",
  async () => {
    if (url !== STUDIO_RENDER_TEST_DATABASE_URL)
      throw new Error("Owned render database required")
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      const id = randomUUID(),
        projectId = randomUUID()
      await db.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          name: "Render operator",
          role: "EDITOR",
          managerMembership: { create: { role: "OPERATOR" } },
        },
      })
      const caller = {
        sub: id,
        authority: "delegated" as const,
        clientId: "codex",
        scopes: ["shorts:read", "shorts:edit", "shorts:render"],
      }
      const worker = { id: null, role: "MANAGER_BACKEND" as const }
      const human = {
        id,
        role: "EDITOR" as const,
        managerRole: "OPERATOR" as const,
        studioAuthority: "interactive" as const,
      }
      const commands = new StudioAuthoringService(db),
        jobs = new StudioRenderJobs(db)
      const document = {
        version: 1,
        title: "Delegated exact draft",
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
      }
      await executeStudioDelegated(db, caller, {
        action: "create",
        input: {
          projectId,
          expectedRevision: 0,
          idempotencyKey: randomUUID(),
          document,
        },
      })
      const input = {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      }
      await expect(
        executeStudioDelegated(
          db,
          { ...caller, scopes: ["shorts:edit", "shorts:chat"] },
          { action: "render-request", input },
        ),
      ).rejects.toThrow("scope")
      await expect(
        executeStudioDelegated(
          db,
          { ...caller, scopes: ["shorts:chat"] },
          {
            action: "request",
            input: { ...input, kind: "RENDER", instructions: [] },
          },
        ),
      ).rejects.toThrow()
      const request = () =>
        executeStudioDelegated(db, caller, { action: "render-request", input })
      const accepted = studioCommandResultSchema.parse(await request()),
        attemptId = accepted.attemptId!
      expect(await request()).toEqual(accepted)
      expect(await db.shortAttempt.count({ where: { projectId } })).toBe(1)
      await expect(
        executeStudioDelegated(db, caller, {
          action: "render-request",
          input: { ...input, expectedRevision: 2 },
        }),
      ).rejects.toThrow("CONFLICT")
      const identity = { projectId, attemptId }
      const status = () =>
        executeStudioDelegated(db, caller, {
          action: "render-status",
          input: identity,
        })
      expect(await status()).toMatchObject({
        status: "QUEUED",
        stale: false,
        output: null,
        jobState: "PENDING_ENQUEUE",
      })
      const attempt = await commands.readAttempt(human, projectId, attemptId)
      expect(attempt.actor).toMatchObject({
        authority: "delegated",
        clientId: "codex",
        id,
      })
      await jobs.enqueue(worker, attemptId)
      const lease = await jobs.claim(worker, attemptId)
      expect(await status()).toMatchObject({ status: "RUNNING" })
      const assets = new StudioAssetService(db)
      const provenance = {
        status: "recorded",
        recorded: {
          attemptId,
          leaseId: lease.leaseId,
          profileId: STUDIO_RENDER_PROFILE.id,
        },
      }
      // Transport fixture only: actual codec execution is covered by the contained worker suite.
      const output = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "render.mp4",
          mimeType: "video/mp4",
          role: "render",
          provenance,
        },
        Buffer.from("fixture output"),
      )
      const manifest = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "manifest.json",
          mimeType: "application/json",
          role: "manifest",
          provenance,
        },
        Buffer.from(
          JSON.stringify({
            version: 1,
            projectId,
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
              verifierVersion: "fixture",
              outputDigest: output.reference.digest,
            },
          }),
        ),
      )
      await jobs.finish(worker, {
        attemptId,
        leaseId: lease.leaseId,
        status: "SUCCEEDED",
        result: {
          assets: [output.reference, manifest.reference],
          manifest: manifest.reference,
          costMicros: null,
        },
      })
      expect(await status()).toMatchObject({
        status: "SUCCEEDED",
        stale: false,
        output: output.reference,
      })
      // Database/authority proof only: the bytes above are a transport fixture.
      // Real rendered pixel/audio extraction is tested by the Manager and contained suites.
      const inspections = new StudioInspectionService(db)
      const inspectionContext = await inspections.context(human, identity)
      expect(inspectionContext.evidence).toBeNull()
      const evidence = {
        version: STUDIO_INSPECTION_VERSION,
        ...identity,
        revision: 1,
        inputHash: attempt.inputHash,
        output: output.reference,
        durationMs: 1000,
        outputReadyAt: inspectionContext.outputReadyAt,
        preparationStartedAt: new Date().toISOString(),
        evidenceReadyAt: new Date().toISOString(),
        preparationMs: 1,
        status: "sampled",
        advisoryOnly: true,
        samples: [
          {
            frame: 0,
            timestampMs: 0,
            reasons: ["representative"],
            blackPercent: null,
            image: {
              mimeType: "image/jpeg",
              data: Buffer.from([255, 216, 255, 217]).toString("base64"),
              digest: createHash("sha256")
                .update(Buffer.from([255, 216, 255, 217]))
                .digest("hex"),
            },
          },
        ],
        coverage: {
          totalFrames: 30,
          requestedFrames: [0],
          cutCount: 0,
          sampledCutCount: 0,
          authoredGaps: [],
          gapIntent: "not-recorded; confirm intentional gaps with the author",
          audio: {
            status: "unavailable",
            startMs: 0,
            endMs: 0,
            monoSampleRate: 8000,
            rms: null,
            peak: null,
            nearFullscaleFraction: null,
            silence: [],
          },
        },
        findings: [],
        limitations: ["Authority/persistence transport fixture only"],
        toolchain: { ffmpeg: "fixture", ffprobe: "fixture" },
      }
      await expect(inspections.save(human, evidence)).rejects.toThrow(
        "Trusted inspection producer",
      )
      await expect(
        executeStudioDelegated(db, caller, {
          action: "inspection-save",
          input: evidence,
        }),
      ).rejects.toThrow()
      await expect(
        inspections.save(worker, {
          ...evidence,
          output: { ...output.reference, digest: "0".repeat(64) },
        }),
      ).rejects.toThrow("INVALID")
      await expect(
        inspections.save(worker, { ...evidence, status: "unsupported" }),
      ).rejects.toThrow("INVALID")
      const saved = await inspections.save(worker, evidence)
      expect(await inspections.save(worker, evidence)).toEqual(saved)
      expect(
        await executeStudioDelegated(db, caller, {
          action: "inspection-context",
          input: identity,
        }),
      ).toMatchObject({ evidence: saved, stale: false })
      await expect(
        db.$executeRaw`UPDATE short_render_inspection SET evidence='{}'::jsonb WHERE attempt_id=${attemptId}`,
      ).rejects.toThrow("immutable")
      const accessSchema = z.object({ access: z.object({ path: z.string() }) })
      const read = () =>
        executeStudioDelegated(db, caller, {
          action: "render-read",
          input: identity,
        })
      const first = accessSchema.parse(await read()),
        second = accessSchema.parse(await read())
      expect(second.access.path).not.toBe(first.access.path)
      const transfers = new StudioTransferService(db)
      const token = first.access.path.split("/").at(-1)!
      expect((await transfers.download(token)).bytes.toString()).toBe(
        "fixture output",
      )
      await db.shortAssetTransfer.updateMany({
        where: {
          payload: { path: ["versionId"], equals: output.reference.versionId },
        },
        data: { expiresAt: new Date(0) },
      })
      await expect(transfers.download(token)).rejects.toThrow()
      expect(accessSchema.parse(await read()).access.path).not.toBe(
        first.access.path,
      )
      await commands.apply(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: "Human correction" }],
      })
      expect(await status()).toMatchObject({
        status: "SUCCEEDED",
        stale: true,
        revision: 1,
        currentRevision: 2,
        output: output.reference,
      })
      expect(await inspections.context(human, identity)).toMatchObject({
        evidence: saved,
        stale: true,
        currentRevision: 2,
      })
      // Human approval of exact old bytes must not approve a newer document,
      // even when inspection and playback of the old result remain available.
      await expect(
        commands.approve(human, {
          projectId,
          expectedRevision: 2,
          idempotencyKey: randomUUID(),
          kind: "PUBLICATION",
          renderAttemptId: attemptId,
        }),
      ).rejects.toThrow("APPROVAL_REQUIRED")
      await expect(
        commands.approve(human, {
          projectId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          kind: "PUBLICATION",
          renderAttemptId: attemptId,
        }),
      ).rejects.toThrow("CONFLICT")
      expect(await db.shortApproval.count({ where: { projectId } })).toBe(0)
      expect(await request()).toEqual(accepted)
      await expect(
        executeStudioDelegated(db, caller, {
          action: "render-status",
          input: { ...identity, projectId: randomUUID() },
        }),
      ).rejects.toThrow()
      await expect(
        executeStudioDelegated(db, caller, { action: "approve", input: {} }),
      ).rejects.toThrow()
      const expiring = await commands.request(human, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "RENDER",
        instructions: [],
      })
      await jobs.enqueue(worker, expiring.attemptId!)
      const expired = await jobs.claim(
        worker,
        expiring.attemptId!,
        1000,
        new Date(Date.now() - 2000),
      )
      await expect(
        new StudioRenderPreparation(db).save(worker, {
          attemptId: expiring.attemptId,
          leaseId: expired.leaseId,
          document: { ...document, title: "Human correction" },
        }),
      ).rejects.toThrow("CONFLICT")
      await db.managerMembership.update({
        where: { userId: id },
        data: { revokedAt: new Date() },
      })
      await expect(read()).rejects.toThrow("membership")
    } finally {
      await db.$disconnect()
    }
  },
)
