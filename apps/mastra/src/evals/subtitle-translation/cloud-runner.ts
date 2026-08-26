import corpusLockJson from "../../../evals/subtitle-translation/corpus.lock.json"
import manifestJson from "../../../evals/subtitle-translation/manifest.json"

import { env, getOpenRouterApiKey } from "../../config/env"
import { OPENROUTER_SUBTITLE_TEMPERATURE } from "../../services/subtitle-enrichment/openrouter"
import { SubtitleProviderError } from "../../services/subtitle-enrichment/types"
import { sha256 } from "./corpus"
import { compareSubtitleCues } from "./metrics"
import { buildSubtitleReviewEvidence } from "./review-evidence"
import {
  runSubtitleEvalCell,
  providerCallsFromError,
  type RunSubtitleEvalCellInput,
  type RunSubtitleEvalCellResult,
} from "./runner"
import {
  SUBTITLE_EVAL_MAX_CANDIDATE_BYTES,
  SUBTITLE_EVAL_MAX_CUES_PER_TRACK,
  SUBTITLE_EVAL_MAX_SNAPSHOT_BYTES,
  SubtitleEvalCloudCellRequestSchema,
  SubtitleEvalCloudResultSchema,
  SubtitleEvalCorpusLockSchema,
  SubtitleEvalManifestSchema,
  SubtitleEvalCloudUsageSchema,
  type SubtitleEvalCloudCellRequest,
  type SubtitleEvalCloudResult,
  type SubtitleEvalCorpusLock,
  type SubtitleEvalManifest,
  type SubtitleEvalProviderCall,
  type SubtitleEvalTrackLock,
} from "./types"
import { parseVtt, type VttCue } from "./vtt"
import {
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
  SUBTITLE_EVAL_WORKFLOW_POLICY_FILES,
} from "./workflow-policy"

export {
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
  SUBTITLE_EVAL_WORKFLOW_POLICY_FILES,
} from "./workflow-policy"

export const SUBTITLE_EVAL_MANIFEST_DIGEST =
  "e0b10ce064e93afc94c8bd6c549262b02abe032ef9098873f60ae2a03e37ced5"
export const SUBTITLE_EVAL_LOCK_DIGEST =
  "dc0a4fc55e00361b9e58b3c59699a5fe17ddcc0b74cd60646db4b7b4b9c195de"
export const SUBTITLE_EVAL_PROMPT_POLICY_ID =
  "subtitle-enrichment-production-v1"
export const SUBTITLE_EVAL_ALLOWED_MODELS = ["google/gemini-2.5-flash"] as const

const MAX_REVIEW_EVIDENCE_BYTES = 2 * 1024 * 1024
const TRACK_TIMING_EPSILON_SECONDS = 0.05

export type SubtitleEvalCloudPolicy = {
  manifest: SubtitleEvalManifest
  manifestDigest: string
  lock: SubtitleEvalCorpusLock
  lockDigest: string
  allowedModels: readonly string[]
  allowedPromptPolicyIds: readonly string[]
  allowedWorkflowPolicyDigests: readonly string[]
}

type ExecuteCell = (
  input: RunSubtitleEvalCellInput,
) => Promise<
  Pick<RunSubtitleEvalCellResult, "candidateVtt" | "usage" | "providerCalls"> &
    Partial<Pick<RunSubtitleEvalCellResult, "metrics">>
>

export type SubtitleEvalCloudRunnerDeps = {
  policy?: SubtitleEvalCloudPolicy
  apiKey?: string
  executeCell?: ExecuteCell
  buildIdentity?: SubtitleEvalBuildIdentity
}

export type SubtitleEvalBuildIdentity = {
  codeRevision: string
  buildId: string
}

class CloudPreflightError extends Error {
  constructor(
    readonly reason:
      | "identity_mismatch"
      | "unsupported_case"
      | "unsupported_language"
      | "unsupported_provider"
      | "unsupported_model"
      | "unsupported_prompt_policy"
      | "unsupported_workflow_policy"
      | "budget_exceeded"
      | "payload_too_large",
    message: string,
  ) {
    super(message)
    this.name = "CloudPreflightError"
  }
}

