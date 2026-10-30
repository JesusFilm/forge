import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { canReviewStudio } from "@/auth/permissions"
import { ForbiddenError } from "../errors"
import {
  studioCommandBaseSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import { studioNarrationPlanSchema } from "@forge/studio-contracts/production"
import { StudioNarrationService } from "./narration"
import { StudioAssetService } from "./assets"
import { StudioExecutionService } from "./execution"
import { StudioAuthoringService } from "./index"
import { assertStudioProductionEnabled } from "./release-controls"
import {
  assertEditable,
  lockProject,
  receipt,
  saveReceipt,
  studioActor,
  studioHash,
} from "./state"

export class StudioNarrationAllowanceError extends Error {}
export async function readDelegatedNarrationPlan(
  db: Prisma.TransactionClient,
  runId: string,
) {
  const rows = await db.$queryRaw<Array<{ plan: unknown }>>`
    SELECT plan FROM short_narration_admission WHERE run_id=${runId}`
  return rows[0] ? studioNarrationPlanSchema.parse(rows[0].plan) : null
}
async function allowance(db: Prisma.TransactionClient, projectId: string) {
  const rows = await db.$queryRaw<Array<{ used: number; extra: number }>>`
    SELECT (SELECT count(*)::int FROM short_narration_admission
      WHERE project_id=${projectId} AND consumes_pass) AS used,
    COALESCE((SELECT extra_passes FROM short_narration_allowance WHERE project_id=${projectId}),0)::int AS extra`
  const { used, extra } = rows[0]!
  return {
    cycle: projectId,
    used,
    allowed: 2 + extra,
    remaining: Math.max(0, 2 + extra - used),
    initialAvailable: used === 0,
    correctionAvailable: used < 2,
  }
}

/** Separate draft admission. Never creates a script approval or accepts caller identities. */
export class StudioDelegatedNarrationService {
  constructor(private readonly db: PrismaClient) {}
  async status(user: Principal | null, raw: unknown) {
    const { projectId } = z
      .object({ projectId: studioIdSchema })
      .strict()
      .parse(raw)
    await new StudioAuthoringService(this.db).read(user, projectId)
    const admissions = await this.db.$queryRaw<
      Array<{ runId: string; consumesPass: boolean }>
    >`
      SELECT run_id AS "runId", consumes_pass AS "consumesPass" FROM short_narration_admission
      WHERE project_id=${projectId} ORDER BY created_at DESC LIMIT 20`
    return {
      ...(await allowance(this.db, projectId)),
      runs: await Promise.all(
        admissions.map(async (row) => ({
          ...row,
          ...(await new StudioExecutionService(this.db).read(user, row.runId)),
        })),
      ),
    }
  }
  async authorize(user: Principal | null, raw: unknown) {
    if (!canReviewStudio(user))
      throw new ForbiddenError("Interactive human authorization required")
    const input = studioCommandBaseSchema
      .extend({
        additionalPasses: z.number().int().min(1).max(10),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw)
    const actor = studioActor(user)
    return this.db.$transaction(async (tx) => {
      const project = await lockProject(tx, input.projectId)
      const hash = studioHash({ command: "narration-authorize", actor, input })
      const prior = await receipt(tx, project.id, input.idempotencyKey, hash)
      if (prior) return prior
      assertEditable(project, input.expectedRevision)
      await tx.$executeRaw`INSERT INTO short_narration_allowance(project_id,extra_passes)
        VALUES (${project.id},${input.additionalPasses}) ON CONFLICT(project_id)
        DO UPDATE SET extra_passes=short_narration_allowance.extra_passes+EXCLUDED.extra_passes`
      const result = {
        projectId: project.id,
        revision: project.currentRevision,
        outcome: "ACCEPTED" as const,
      }
      await saveReceipt(
        tx,
        project.id,
        input.idempotencyKey,
        hash,
        actor,
        result,
      )
      return result
    })
  }
  async admit(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "human" || actor.authority !== "delegated")
      throw new ForbiddenError("Delegated narration admission required")
    const input = studioCommandBaseSchema.strict().parse(raw)
    // Fast accepted-receipt path survives later edits; repeat below under the project lock.
    const hash = studioHash({ command: "draft-narration", actor, input })
    const prior = await receipt(
      this.db,
      input.projectId,
      input.idempotencyKey,
      hash,
    )
    if (prior) return this.accepted(prior.attemptId!, user, input.projectId)
    const plan = await new StudioNarrationService(this.db).plan(user, {
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
    })
    if (!plan.segments.length)
      throw new StudioNarrationAllowanceError(
        "No effective spoken text to narrate",
      )
    const project = await new StudioAuthoringService(this.db).read(
      user,
      input.projectId,
    )
    const assets = new StudioAssetService(this.db)
    for (const item of project.document.items) {
      if (!item.speech || item.speech.suppressed || !item.speech.text) continue
      const voice = await assets.read(user, item.speech.voice)
      if (
        (voice.actor.kind === "human" &&
          voice.actor.authority === "delegated") ||
        !["existing", "registered"].includes(
          String(voice.provenance.recorded.registrationStatus),
        )
      )
        throw new StudioNarrationAllowanceError(
          "Select an approved existing voice before draft narration",
        )
    }
    const result = await this.db.$transaction(async (tx) => {
      const locked = await lockProject(tx, input.projectId)
      const retry = await receipt(tx, locked.id, input.idempotencyKey, hash)
      if (retry) return retry
      assertStudioProductionEnabled()
      assertEditable(locked, input.expectedRevision)
      const consumes = plan.segments.some((s) => s.matches.length === 0)
      if (consumes) {
        // Block alternate keys/clients while an earlier pass is live or its paid outcome unknown.
        const unresolved = await tx.$queryRaw<Array<{ run_id: string }>>`
          SELECT a.run_id FROM short_narration_admission a
          JOIN short_production_run r ON r.id=a.run_id
          JOIN short_attempt t ON t.id=r.attempt_id
          WHERE a.project_id=${locked.id} AND a.consumes_pass AND
            ((t.status IN ('QUEUED','RUNNING') AND r.state='READY') OR EXISTS
              (SELECT 1 FROM short_production_call c WHERE c.run_id=r.id AND c.state IN ('RUNNING','AMBIGUOUS')))
          LIMIT 1`
        if (unresolved.length)
          throw new StudioNarrationAllowanceError(
            "Prior narration requires reconciliation; resume or inspect its accepted run instead of a new paid pass",
          )
        if (!(await allowance(tx, locked.id)).remaining)
          throw new StudioNarrationAllowanceError(
            "Narration allowance exhausted; a human must explicitly authorize an additional pass",
          )
      }
      const attempt = await tx.shortAttempt.create({
        data: {
          projectId: locked.id,
          baseRevision: locked.currentRevision,
          kind: "NARRATION",
          inputHash: studioHash({ kind: "delegated-narration", plan }),
          actor,
          instructions: [],
        },
      })
      // Draft authority is count-bounded, not a fabricated dollar budget. Quotes remain independent.
      const run = await tx.shortProductionRun.create({
        data: { attemptId: attempt.id, actor, maxCostMicros: 0n },
      })
      await tx.$executeRaw`INSERT INTO short_narration_admission(run_id,project_id,consumes_pass,plan)
        VALUES (${run.id},${locked.id},${consumes},${JSON.stringify(plan)}::jsonb)`
      const accepted = {
        projectId: locked.id,
        revision: locked.currentRevision,
        attemptId: attempt.id,
        outcome: "ACCEPTED" as const,
      }
      await saveReceipt(
        tx,
        locked.id,
        input.idempotencyKey,
        hash,
        actor,
        accepted,
      )
      return accepted
    })
    return this.accepted(result.attemptId!, user, input.projectId)
  }
  private async accepted(
    attemptId: string,
    user: Principal | null,
    projectId: string,
  ) {
    const run = await this.db.shortProductionRun.findUniqueOrThrow({
      where: { attemptId },
    })
    return {
      runId: run.id,
      attemptId,
      projectId,
      allowance: await allowance(this.db, projectId),
      state: await new StudioExecutionService(this.db).read(user, run.id),
    }
  }
}
