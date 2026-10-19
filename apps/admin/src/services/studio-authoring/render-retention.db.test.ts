import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioAuthoringService } from "./index"
import { StudioAssetService, byteDigest } from "./assets"
import { StudioRenderJobs } from "./render-jobs"
import { StudioRenderRetention } from "./render-retention"
import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import {
  STUDIO_CODEC_VERIFIER_VERSION,
  STUDIO_RENDER_PROFILE,
} from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"

const url = env.STUDIO_TEST_DATABASE_URL
const worker = { id: null, role: "MANAGER_BACKEND" as const }
const human = {
  id: "bounded-retention-owner",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
class RetentionFixtureError extends Error {}

;(url ? describe : describe.skip)("bounded render storage retention", () => {
  let db: PrismaClient
  beforeAll(() => {
    if (
      url !== STUDIO_RENDER_TEST_DATABASE_URL &&
      url !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_test"
    )
      throw new RetentionFixtureError("Owned460 database required")
    db = new PrismaClient({ datasources: { db: { url } } })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })

  it("retains archive edges, assembles immutable storage bytes, and keeps cancelled output unadmitted", async () => {
    const commands = new StudioAuthoringService(db),
      jobs = new StudioRenderJobs(db),
      assets = new StudioAssetService(db)
    const projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Bounded output",
        language: "english",
        runtimeVersion: STUDIO_RUNTIME_VERSION,
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
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    if (!attempt.attemptId)
      throw new RetentionFixtureError("Render attempt required")
    const attemptId = attempt.attemptId
    const job = await jobs.enqueue(worker, attemptId)
    const lease = await jobs.claim(worker, attemptId)
    if (!lease.leaseId)
      throw new RetentionFixtureError("Issued render lease required")
    const leaseId = lease.leaseId
    const context = await db.shortAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    })
    const output = Buffer.from(
      "bounded retention storage fixture, not a codec qualification",
    )
    const recorded = {
      attemptId,
      leaseId,
      profileId: STUDIO_RENDER_PROFILE.id,
      inputHash: context.inputHash,
      outputDigest: byteDigest(output),
      outputBytes: output.length,
      partIndex: 0,
      partCount: 1,
      retentionDeadlineMs: Date.now() + 40000,
    }
    const metadata = {
      idempotencyKey: randomUUID(),
      filename: `${attemptId}-part-0.bin`,
      mimeType: "application/octet-stream",
      role: "archive",
      provenance: { status: "recorded", recorded },
    }
    await expect(assets.register(human, metadata, output)).rejects.toThrow(
      "Trusted render producer",
    )
    await expect(
      assets.register(
        worker,
        {
          ...metadata,
          idempotencyKey: randomUUID(),
          provenance: {
            status: "recorded",
            recorded: { ...recorded, leaseId: randomUUID() },
          },
        },
        output,
      ),
    ).rejects.toThrow("Issued render lease required")
    for (const fields of [
      { inputHash: "b".repeat(64) },
      { outputDigest: "invalid" },
      { outputBytes: 0 },
      { outputBytes: 134217729 },
      { outputBytes: output.length + 1 },
      { partIndex: 1 },
      { partCount: 2 },
    ]) {
      await expect(
        assets.register(
          worker,
          {
            ...metadata,
            idempotencyKey: randomUUID(),
            provenance: {
              status: "recorded",
              recorded: { ...recorded, ...fields },
            },
          },
          output,
        ),
      ).rejects.toThrow("Invalid render output part")
    }
    expect(
      (await jobs.read(worker, attemptId)).leases[0].retainedAssets,
    ).toHaveLength(0)
    const part = await assets.register(worker, metadata, output)
    const proof = {
      version: 1,
      verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
      outputDigest: byteDigest(output),
      decoded: true,
      video: {
        codec: "h264",
        width: 320,
        height: 180,
        fps: 30,
        frames: 30,
        durationMs: 1000,
      },
      audio: { codec: "aac", sampleRate: 48000, channels: 2, durationMs: 1000 },
    }
    const input = { attemptId, leaseId, parts: [part.reference], proof }
    const service = new StudioRenderRetention(db)
    const result = await service.retain(worker, input)
    expect(await service.retain(worker, input)).toEqual(result)
    expect(result.assets).toHaveLength(3)
    expect(await assets.readBytes(worker, result.assets[0])).toEqual(output)
    const manifest = studioCatalogRenderManifestSchema.parse(
      JSON.parse((await assets.readBytes(worker, result.manifest)).toString()),
    )
    expect(manifest).toMatchObject({
      projectId,
      renderAttemptId: attemptId,
      output: result.assets[0],
      inputHash: context.inputHash,
    })
    expect(
      (await jobs.read(worker, attemptId)).leases[0].retainedAssets
        .map((edge) => edge.assetVersionId)
        .sort(),
    ).toEqual(
      [part.reference, ...result.assets]
        .map((reference) => reference.versionId)
        .sort(),
    )
    await commands.readAttempt(worker, projectId, attemptId)
    await jobs.cancel(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId,
    })
    expect(await service.retain(worker, input)).toEqual(result)
    expect(
      await jobs.finish(worker, {
        attemptId,
        leaseId,
        status: "SUCCEEDED",
        result,
      }),
    ).toEqual({ admitted: false })
    expect((await jobs.read(worker, attemptId)).state).toBe("CANCELLED")
    expect((await jobs.read(worker, attemptId)).snapshot).toEqual(job.snapshot)
  })
})