export async function loadPackagedSubtitleEvalPolicy(): Promise<SubtitleEvalCloudPolicy> {
  const manifest = SubtitleEvalManifestSchema.parse(manifestJson)
  const lock = SubtitleEvalCorpusLockSchema.parse(corpusLockJson)
  return {
    manifest,
    manifestDigest: SUBTITLE_EVAL_MANIFEST_DIGEST,
    lock,
    lockDigest: SUBTITLE_EVAL_LOCK_DIGEST,
    allowedModels: SUBTITLE_EVAL_ALLOWED_MODELS,
    allowedPromptPolicyIds: [SUBTITLE_EVAL_PROMPT_POLICY_ID],
    allowedWorkflowPolicyDigests: [SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST],
  }
}

export async function runCloudSubtitleEvalCell(
  rawInput: unknown,
  deps: SubtitleEvalCloudRunnerDeps = {},
): Promise<SubtitleEvalCloudResult> {
  const parsed = SubtitleEvalCloudCellRequestSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", undefined, {
      failureClass: "deterministic",
      message: "Subtitle evaluation cell input failed validation.",
    })
  }
  const input = parsed.data
  const policy = deps.policy ?? (await loadPackagedSubtitleEvalPolicy())

  let preflight: PreflightResult
  try {
    preflight = preflightCell(input, policy)
  } catch (error) {
    if (error instanceof CloudPreflightError) {
      return failure(error.reason, input.cellId, {
        failureClass: "deterministic",
        message: preflightMessage(error.reason),
      })
    }
    return failure("identity_mismatch", input.cellId, {
      failureClass: "deterministic",
      message: "Frozen subtitle identity did not match the packaged corpus.",
    })
  }

  const executeCell = deps.executeCell ?? runSubtitleEvalCell
  let buildIdentity: SubtitleEvalBuildIdentity
  try {
    buildIdentity = normalizeBuildIdentity(
      deps.buildIdentity ?? loadSubtitleEvalBuildIdentity(),
    )
  } catch {
    return failure("identity_mismatch", input.cellId, {
      failureClass: "deterministic",
      message: "Deployment build identity is unavailable.",
    })
  }
  const apiKey = deps.apiKey ?? getOpenRouterApiKey()
  if (!deps.executeCell && !apiKey) {
    return failure("provider_config_missing", input.cellId, {
      failureClass: "permanent",
      message: "Subtitle evaluation provider configuration is unavailable.",
    })
  }

  let execution: Awaited<ReturnType<ExecuteCell>>
  try {
    execution = await executeCell({
      cellId: input.cellId,
      sourceLanguage: policy.manifest.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceVtt: input.source.body,
      referenceVtt: input.reference.body,
      clipStartSeconds: preflight.benchmarkCase.clip.startSeconds,
      clipEndSeconds: preflight.benchmarkCase.clip.endSeconds,
      model: input.model,
      apiKey,
      timeoutMs: input.timeoutMs,
      translationContext: preflight.benchmarkCase.translationContext,
    })
  } catch (error) {
    return providerOrExecutionFailure(error, input.cellId)
  }

  const providerCalls = execution.providerCalls
  const resolvedModels = Array.from(
    new Set(
      providerCalls
        .map((call) => call.resolvedModel)
        .filter((model): model is string => model != null),
    ),
  )
  const resolvedModel = resolvedModels.length === 1 ? resolvedModels[0]! : null

  let candidateCues: VttCue[]
  let metrics: ReturnType<typeof compareSubtitleCues>
  let reviewEvidence: ReturnType<typeof buildSubtitleReviewEvidence>
  try {
    const candidateBytes = utf8Bytes(execution.candidateVtt)
    if (candidateBytes.byteLength > SUBTITLE_EVAL_MAX_CANDIDATE_BYTES) {
      throw new Error("candidate_too_large")
    }
    candidateCues = parseVtt(execution.candidateVtt, {
      emptyCue: "preserve",
    })
    if (candidateCues.length > SUBTITLE_EVAL_MAX_CUES_PER_TRACK) {
      throw new Error("candidate_has_too_many_cues")
    }
    metrics = compareSubtitleCues({
      source: preflight.sourceCues,
      reference: preflight.referenceCues,
      generated: candidateCues,
      clipStartSeconds: preflight.benchmarkCase.clip.startSeconds,
      clipEndSeconds: preflight.benchmarkCase.clip.endSeconds,
    })
    reviewEvidence = buildSubtitleReviewEvidence({
      locale: input.targetLanguage,
      source: preflight.sourceCues,
      reference: preflight.referenceCues,
      candidate: candidateCues,
    })
  } catch {
    return failure("scoring_failed", input.cellId, {
      failureClass: "deterministic",
      message: "Generated subtitles could not be scored safely.",
      providerCalls,
    })
  }

  try {
    const candidateBytes = utf8Bytes(execution.candidateVtt)
    const reviewEvidenceJson = canonicalJson(reviewEvidence)
    const reviewEvidenceBytes = utf8Bytes(reviewEvidenceJson)
    if (reviewEvidenceBytes.byteLength > MAX_REVIEW_EVIDENCE_BYTES) {
      return failure("serialization_failed", input.cellId, {
        failureClass: "deterministic",
        message: "Review evidence exceeded the bounded result contract.",
        providerCalls,
      })
    }
    const result = {
      ok: true as const,
      schemaVersion: "subtitle-translation-eval-cell-result/v1" as const,
      identityAttestation: {
        cellId: input.cellId,
        caseId: input.caseId,
        manifestDigest: input.manifestDigest,
        lockDigest: input.lockDigest,
        targetLanguage: input.targetLanguage,
        sourceSha256: input.source.sha256,
        referenceSha256: input.reference.sha256,
        sourceSubtitleId: preflight.sourceTrack.subtitleId,
        referenceSubtitleId: preflight.referenceTrack.subtitleId,
      },
      provider: {
        name: "openrouter" as const,
        requestedModel: input.model,
        resolvedModel,
      },
      providerCalls,
      policy: {
        promptPolicyId: input.promptPolicyId,
        workflowPolicyDigest: input.workflowPolicyDigest,
        workflowPolicyFiles: SUBTITLE_EVAL_WORKFLOW_POLICY_FILES,
      },
      build: buildIdentity,
      determinism: {
        temperature: OPENROUTER_SUBTITLE_TEMPERATURE,
        providerSeed: null,
        concurrency: 1 as const,
      },
      runtime: { timeoutMs: input.timeoutMs, concurrency: 1 as const },
      usage: SubtitleEvalCloudUsageSchema.parse(execution.usage),
      metrics,
      reviewEvidence,
      artifacts: {
        candidateVtt: {
          sha256: sha256(candidateBytes),
          byteLength: candidateBytes.byteLength,
          mediaType: "text/vtt" as const,
          body: execution.candidateVtt,
        },
        reviewEvidence: {
          sha256: sha256(reviewEvidenceBytes),
          byteLength: reviewEvidenceBytes.byteLength,
          mediaType: "application/json" as const,
          body: reviewEvidenceJson,
        },
      },
      reproducibilityLimits: [
        ...(resolvedModel == null
          ? [
              "OpenRouter did not expose one unambiguous provider-resolved model across all calls.",
            ]
          : []),
        "Temperature is pinned to zero, but OpenRouter does not expose a provider seed; output bytes are not guaranteed deterministic.",
        "API.Bible scripture lookups are external evidence retrieval and are not included in the OpenRouter provider-call identity ledger.",
        "Automatic metrics are diagnostic and do not constitute human approval.",
      ],
    }
    return SubtitleEvalCloudResultSchema.parse(result)
  } catch {
    return failure("serialization_failed", input.cellId, {
      failureClass: "deterministic",
      message: "Subtitle evaluation result failed serialization validation.",
      providerCalls,
    })
  }
}

