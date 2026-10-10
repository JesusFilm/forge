import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { createHash } from "node:crypto"
import {
  STUDIO_INSPECTION_VERSION,
  studioInspectionContextSchema,
  studioInspectionEvidenceSchema,
  studioInspectionRequestSchema,
} from "@forge/studio-contracts/inspection"
import { StudioDraftRenderService } from "./draft-render"
import { StudioAuthoringService } from "./index"
import { studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"
import { ForbiddenError } from "../errors"

/** Reads recheck current operator/project authority even for cached historic output. */
export class StudioInspectionService {
  constructor(private readonly db: PrismaClient) {}
  async context(user: Principal, raw: unknown) {
    const input = studioInspectionRequestSchema.parse(raw)
    const render = await new StudioDraftRenderService(this.db).status(
      user,
      input,
    )
    if (!render.output) throw new StudioCommandError("UNREADY")
    const revision = await new StudioAuthoringService(this.db).readRevision(
      user,
      input.projectId,
      render.revision,
    )
    const attempt = await this.db.shortAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    })
    const rows = await this.db.$queryRaw<
      Array<{ evidence: unknown }>
    >`SELECT evidence FROM short_render_inspection WHERE attempt_id=${input.attemptId} AND version=${STUDIO_INSPECTION_VERSION}`
    return studioInspectionContextSchema.parse({
      ...input,
      revision: render.revision,
      currentRevision: render.currentRevision,
      stale: render.stale,
      inputHash: render.inputHash,
      output: render.output,
      document: revision.document,
      outputReadyAt: attempt.updatedAt.toISOString(),
      evidence: rows[0]?.evidence ?? null,
    })
  }
  /** Only the credential-bearing measurement broker can store evidence. Caller
   * supplied reports never pass this server-only render-worker capability. */
  async save(user: Principal, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted inspection producer required")
    const evidence = studioInspectionEvidenceSchema.parse(raw)
    if (evidence.status !== "sampled") throw new StudioCommandError("INVALID")
    const context = await this.context(user, {
      projectId: evidence.projectId,
      attemptId: evidence.attemptId,
    })
    if (context.evidence) return context.evidence
    if (
      context.revision !== evidence.revision ||
      context.inputHash !== evidence.inputHash ||
      studioHash(context.output) !== studioHash(evidence.output) ||
      context.outputReadyAt !== evidence.outputReadyAt ||
      evidence.coverage.totalFrames !== context.document.durationInFrames ||
      Math.abs(
        evidence.durationMs -
          (context.document.durationInFrames / context.document.fps) * 1000,
      ) > 100 ||
      evidence.samples.some(
        (sample) =>
          sample.frame >= context.document.durationInFrames ||
          Math.abs(
            sample.timestampMs - (sample.frame / context.document.fps) * 1000,
          ) > 0.01 ||
          createHash("sha256")
            .update(Buffer.from(sample.image.data, "base64"))
            .digest("hex") !== sample.image.digest,
      )
    )
      throw new StudioCommandError("INVALID")
    const json = JSON.stringify(evidence)
    await this.db
      .$executeRaw`INSERT INTO short_render_inspection(attempt_id,version,output_version_id,evidence) VALUES(${evidence.attemptId},${evidence.version},${evidence.output.versionId},${json}::jsonb) ON CONFLICT (attempt_id,version) DO NOTHING`
    return (
      await this.context(user, {
        projectId: evidence.projectId,
        attemptId: evidence.attemptId,
      })
    ).evidence!
  }
}
