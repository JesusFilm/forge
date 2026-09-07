import { StudioPublicationReadinessResolver } from "./publication-readiness-resolver"
import { reconcileStudioWatch } from "./watch-delivery"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { studioIdSchema } from "@forge/studio-contracts"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { StudioMuxJobs, studioMuxJobSnapshot } from "./mux-jobs"
import { StudioCatalogService } from "./catalog"
import { StudioCatalogReadinessService } from "./catalog-readiness"
import { StudioCommandError } from "./errors"
import { studioHash } from "./state"
import { studioCatalogReadinessProofSchema } from "@forge/studio-contracts/publication-state"
import { StudioRenderJobs } from "./render-jobs"
import { executeStudioRpc } from "./interactive"

export const studioRenderRpcSchema = z
  .object({
    action: z.literal("render-worker"),
    command: z.enum([
      "publication-candidate",
      "watch-reconcile",
      "mux-pending",
      "mux-enqueue",
      "mux-read",
      "mux-claim",
      "mux-created",
      "mux-ambiguous",
      "mux-ready",
      "mux-stage",
      "pending",
      "enqueue",
      "context",
      "claim",
      "finish",
      "owns",
      "asset",
      "asset-read",
      "asset-upload",
      "preview-sources",
      "source",
    ]),
    input: z.unknown(),
  })
  .strict()

/** Server-only durable dispatcher capability. It can execute admitted private
 * renders and retain output, but cannot approve, publish or confirm experiments.
 * This service subject is deliberately not an attributed interactive user. */
export async function executeStudioRender(
  db: PrismaClient,
  caller: StudioCaller,
  raw: unknown,
) {
  if (
    caller.authority !== "delegated" ||
    caller.clientId !== "studio-render" ||
    caller.sub !== "studio-render-worker" ||
    !caller.scopes.includes("studio:render:execute")
  )
    throw new StudioBoundaryError("Trusted render execution required")
  const request = studioRenderRpcSchema.parse(raw)
  const worker = { id: null, role: "MANAGER_BACKEND" as const },
    jobs = new StudioRenderJobs(db)
  const muxJobs = new StudioMuxJobs(db)
  switch (request.command) {
    case "publication-candidate":
      return new StudioPublicationReadinessResolver(db).candidate(
        worker,
        request.input,
      )
    case "watch-reconcile":
      return reconcileStudioWatch(db)
    case "mux-pending":
      return muxJobs.pending(
        worker,
        request.input == null
          ? undefined
          : z
              .object({ createdAt: z.iso.datetime(), id: studioIdSchema })
              .strict()
              .parse(request.input),
      )
    case "mux-enqueue":
      return muxJobs.enqueue(worker, studioIdSchema.parse(request.input))
    case "mux-read":
      return muxJobs.read(worker, studioIdSchema.parse(request.input))
    case "mux-claim":
      return muxJobs.claim(worker, studioIdSchema.parse(request.input))
    case "mux-created": {
      const input = z
        .object({
          id: studioIdSchema,
          dispatchId: z.uuid(),
          assetId: studioIdSchema,
        })
        .strict()
        .parse(request.input)
      return muxJobs.created(worker, input.id, input.dispatchId, input.assetId)
    }
    case "mux-ambiguous": {
      const input = z
        .object({ id: studioIdSchema, dispatchId: z.uuid() })
        .strict()
        .parse(request.input)
      return muxJobs.ambiguous(worker, input.id, input.dispatchId)
    }
    case "mux-ready": {
      const input = z
        .object({ id: studioIdSchema, evidence: z.unknown() })
        .strict()
        .parse(request.input)
      return muxJobs.ready(worker, input.id, input.evidence)
    }
    case "mux-stage": {
      const job = await muxJobs.read(
        worker,
        studioIdSchema.parse(request.input),
      )
      if (!job || job.state !== "READY") throw new StudioCommandError("UNREADY")
      const { manifest, codecProof, leaseId } = studioMuxJobSnapshot(job)
      const evidence = z
        .object({
          observedAt: z.iso.datetime(),
          proof: studioCatalogReadinessProofSchema.shape.mux,
        })
        .parse(job.readiness)
      const release = await new StudioCatalogService(db).stage(worker, {
        projectId: manifest.projectId,
        expectedRevision: manifest.revision,
        idempotencyKey: `mux-stage:${job.id}`,
        renderAttemptId: job.attemptId,
        mux: {
          assetId: evidence.proof.assetId,
          playbackId: evidence.proof.playbackId,
          policy: "signed",
          status: "ready",
        },
      })
      const readiness = await new StudioCatalogReadinessService(db).record(
        worker,
        {
          id: `mux-ready:${job.id}:${studioHash(evidence).slice(0, 24)}`,
          releaseId: release.id,
          attemptId: job.attemptId,
          leaseId,
          proof: {
            output: manifest.output,
            codecProof,
            observedAt: evidence.observedAt,
            mux: evidence.proof,
          },
        },
      )
      return {
        releaseId: release.id,
        readinessId: readiness.id,
        observedAt: evidence.observedAt,
      }
    }
    case "pending":
      return jobs.pending(worker)
    case "enqueue":
      return jobs.enqueue(worker, studioIdSchema.parse(request.input))
    case "context":
      return jobs.read(worker, studioIdSchema.parse(request.input))
    case "claim":
      return jobs.claim(
        worker,
        studioIdSchema.parse(request.input),
        STUDIO_RENDER_PROFILE.leaseMs,
      )
    case "finish":
      return jobs.finish(worker, request.input)
    case "owns": {
      const input = z
        .object({ attemptId: studioIdSchema, leaseId: z.uuid() })
        .strict()
        .parse(request.input)
      return jobs.owns(worker, input.attemptId, input.leaseId)
    }
    default:
      return executeStudioRpc(db, worker, {
        action: request.command,
        input: request.input,
      })
  }
}