export function loadSubtitleEvalBuildIdentity(
  source: {
    nodeEnv: "development" | "test" | "production"
    railwayRevision?: string
    gitRevision?: string
    deploymentId?: string
  } = {
    nodeEnv: env.NODE_ENV,
    railwayRevision: env.RAILWAY_GIT_COMMIT_SHA,
    gitRevision: env.GIT_COMMIT_SHA,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID,
  },
): SubtitleEvalBuildIdentity {
  const revision = (source.railwayRevision ?? source.gitRevision)?.trim()
  if (
    (!revision || revision === "unknown") &&
    source.nodeEnv === "production"
  ) {
    throw new Error("Subtitle evaluation requires a deployed code revision")
  }
  return normalizeBuildIdentity({
    codeRevision:
      revision && revision !== "unknown" ? revision : "local-development",
    buildId: source.deploymentId ?? "local-development",
  })
}

function normalizeBuildIdentity(
  identity: SubtitleEvalBuildIdentity,
): SubtitleEvalBuildIdentity {
  return {
    codeRevision: boundedBuildValue(identity.codeRevision),
    buildId: boundedBuildValue(identity.buildId),
  }
}

function boundedBuildValue(value: string): string {
  const normalized = value.trim().slice(0, 128)
  return normalized || "unknown"
}

