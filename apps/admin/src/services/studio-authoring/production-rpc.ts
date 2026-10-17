import { readDelegatedNarrationPlan } from "./delegated-narration"
import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { studioActorSchema, studioIdSchema } from "@forge/studio-contracts"
import { interactiveStudioPrincipal } from "./interactive"
import { StudioExecutionService } from "./execution"
import { StudioAuthoringService } from "./index"
import { StudioNarrationService } from "./narration"
import { StudioExperimentService } from "./experiments"
import { StudioTransferService } from "./transfers"
import { studioHash } from "./state"
export const studioProductionRpcSchema = z
  .object({
    action: z.literal("production"),
    runId: studioIdSchema,
    command: z.enum([
      "context",
      "claim",
      "finish",
      "upload",
      "narration-complete",
      "experiment-candidate",
      "fail",
      "preflight-error",
      "reconciliation-note",
    ]),
    input: z.unknown(),
  })
  .strict()
/** Only Manager's paid runner receives this capability; hosted agents/MCP cannot mint it. */
export async function executeStudioProduction(
  db: PrismaClient,
  caller: StudioCaller,
  raw: unknown,
) {
  if (
    caller.authority !== "delegated" ||
    caller.clientId !== "shorts-production" ||
    !caller.scopes.includes("shorts:production:execute")
  )
    throw new StudioBoundaryError("Trusted production execution required")
  await interactiveStudioPrincipal(db, caller.sub)
  const request = studioProductionRpcSchema.parse(raw)
  const run = await db.shortProductionRun.findUniqueOrThrow({
    where: { id: request.runId },
  })
  const actor = studioActorSchema.parse(run.actor)
  const delegatedPlan = await readDelegatedNarrationPlan(db, run.id)
  if (
    actor.kind !== "human" ||
    actor.id !== caller.sub ||
    (actor.authority !== "interactive" &&
      !(actor.authority === "delegated" && delegatedPlan))
  )
    throw new StudioBoundaryError("Production admission owner mismatch")
  const worker = { id: null, role: "MANAGER_BACKEND" as const },
    execution = new StudioExecutionService(db)
  const input = z.record(z.string(), z.unknown()).parse(request.input)
  async function recordReconciliationNote(diagnostic: string) {
    const inputDigest = studioHash({ phase: "runner-observation", diagnostic })
    const key = `observation-${inputDigest}`
    const recorded = await db.$transaction(async (tx) => {
      // Serialize diagnostic admission only. Never infer execution ownership
      // from a read, and never update a shared run, attempt or paid claim.
      await tx.$queryRaw`SELECT id FROM short_production_run WHERE id=${run.id} FOR UPDATE`
      if (
        await tx.shortProductionCall.findUnique({
          where: { runId_key: { runId: run.id, key } },
        })
      )
        return true
      if (
        (await tx.shortProductionCall.count({
          where: { runId: run.id, key: { startsWith: "observation-" } },
        })) >= 8
      )
        return false
      await tx.shortProductionCall.create({
        data: {
          runId: run.id,
          key,
          inputDigest,
          reserveMicros: 0n,
          state: "COMPLETED",
          result: {
            assets: [],
            actualCostMicros: 0,
            credits: null,
            requestId: null,
            elapsedMs: 0,
            diagnostic,
            providerMetadata: {
              diagnosticOnly: true,
              phase: "runner-observation",
              providerDispatched: false,
              recovery:
                "Resume the original narration idempotency key. Inspect existing speech claims; RUNNING or AMBIGUOUS calls must not be redispatched.",
            },
          },
        },
      })
      return true
    })
    return {
      recorded,
      outcome: "RECONCILIATION_REQUIRED",
      run: await execution.read(worker, run.id),
    }
  }
  switch (request.command) {
    case "reconciliation-note": {
      if (!delegatedPlan)
        throw new StudioBoundaryError("Delegated narration admission required")
      return recordReconciliationNote(
        z.string().min(1).max(2000).parse(input.diagnostic),
      )
    }
    case "preflight-error": {
      const diagnostic = z.string().min(1).max(2000).parse(input.diagnostic)
      if (delegatedPlan) return recordReconciliationNote(diagnostic)
      const inputDigest = studioHash({ phase: "preflight", diagnostic }),
        key = `preflight-${inputDigest}`
      const claim = await execution.claim(worker, {
        runId: run.id,
        key,
        inputDigest,
        reserveMicros: 0,
      })
      if (!claim.execute) return { recorded: true }
      return execution.finish(worker, {
        runId: run.id,
        key,
        state: "FAILED",
        result: {
          assets: [],
          actualCostMicros: 0,
          credits: null,
          requestId: null,
          elapsedMs: 0,
          diagnostic,
          providerMetadata: { phase: "preflight", providerDispatched: false },
        },
      })
    }
    case "fail": {
      if (!run.attemptId)
        throw new StudioBoundaryError("Narration attempt required")
      const attempt = await db.shortAttempt.findUniqueOrThrow({
        where: { id: run.attemptId },
      })
      return new StudioAuthoringService(db).complete(worker, {
        projectId: attempt.projectId,
        expectedRevision: attempt.baseRevision,
        attemptId: attempt.id,
        idempotencyKey: `${run.id}:failure`,
        status: "FAILED",
        operations: [],
        result: {
          assets: [],
          costMicros: null,
          diagnostic: z.string().max(2000).parse(input.diagnostic),
        },
      })
    }
    case "context": {
      const attempt = run.attemptId
        ? await db.shortAttempt.findUniqueOrThrow({
            where: { id: run.attemptId },
          })
        : null
      return {
        run: await execution.read(worker, run.id),
        narrationPlan: delegatedPlan,
        attempt,
        project: attempt
          ? await new StudioAuthoringService(db).readRevision(
              worker,
              attempt.projectId,
              attempt.baseRevision,
            )
          : null,
        experiment: run.experimentId
          ? await new StudioExperimentService(db).read(worker, run.experimentId)
          : null,
      }
    }
    case "claim":
      return execution.claim(worker, { ...input, runId: run.id })
    case "finish":
      return execution.finish(worker, { ...input, runId: run.id })
    case "upload":
      return new StudioTransferService(db).issue(worker, "upload", input)
    case "narration-complete": {
      if (!run.attemptId)
        throw new StudioBoundaryError("Narration admission required")
      const attempt = await db.shortAttempt.findUniqueOrThrow({
        where: { id: run.attemptId },
      })
      return new StudioNarrationService(db).complete(worker, {
        ...input,
        projectId: attempt.projectId,
        expectedRevision: attempt.baseRevision,
        attemptId: attempt.id,
      })
    }
    case "experiment-candidate": {
      if (!run.experimentId)
        throw new StudioBoundaryError("Experiment admission required")
      return new StudioExperimentService(db).addCandidate(worker, {
        ...input,
        experimentId: run.experimentId,
      })
    }
  }
}
