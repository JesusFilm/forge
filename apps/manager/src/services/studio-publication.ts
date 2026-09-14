import { z } from "zod"
import {
  studioApprovedReleaseSchema,
  studioPublicationCandidateSchema,
  studioScheduledPublicationPreparationSchema,
} from "@forge/studio-contracts/publication"
import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import { studioRenderClient } from "./studio-render-transport"
import { observeStudioMuxAsset } from "./studio-render-mux"
import {
  prepareStudioPublication,
  type StudioPublicationBinding,
} from "./studio-publication-prepare"

export const studioPublicationPreparationSchema = studioApprovedReleaseSchema
const muxSchema = z.object({
  id: z.string(),
  state: z.string(),
  assetId: z.string().nullable(),
})
const preparedSchema = z.object({
  releaseId: z.string(),
  readinessId: z.string(),
})
class StudioPreparationReadinessError extends Error {}

function prepareWithCandidate(
  input: StudioPublicationBinding,
  candidate: (input: StudioPublicationBinding) => Promise<unknown>,
  signal: AbortSignal,
) {
  const worker = studioRenderClient(signal)
  const check = async (
    binding: StudioPublicationBinding,
    readinessId?: string,
  ) => {
    const result = studioPublicationCandidateSchema.parse(
      await candidate(binding),
    )
    for (const field of [
      "projectId",
      "expectedRevision",
      "approvalId",
      "renderAttemptId",
      "releaseId",
    ] as const) {
      if (result[field] !== binding[field])
        throw new StudioPreparationReadinessError("STALE_BINDING")
    }
    if (
      readinessId &&
      (result.readiness.id !== readinessId ||
        result.readiness.state !== "ready")
    )
      throw new StudioPreparationReadinessError("UNREADY")
  }
  return prepareStudioPublication(input, {
    eligible: (binding) => check(binding),
    ready: (binding, id) => check(binding, id),
    read: async (attemptId) =>
      muxSchema.parse(await worker.call("mux-read", attemptId)),
    observe: (assetId, intentId) =>
      observeStudioMuxAsset(assetId, intentId, signal),
    record: (id, evidence) => worker.call("mux-ready", { id, evidence }),
    stage: async (attemptId) =>
      preparedSchema.parse(await worker.call("mux-stage", attemptId)),
  })
}

/** Current interactive eligibility precedes and follows privileged observation. */
export function prepareInteractiveStudioPublication(
  call: StudioInteractiveClient,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = studioPublicationPreparationSchema.parse(raw)
  return prepareWithCandidate(
    input,
    (binding) => call("publication-candidate", binding),
    signal,
  )
}

/** Called only by the authenticated Admin preparation route. This returns an
 * envelope but never submits it. Calendar persists it before canonical publish. */
export async function prepareScheduledPublication(
  raw: unknown,
  signal: AbortSignal,
) {
  const input = studioScheduledPublicationPreparationSchema.parse(raw)
  const worker = studioRenderClient(signal)
  const prepared = await prepareWithCandidate(
    {
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      approvalId: input.approvalId,
      renderAttemptId: input.renderAttemptId,
      releaseId: input.releaseId,
    },
    (binding) => worker.call("publication-candidate", binding),
    signal,
  )
  return { ...input, readinessId: prepared.readinessId }
}
