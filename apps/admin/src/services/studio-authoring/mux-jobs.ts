import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma, type PrismaClient, type StudioMuxJob } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  studioAttemptResultSchema,
  studioDocumentSchema,
} from "@forge/studio-contracts"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import { studioCodecProofSchema } from "@forge/studio-contracts/render"
import { studioCatalogReadinessProofSchema } from "@forge/studio-contracts/publication-state"
import { ForbiddenError } from "../errors"
import { StudioCommandError } from "./errors"
import { StudioAssetService } from "./assets"
import { studioActor, lockProject, assertEditable } from "./state"
import { resolveStudioPackSources } from "./packs"
import { resolveStudioDocumentSources } from "./sources"

function worker(user: Principal | null) {
  if (studioActor(user).kind !== "service")
    throw new ForbiddenError("Trusted Mux worker required")
}
const muxSnapshotSchema = z.object({
  manifest: studioCatalogRenderManifestSchema,
  codecProof: z.object({
    assetId: z.string(),
    versionId: z.string(),
    digest: z.string(),
  }),
  leaseId: z.uuid(),
})
async function lockMux(tx: Prisma.TransactionClient, id: string) {
  const identity = await tx.studioMuxJob.findUniqueOrThrow({
    where: { id },
    include: { attempt: { select: { projectId: true } } },
  })
  const project = await lockProject(tx, identity.attempt.projectId)
  await tx.$queryRaw`SELECT id FROM studio_mux_job WHERE id=${id} FOR UPDATE`
  const job = await tx.studioMuxJob.findUniqueOrThrow({ where: { id } })
  return { project, job }
}

/** Provider calls never occur in this service or its transactions. A consumed
 * dispatch cannot return to PENDING; ambiguous creates require observation of
 * the exact intent, not another purchase. */