type PreflightResult = {
  benchmarkCase: SubtitleEvalManifest["cases"][number]
  sourceTrack: SubtitleEvalTrackLock
  referenceTrack: SubtitleEvalTrackLock
  sourceCues: VttCue[]
  referenceCues: VttCue[]
}

function preflightCell(
  input: SubtitleEvalCloudCellRequest,
  policy: SubtitleEvalCloudPolicy,
): PreflightResult {
  if (
    input.manifestDigest !== policy.manifestDigest ||
    input.lockDigest !== policy.lockDigest ||
    policy.lock.manifestSha256 !== policy.manifestDigest
  ) {
    throw new CloudPreflightError("identity_mismatch", "digest mismatch")
  }
  const benchmarkCase = policy.manifest.cases.find(
    (candidate) => candidate.id === input.caseId,
  )
  if (!benchmarkCase) {
    throw new CloudPreflightError("unsupported_case", "case not allowlisted")
  }
  if (!policy.manifest.targetLanguages.includes(input.targetLanguage)) {
    throw new CloudPreflightError(
      "unsupported_language",
      "language not allowlisted",
    )
  }
  if (input.provider !== "openrouter") {
    throw new CloudPreflightError(
      "unsupported_provider",
      "provider not allowlisted",
    )
  }
  if (!policy.allowedModels.includes(input.model)) {
    throw new CloudPreflightError("unsupported_model", "model not allowlisted")
  }
  if (!policy.allowedPromptPolicyIds.includes(input.promptPolicyId)) {
    throw new CloudPreflightError(
      "unsupported_prompt_policy",
      "prompt policy not allowlisted",
    )
  }
  if (
    !policy.allowedWorkflowPolicyDigests.includes(input.workflowPolicyDigest)
  ) {
    throw new CloudPreflightError(
      "unsupported_workflow_policy",
      "workflow policy not allowlisted",
    )
  }
  if (input.timeoutMs < 60_000 || input.timeoutMs > 600_000) {
    throw new CloudPreflightError("budget_exceeded", "timeout outside ceiling")
  }

  const sourceTrack = requirePolicyTrack(
    policy.lock.tracks,
    input.caseId,
    policy.manifest.sourceLanguage,
  )
  const referenceTrack = requirePolicyTrack(
    policy.lock.tracks,
    input.caseId,
    input.targetLanguage,
  )
  const sourceCues = validateSnapshot(
    input.source,
    sourceTrack,
    benchmarkCase.clip,
  )
  const referenceCues = validateSnapshot(
    input.reference,
    referenceTrack,
    benchmarkCase.clip,
  )
  return {
    benchmarkCase,
    sourceTrack,
    referenceTrack,
    sourceCues,
    referenceCues,
  }
}

function validateSnapshot(
  snapshot: SubtitleEvalCloudCellRequest["source"],
  lockedTrack: SubtitleEvalTrackLock,
  clip: SubtitleEvalManifest["cases"][number]["clip"],
): VttCue[] {
  const bytes = utf8Bytes(snapshot.body)
  if (
    bytes.byteLength > SUBTITLE_EVAL_MAX_SNAPSHOT_BYTES ||
    snapshot.byteLength !== bytes.byteLength
  ) {
    throw new CloudPreflightError("payload_too_large", "snapshot size mismatch")
  }
  const actualDigest = sha256(bytes)
  if (
    snapshot.mediaType !== "text/vtt" ||
    snapshot.sha256 !== actualDigest ||
    snapshot.sha256 !== lockedTrack.clippedSha256 ||
    snapshot.rawSha256 !== lockedTrack.sourceSha256 ||
    (snapshot.clippedSha256 != null &&
      snapshot.clippedSha256 !== lockedTrack.clippedSha256) ||
    !trackIdentityMatches(snapshot.track, lockedTrack)
  ) {
    throw new CloudPreflightError("identity_mismatch", "track mismatch")
  }
  let cues: VttCue[]
  try {
    cues = parseVtt(snapshot.body, { emptyCue: "reject" })
  } catch {
    throw new CloudPreflightError("identity_mismatch", "invalid locked VTT")
  }
  if (
    cues.length !== lockedTrack.cueCount ||
    cues.length > SUBTITLE_EVAL_MAX_CUES_PER_TRACK ||
    cues.some(
      (cue) =>
        cue.start < clip.startSeconds - TRACK_TIMING_EPSILON_SECONDS ||
        cue.end > clip.endSeconds + TRACK_TIMING_EPSILON_SECONDS,
    )
  ) {
    throw new CloudPreflightError("identity_mismatch", "cue identity mismatch")
  }
  return cues
}

