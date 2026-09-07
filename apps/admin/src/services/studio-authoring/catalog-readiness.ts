import type { PrismaClient } from "@prisma/client"
import { studioAttemptResultSchema } from "@forge/studio-contracts"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import { studioCodecProofSchema } from "@forge/studio-contracts/render"
import {
  studioCatalogReadinessProofSchema,
  studioRecordCatalogReadinessSchema,
} from "@forge/studio-contracts/publication-state"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "../errors"
import { StudioAssetService } from "./assets"
import { studioActor, studioHash, lockProject, assertEditable } from "./state"
import { StudioCommandError } from "./errors"

export const retainedStudioReadinessSchema =
  studioCatalogReadinessProofSchema.extend({ codec: studioCodecProofSchema })
export const stagedStudioReleaseSchema = z.object({
  manifest: studioCatalogRenderManifestSchema,
  restrictions: z.array(z.string()),
  mux: z.object({
    assetId: z.string(),
    playbackId: z.string(),
    policy: z.literal("signed"),
    status: z.literal("ready"),
  }),
})

/** Authenticated broker records observed provider readiness after external work.
 * The canonical transaction rechecks the successful fenced execution; metadata
 * authored by an operator is never accepted as codec/provider authority. */
export class StudioCatalogReadinessService {
  constructor(private readonly db: PrismaClient) {}
  async record(user: Principal | null, raw: unknown, now = new Date()) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted render readiness required")
    const input = studioRecordCatalogReadinessSchema.parse(raw),
      requestHash = studioHash(input)
    const prior = await this.db.studioCatalogReadiness.findUnique({
      where: { id: input.id },
    })
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new StudioCommandError("CONFLICT")
      return { id: prior.id }
    }
    const observedAt = new Date(input.proof.observedAt)
    if (
      now.getTime() - observedAt.getTime() > 60000 ||
      observedAt.getTime() > now.getTime() + 5000
    )
      throw new StudioCommandError("INVALID")
    const assets = new StudioAssetService(this.db)
    const metadata = await assets.read(user, input.proof.codecProof)
    if (metadata.role !== "manifest" || metadata.byteSize > 8192)
      throw new StudioCommandError("INVALID")
    const codec = studioCodecProofSchema.parse(
      JSON.parse(
        Buffer.from(
          await assets.readBytes(user, input.proof.codecProof),
        ).toString("utf8"),
      ),
    )
    return this.db.$transaction(async (tx) => {
      const release = await tx.studioCatalogRelease.findUniqueOrThrow({
        where: { id: input.releaseId },
      })
      const project = await lockProject(tx, release.projectId)
      const prior = await tx.studioCatalogReadiness.findUnique({
        where: { id: input.id },
      })
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return { id: prior.id }
      }
      assertEditable(project, release.revision)
      const execution = await tx.studioRenderExecution.findUniqueOrThrow({
        where: {
          attemptId_leaseId: {
            attemptId: input.attemptId,
            leaseId: input.leaseId,
          },
        },
      })
      const result = studioAttemptResultSchema.parse(execution.result)
      const { manifest, mux } = stagedStudioReleaseSchema.parse(
        release.snapshot,
      )
      if (
        release.renderAttemptId !== input.attemptId ||
        execution.status !== "SUCCEEDED" ||
        !execution.admitted ||
        !result.assets.some(
          (ref) => studioHash(ref) === studioHash(input.proof.codecProof),
        ) ||
        studioHash(manifest.output) !== studioHash(input.proof.output) ||
        codec.outputDigest !== manifest.output.digest ||
        codec.video.width !== manifest.width ||
        codec.video.height !== manifest.height ||
        codec.video.fps !== manifest.fps ||
        codec.video.frames !== manifest.durationInFrames ||
        input.proof.mux.assetId !== mux.assetId ||
        input.proof.mux.playbackId !== mux.playbackId ||
        input.proof.mux.width !== manifest.width ||
        input.proof.mux.height !== manifest.height ||
        input.proof.mux.fps !== manifest.fps ||
        Math.abs(
          input.proof.mux.durationMs -
            (manifest.durationInFrames * 1000) / manifest.fps,
        ) > 100
      )
        throw new StudioCommandError("INVALID")
      await tx.studioCatalogReadiness.create({
        data: {
          id: input.id,
          releaseId: release.id,
          attemptId: input.attemptId,
          leaseId: input.leaseId,
          requestHash,
          proof: { ...input.proof, codec },
          checkedAt: observedAt,
          expiresAt: new Date(observedAt.getTime() + 60000),
        },
      })
      return { id: input.id }
    })
  }
}
