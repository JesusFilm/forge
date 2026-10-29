import { getAdminManagerServiceBearer } from "@/lib/admin-manager-session"
import { AdminGraphqlClient } from "@/backend/admin-client"
import { env } from "@/config/env"
import { getJob, mergeJobArtifacts } from "@/lib/state"
import { hasReadyEnrichmentNamespace } from "@/lib/enrichment-artifact-namespace"
import { getJobArtifactStorageAssetId } from "@/lib/job-artifacts"
import {
  executionDigest,
  EXECUTION_BODY_MAX_BYTES,
  type ExecutionRequest,
  type ExecutionClaimInput,
  type ExecutionCompleteInput,
  type ExecutionClaimResult,
} from "./enrichment-execution-contract"
import type { JobRecord } from "@/types/job"

type ExecutionDeps = {
  getJob: (id: string) => Promise<JobRecord | null>
  claim: (input: ExecutionClaimInput) => Promise<ExecutionClaimResult>
  complete: (input: ExecutionCompleteInput) => Promise<ExecutionClaimResult>
  perform?: (input: ExecutionRequest, job: JobRecord) => Promise<unknown>
}
function defaultDeps(): ExecutionDeps {
  if (!env.ADMIN_GRAPHQL_URL)
    throw new Error("Admin execution ledger is required")
  const admin = new AdminGraphqlClient({
    graphqlUrl: env.ADMIN_GRAPHQL_URL,
    getApiKey: getAdminManagerServiceBearer,
  })
  return {
    getJob,
    claim: (input) => admin.claimManagerExecutionOperation(input),
    complete: (input) => admin.completeManagerExecutionOperation(input),
    perform: performEnrichmentOperation,
  }
}

export async function executeEnrichmentOperation(
  input: ExecutionRequest,
  dependencies?: ExecutionDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const deps = dependencies ?? defaultDeps()
    const job = await deps.getJob(input.jobId)
    // This preliminary check supplies canonical targets. Admin's atomic claim is
    // the authority; a read/check here alone cannot authorize side effects.
    if (
      !job ||
      job.options.engine !== "mastra" ||
      job.options.currentRunId !== input.runId ||
      job.status !== "running"
    )
      return { status: 409, body: { error: "stale_run" } }
    if (
      input.operation.kind === "run-admission" &&
      (!hasReadyEnrichmentNamespace(job) ||
        input.operation.assetId !== getJobArtifactStorageAssetId(job) ||
        input.operation.muxAssetId !== job.muxAssetId)
    )
      return { status: 400, body: { error: "asset_mismatch" } }
    if (
      input.operation.kind === "run-admission" &&
      input.operation.sourceReuse !== "none" &&
      (!job.options.enrichmentArtifacts?.sourceVerified ||
        job.artifacts[input.operation.sourceReuse]?.kind !== "downloadable")
    )
      return { status: 400, body: { error: "unverified_source_reuse" } }
    if (input.operation.kind === "mux-publication") {
      const languages = new Set(
        [...job.languages, ...(job.resolvedTargetLanguageCodes ?? [])].map(
          (lang) => lang.toLowerCase(),
        ),
      )
      if (
        !input.operation.languageResults.every((result) =>
          languages.has(result.lang.toLowerCase()),
        )
      )
        return { status: 400, body: { error: "unowned_language" } }
    }
    const stageOperation =
      input.operation.kind === "mastra-stage-claim" ||
      input.operation.kind === "mastra-stage-complete"
        ? input.operation
        : undefined
    const claimInput: ExecutionClaimInput = {
      jobId: input.jobId,
      runId: input.runId,
      inputDigest: input.inputDigest,
      operationId: stageOperation
        ? `mastra:${stageOperation.stage}`
        : input.operation.kind,
      operationDigest: stageOperation
        ? stageOperation.stageDigest
        : executionDigest(input.operation),
    }
    if (input.operation.kind === "mastra-stage-complete") {
      // The preliminary owner check above and Admin's transaction-held owner
      // check both apply to completion. Never claim a new operation here.
      const completed = await deps.complete({
        ...claimInput,
        claimToken: input.operation.claimToken,
        result: input.operation.result,
      })
      return completed.status === "replayed"
        ? { status: 200, body: { ok: true, result: completed } }
        : { status: 409, body: { error: completed.status } }
    }
    const claim = await deps.claim(claimInput)
    if (claim.status === "replayed") {
      if (
        Buffer.byteLength(JSON.stringify(claim.result)) >
        EXECUTION_BODY_MAX_BYTES - 1024
      )
        return { status: 503, body: { error: "replayed_result_too_large" } }
      return {
        status: 200,
        body: {
          ok: true,
          replayed: true,
          result:
            input.operation.kind === "mastra-stage-claim"
              ? claim
              : claim.result,
        },
      }
    }
    if (claim.status !== "claimed" || !claim.claimToken)
      return { status: 409, body: { error: claim.status } }
    if (input.operation.kind === "mastra-stage-claim")
      return { status: 200, body: { ok: true, result: claim } }
    // New run ownership is blocked by Admin until completion; crashes leave the
    // operation consumed. Never release/retry a possibly-spent operation.
    const result = await (deps.perform ?? performEnrichmentOperation)(
      input,
      job,
    )
    if (
      Buffer.byteLength(JSON.stringify(result)) >
      EXECUTION_BODY_MAX_BYTES - 1024
    )
      return { status: 503, body: { error: "ambiguous_result_too_large" } }
    const completed = await deps.complete({
      ...claimInput,
      claimToken: claim.claimToken,
      result,
    })
    if (completed.status !== "replayed")
      return { status: 503, body: { error: "ambiguous_completion" } }
    return { status: 200, body: { ok: true, replayed: false, result } }
  } catch {
    return {
      status: 503,
      body: {
        error: "execution_unavailable_or_ambiguous",
        recovery:
          "Reconcile the consumed operation before creating another run",
      },
    }
  }
}