function trackIdentityMatches(
  supplied: SubtitleEvalCloudCellRequest["source"]["track"],
  locked: SubtitleEvalTrackLock,
): boolean {
  return (
    supplied.role === locked.role &&
    supplied.language === locked.language &&
    supplied.coreLanguageId === locked.coreLanguageId &&
    supplied.subtitleId === locked.subtitleId &&
    supplied.videoId === locked.videoId &&
    supplied.edition === locked.edition &&
    supplied.coreVideoEditionId === locked.coreVideoEditionId &&
    supplied.cueCount === locked.cueCount
  )
}

function requirePolicyTrack(
  tracks: readonly SubtitleEvalTrackLock[],
  caseId: string,
  language: string,
): SubtitleEvalTrackLock {
  const track = tracks.find(
    (candidate) =>
      candidate.caseId === caseId && candidate.language === language,
  )
  if (!track) {
    throw new CloudPreflightError(
      "identity_mismatch",
      "locked track unavailable",
    )
  }
  return track
}

function providerOrExecutionFailure(
  error: unknown,
  cellId: string,
): SubtitleEvalCloudResult {
  const providerCalls = providerCallsFromError(error)
  if (error instanceof SubtitleProviderError || isProviderErrorLike(error)) {
    const reason = error.reason
    const retryable = error.retryable
    return failure(reason, cellId, {
      failureClass: retryable ? "retryable" : "permanent",
      message: providerFailureMessage(reason),
      providerCalls,
    })
  }
  return failure("execution_failed", cellId, {
    failureClass: "retryable",
    message: "Subtitle evaluation execution failed.",
    providerCalls,
  })
}

function isProviderErrorLike(error: unknown): error is {
  reason:
    | "provider_config_missing"
    | "provider_auth_failed"
    | "provider_failed"
    | "provider_invalid_output"
  retryable: boolean
} {
  return (
    typeof error === "object" &&
    error != null &&
    "reason" in error &&
    [
      "provider_config_missing",
      "provider_auth_failed",
      "provider_failed",
      "provider_invalid_output",
    ].includes(String(error.reason)) &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  )
}

function failure(
  reason: Exclude<SubtitleEvalCloudResult, { ok: true }>["reason"],
  cellId: string | undefined,
  options: {
    failureClass: "deterministic" | "retryable" | "permanent"
    message: string
    providerCalls?: SubtitleEvalProviderCall[]
  },
): SubtitleEvalCloudResult {
  return SubtitleEvalCloudResultSchema.parse({
    ok: false,
    ...(cellId ? { cellId } : {}),
    reason,
    failureClass: options.failureClass,
    retryable: options.failureClass === "retryable",
    message: options.message,
    providerCalls: options.providerCalls ?? [],
  })
}

function preflightMessage(reason: CloudPreflightError["reason"]): string {
  switch (reason) {
    case "unsupported_case":
      return "Subtitle evaluation case is not allowlisted."
    case "unsupported_language":
      return "Subtitle evaluation language is not allowlisted."
    case "unsupported_provider":
      return "Subtitle evaluation provider is not allowlisted."
    case "unsupported_model":
      return "Subtitle evaluation model is not allowlisted."
    case "unsupported_prompt_policy":
      return "Subtitle evaluation prompt policy is not allowlisted."
    case "unsupported_workflow_policy":
      return "Subtitle evaluation workflow policy is not allowlisted."
    case "budget_exceeded":
      return "Subtitle evaluation runtime budget exceeded its ceiling."
    case "payload_too_large":
      return "Frozen subtitle snapshot exceeded its byte ceiling."
    case "identity_mismatch":
      return "Frozen subtitle identity did not match the packaged corpus."
  }
}

function providerFailureMessage(
  reason:
    | "provider_config_missing"
    | "provider_auth_failed"
    | "provider_failed"
    | "provider_invalid_output",
): string {
  switch (reason) {
    case "provider_config_missing":
      return "Subtitle evaluation provider configuration is unavailable."
    case "provider_auth_failed":
      return "Subtitle evaluation provider authorization failed."
    case "provider_failed":
      return "Subtitle provider execution failed."
    case "provider_invalid_output":
      return "Subtitle provider returned invalid output."
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value == null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