export class StudioMuxJobs {
  constructor(private readonly db: PrismaClient) {}
  async pending(
    user: Principal | null,
    cursor?: { createdAt: string; id: string },
  ) {
    worker(user)
    // Filter obsolete revisions BEFORE LIMIT. Leaving rejected old candidates
    // in the first page would starve a valid later render indefinitely.
    const after = cursor
      ? z
          .object({ createdAt: z.iso.datetime(), id: z.string().min(1) })
          .parse(cursor)
      : null
    return this.db.$queryRaw<Array<{ id: string; createdAt: Date }>>`
    SELECT attempt.id,attempt.created_at AS "createdAt" FROM studio_attempt attempt
    JOIN studio_project project ON project.id=attempt.project_id
    LEFT JOIN studio_mux_job job ON job.attempt_id=attempt.id
    LEFT JOIN studio_catalog_release release ON release.render_attempt_id=attempt.id
    WHERE attempt.kind='RENDER' AND attempt.status='SUCCEEDED'
      AND (job.state='PROCESSING' OR (
        project.current_revision=attempt.base_revision AND project.first_published_at IS NULL
        AND ((job.id IS NULL AND release.id IS NULL) OR job.state='PENDING' OR (job.state='READY' AND release.id IS NULL))
      ))
      ${after ? Prisma.sql`AND (attempt.created_at,attempt.id)>(${new Date(after.createdAt)},${after.id})` : Prisma.empty}
    ORDER BY attempt.created_at,attempt.id LIMIT 100`
  }
  async read(user: Principal | null, attemptId: string) {
    worker(user)
    return this.db.studioMuxJob.findUnique({ where: { attemptId } })
  }
  async enqueue(user: Principal | null, attemptId: string) {
    worker(user)
    const prior = await this.db.studioMuxJob.findUnique({
      where: { attemptId },
    })
    if (prior) return prior
    const attempt = await this.db.studioAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    })
    if (attempt.kind !== "RENDER" || attempt.status !== "SUCCEEDED")
      throw new StudioCommandError("INVALID")
    const result = studioAttemptResultSchema.parse(attempt.result)
    if (!result.manifest) throw new StudioCommandError("INVALID")
    const assets = new StudioAssetService(this.db)
    const metadata = await assets.read(user, result.manifest)
    if (metadata.role !== "manifest" || metadata.byteSize > 16384)
      throw new StudioCommandError("INVALID")
    const manifest = studioCatalogRenderManifestSchema.parse(
      JSON.parse(
        Buffer.from(await assets.readBytes(user, result.manifest)).toString(),
      ),
    )
    if (
      manifest.renderAttemptId !== attemptId ||
      manifest.projectId !== attempt.projectId ||
      manifest.revision !== attempt.baseRevision ||
      manifest.inputHash !== attempt.inputHash
    )
      throw new StudioCommandError("INVALID")
    let codecProof: z.infer<typeof muxSnapshotSchema>["codecProof"] | undefined
    for (const ref of result.assets) {
      const candidate = await assets.read(user, ref)
      if (candidate.role !== "manifest" || candidate.byteSize > 8192) continue
      let raw: unknown
      try {
        raw = JSON.parse(
          Buffer.from(await assets.readBytes(user, ref)).toString(),
        )
      } catch {
        continue
      }
      const proof = studioCodecProofSchema.safeParse(raw)
      if (!proof.success) continue
      if (
        proof.data.outputDigest !== manifest.output.digest ||
        proof.data.video.frames !== manifest.durationInFrames ||
        proof.data.video.width !== manifest.width ||
        proof.data.video.height !== manifest.height ||
        proof.data.video.fps !== manifest.fps
      )
        throw new StudioCommandError("INVALID")
      if (codecProof) throw new StudioCommandError("INVALID")
      codecProof = ref
    }
    if (!codecProof) throw new StudioCommandError("UNREADY")
    const retainedCodec = codecProof
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, attempt.projectId)
      const retry = await tx.studioMuxJob.findUnique({ where: { attemptId } })
      if (retry) return retry
      assertEditable(project, attempt.baseRevision)
      if (
        await tx.studioCatalogRelease.findUnique({
          where: { renderAttemptId: attemptId },
        })
      )
        throw new StudioCommandError("CONFLICT")
      const current = await tx.studioAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      })
      const execution = await tx.studioRenderExecution.findFirst({
        where: { attemptId, admitted: true, status: "SUCCEEDED" },
      })
      if (current.status !== "SUCCEEDED" || !execution)
        throw new StudioCommandError("UNREADY")
      const revision = await tx.studioProjectRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: project.id,
            number: attempt.baseRevision,
          },
        },
      })
      const document = studioDocumentSchema.parse(revision.document)
      await resolveStudioPackSources(tx, document.packRevisionIds)
      await resolveStudioDocumentSources(tx, document)
      return tx.studioMuxJob.create({
        data: {
          attemptId,
          snapshot: {
            manifest,
            codecProof: retainedCodec,
            leaseId: execution.leaseId,
          },
        },
      })
    })
  }
  async claim(user: Principal | null, id: string) {
    worker(user)
    return this.db.$transaction(async (tx) => {
      const { project, job } = await lockMux(tx, id)
      if (job.state !== "PENDING") return { execute: false, dispatchId: null }
      const { manifest } = muxSnapshotSchema.parse(job.snapshot)
      assertEditable(project, manifest.revision)
      const revision = await tx.studioProjectRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: project.id,
            number: manifest.revision,
          },
        },
      })
      const document = studioDocumentSchema.parse(revision.document)
      await resolveStudioPackSources(tx, document.packRevisionIds)
      await resolveStudioDocumentSources(tx, document)
      const dispatchId = randomUUID()
      await tx.studioMuxJob.update({
        where: { id },
        data: { state: "DISPATCHING", dispatchId },
      })
      return { execute: true, dispatchId }
    })
  }
  async ambiguous(user: Principal | null, id: string, dispatchId: string) {
    worker(user)
    return this.db.$transaction(async (tx) => {
      const { job } = await lockMux(tx, id)
      if (job.dispatchId !== dispatchId)
        throw new StudioCommandError("CONFLICT")
      if (job.state !== "DISPATCHING") return job
      return tx.studioMuxJob.update({
        where: { id },
        data: { state: "AMBIGUOUS" },
      })
    })
  }
  async created(
    user: Principal | null,
    id: string,
    dispatchId: string,
    assetId: string,
  ) {
    worker(user)
    z.string().min(1).max(255).parse(assetId)
    return this.db.$transaction(async (tx) => {
      const { job } = await lockMux(tx, id)
      if (
        job.dispatchId !== dispatchId ||
        (job.assetId && job.assetId !== assetId)
      )
        throw new StudioCommandError("CONFLICT")
      if (job.assetId === assetId) return job
      if (!["DISPATCHING", "AMBIGUOUS"].includes(job.state))
        throw new StudioCommandError("CONFLICT")
      return tx.studioMuxJob.update({
        where: { id },
        data: { state: "PROCESSING", assetId },
      })
    })
  }
  async ready(user: Principal | null, id: string, raw: unknown) {
    worker(user)
    const evidence = z
      .object({
        observedAt: z.iso.datetime(),
        proof: studioCatalogReadinessProofSchema.shape.mux,
      })
      .parse(raw)
    if (
      Date.now() - Date.parse(evidence.observedAt) > 60000 ||
      Date.parse(evidence.observedAt) > Date.now() + 5000
    )
      throw new StudioCommandError("INVALID")
    return this.db.$transaction(async (tx) => {
      const { job } = await lockMux(tx, id),
        { manifest } = muxSnapshotSchema.parse(job.snapshot)
      const proof = evidence.proof
      if (job.readiness) {
        const prior = z
          .object({ proof: studioCatalogReadinessProofSchema.shape.mux })
          .parse(job.readiness)
        if (
          prior.proof.assetId !== proof.assetId ||
          prior.proof.playbackId !== proof.playbackId
        )
          throw new StudioCommandError("CONFLICT")
      }
      if (
        !["PROCESSING", "READY"].includes(job.state) ||
        job.assetId !== proof.assetId ||
        proof.width !== manifest.width ||
        proof.height !== manifest.height ||
        proof.fps !== manifest.fps ||
        Math.abs(
          proof.durationMs - (1000 * manifest.durationInFrames) / manifest.fps,
        ) > 100
      )
        throw new StudioCommandError("UNREADY")
      return tx.studioMuxJob.update({
        where: { id },
        data: { state: "READY", readiness: evidence },
      })
    })
  }
}
export function studioMuxJobSnapshot(job: StudioMuxJob) {
  return muxSnapshotSchema.parse(job.snapshot)
}