async function performEnrichmentOperation(
  input: ExecutionRequest,
  job: JobRecord,
): Promise<unknown> {
  const assetId = getJobArtifactStorageAssetId(job)
  switch (input.operation.kind) {
    case "mastra-stage-claim":
    case "mastra-stage-complete":
      throw new Error("Stage fencing does not execute Manager side effects")
    case "run-admission":
      return { admitted: true }
    case "audio-cleanup": {
      if (!env.ELEVENLABS_API_KEY)
        return {
          ok: false,
          error: "Audio cleanup requires ELEVENLABS_API_KEY",
          artifactKeys: [],
        }
      const { cleanupAudioForReview } = await import("@/services/audioCleanup")
      return cleanupAudioForReview({
        assetId,
        muxAssetId: job.muxAssetId,
        ...(job.muxPlaybackId ? { playbackId: job.muxPlaybackId } : {}),
      })
    }
    case "apply-transcript-corrections": {
      const { applyStoredTranscriptCorrections } =
        await import("@/services/enrichment-execution-corrections")
      return applyStoredTranscriptCorrections(
        assetId,
        input.operation.correction,
      )
    }
    case "mux-publication": {
      const { syncTranslatedSubtitlesToMux } =
        await import("@/services/mux-sync")
      const { getMuxSyncReport, setMuxSyncReport } =
        await import("@/lib/mux-sync-report")
      const report = await syncTranslatedSubtitlesToMux({
        jobId: job.id,
        assetId,
        muxAssetId: job.muxAssetId,
        translationResults: input.operation.languageResults,
        previousReport: getMuxSyncReport(job.artifacts),
      })
      // Preserve the report even when the graph must fail a comparison later.
      if (!(await mergeJobArtifacts(job.id, setMuxSyncReport({}, report))))
        throw new Error("Mux report persistence failed")
      return { report }
    }
  }
}
