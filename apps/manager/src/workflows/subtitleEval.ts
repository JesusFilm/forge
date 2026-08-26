import type {
  MastraSubtitleEvalProviderCall,
  MastraSubtitleEvalResult,
} from "@/services/mastra-subtitle-eval"
import { buildSourceReferenceDigestVector } from "@/features/subtitle-lab/subtitle-eval-digest-vector"

export type SubtitleEvalWorkflowTrack = {
  role: "source" | "reference"
  language: string
  coreLanguageId: string
  subtitleId: string
  videoId: string
  edition: string
  coreVideoEditionId: string
  cueCount: number
}

export type SubtitleEvalWorkflowSnapshot = {
  objectKey: string
  sha256: string
  rawSha256: string
  clippedSha256: string
  byteLength: number
  track: SubtitleEvalWorkflowTrack
}

export type SubtitleEvalWorkflowCell = {
  runCellId: string
  corpusCellId: string
  caseId: string
  collectionKey: string
  targetLanguageId: string
  targetLanguageSlug: string
  targetBcp47: string
  source: SubtitleEvalWorkflowSnapshot
  reference: SubtitleEvalWorkflowSnapshot
}

export type SubtitleEvalWorkflowInput = {
  runId: string
  corpusIdentityDigest: string
  manifestDigest: string
  lockDigest: string
  requestedProvider: "openrouter"
  requestedModel: string
  promptPolicyId: string
  workflowPolicyDigest: string
  codeRevision: string
  timeoutSeconds: number
  maxAttempts: number
  concurrency: number
  cells: SubtitleEvalWorkflowCell[]
}

type AdminProviderCall = Omit<MastraSubtitleEvalProviderCall, "operation"> & {
  operation:
    | "SCRIPTURE_DETECTION"
    | "TRANSLATION"
    | "RETIMING"
    | "SCRIPTURE_VALIDATION"
}

export type SubtitleEvalCellExecutionDeps = {
  claimCell(
    runCellId: string,
    leaseSeconds: number,
  ): Promise<{
    status?: string | null
    digest?: string | null
    replayed: boolean
  }>
  failCell(input: {
    runCellId: string
    leaseGeneration: number
    leaseToken: string
    errorCode: string
    retryable: boolean
    providerCalls: AdminProviderCall[]
  }): Promise<{ status?: string | null }>
  finalizeCell(
    input: Record<string, unknown>,
  ): Promise<{ status?: string | null }>
  readArtifact(input: {
    objectKey: string
    sha256: string
    byteLength: number
  }): Promise<Uint8Array>
  runMastra(input: Record<string, unknown>): Promise<MastraSubtitleEvalResult>
  writeArtifact(input: {
    kind: "candidate" | "review-evidence" | "cell-report"
    body: string
    mediaType: "text/vtt" | "application/json"
    expectedSha256?: string
  }): Promise<{
    objectKey: string
    sha256: string
    byteLength: number
    mediaType: string
  }>
  canonicalDigest(value: unknown): string
  canonicalJson(value: unknown): string
  parseLeaseDigest(value: string | null | undefined): {
    generation: number
    token: string
  } | null
}

export async function executeSubtitleEvalCell(
  run: SubtitleEvalWorkflowInput,
  cell: SubtitleEvalWorkflowCell,
  deps: SubtitleEvalCellExecutionDeps,
) {
  for (let attempt = 0; attempt < run.maxAttempts; attempt++) {
    const claim = await deps.claimCell(cell.runCellId, run.timeoutSeconds + 30)
    if (
      claim.replayed &&
      (claim.status === "COMPLETED" || claim.status === "FAILED")
    ) {
      return { runCellId: cell.runCellId, status: claim.status }
    }
    const lease = deps.parseLeaseDigest(claim.digest)
    if (!lease) throw new Error("Subtitle evaluation cell lease was invalid.")
    let observedProviderCalls: AdminProviderCall[] = []
    try {
      const [sourceBytes, referenceBytes] = await Promise.all([
        deps.readArtifact(cell.source),
        deps.readArtifact(cell.reference),
      ])
      const result = await deps.runMastra({
        schemaVersion: "subtitle-translation-eval-cell-request/v1",
        cellId: cell.runCellId,
        caseId: cell.caseId,
        manifestDigest: run.manifestDigest,
        lockDigest: run.lockDigest,
        targetLanguage: cell.targetBcp47,
        provider: run.requestedProvider,
        model: run.requestedModel,
        promptPolicyId: run.promptPolicyId,
        workflowPolicyDigest: run.workflowPolicyDigest,
        timeoutMs: run.timeoutSeconds * 1_000,
        concurrency: 1,
        source: {
          body: new TextDecoder().decode(sourceBytes),
          sha256: cell.source.sha256,
          rawSha256: cell.source.rawSha256,
          clippedSha256: cell.source.clippedSha256,
          byteLength: cell.source.byteLength,
          mediaType: "text/vtt",
          track: cell.source.track,
        },
        reference: {
          body: new TextDecoder().decode(referenceBytes),
          sha256: cell.reference.sha256,
          rawSha256: cell.reference.rawSha256,
          clippedSha256: cell.reference.clippedSha256,
          byteLength: cell.reference.byteLength,
          mediaType: "text/vtt",
          track: cell.reference.track,
        },
      })
      observedProviderCalls = result.providerCalls.map(adminProviderCall)
      if (!result.ok) {
        const failed = await deps.failCell({
          runCellId: cell.runCellId,
          leaseGeneration: lease.generation,
          leaseToken: lease.token,
          errorCode: result.reason,
          retryable: result.retryable,
          providerCalls: observedProviderCalls,
        })
        if (failed.status !== "QUEUED") {
          return {
            runCellId: cell.runCellId,
            status: failed.status ?? "FAILED",
          }
        }
        continue
      }
      assertMastraAttestation(run, cell, result)
      assertArtifactProjection(result, deps.canonicalJson)
      const candidate = await deps.writeArtifact({
        kind: "candidate",
        body: result.artifacts.candidateVtt.body,
        mediaType: "text/vtt",
        expectedSha256: result.artifacts.candidateVtt.sha256,
      })
      const evidence = await deps.writeArtifact({
        kind: "review-evidence",
        body: result.artifacts.reviewEvidence.body,
        mediaType: "application/json",
        expectedSha256: result.artifacts.reviewEvidence.sha256,
      })
      const assessment = {
        schemaVersion: 1,
        metrics: result.metrics,
        advisoryRiskFlags: [],
        usage: result.usage,
        reproducibilityLimits: result.reproducibilityLimits,
        providerRequestId: null,
        providerResponseId: null,
        resolvedModel: result.provider.resolvedModel,
      }
      const cellReport = {
        schemaVersion: "subtitle-eval-cell-report/v1",
        identityAttestation: result.identityAttestation,
        provider: result.provider,
        providerCalls: result.providerCalls,
        policy: result.policy,
        build: result.build,
        determinism: result.determinism,
        runtime: result.runtime,
        assessment,
        artifacts: {
          candidate: withoutReplay(candidate),
          reviewEvidence: withoutReplay(evidence),
        },
        reproducibilityLimits: result.reproducibilityLimits,
      }
      const reportBody = deps.canonicalJson(cellReport)
      const report = await deps.writeArtifact({
        kind: "cell-report",
        body: reportBody,
        mediaType: "application/json",
        expectedSha256: deps.canonicalDigest(cellReport),
      })
      const resultDigest = deps.canonicalDigest(cellReport)
      const finalized = await deps.finalizeCell({
        runCellId: cell.runCellId,
        leaseGeneration: lease.generation,
        leaseToken: lease.token,
        resultDigest,
        artifacts: [
          adminArtifact("CANDIDATE_VTT", candidate),
          adminArtifact("REVIEW_EVIDENCE", evidence),
          adminArtifact("CELL_REPORT", report),
        ],
        providerCalls: observedProviderCalls,
        machineAssessment: {
          ...assessment,
          assessmentDigest: deps.canonicalDigest(assessment),
        },
      })
      return {
        runCellId: cell.runCellId,
        status: finalized.status ?? "COMPLETED",
      }
    } catch (error) {
      const failed = await deps.failCell({
        runCellId: cell.runCellId,
        leaseGeneration: lease.generation,
        leaseToken: lease.token,
        errorCode: classifyManagerFailure(error),
        retryable: false,
        providerCalls: observedProviderCalls,
      })
      return { runCellId: cell.runCellId, status: failed.status ?? "FAILED" }
    }
  }
  return { runCellId: cell.runCellId, status: "FAILED" }
}

function adminProviderCall(
  call: MastraSubtitleEvalProviderCall,
): AdminProviderCall {
  return {
    ...call,
    operation: call.operation.toUpperCase() as AdminProviderCall["operation"],
  }
}

export async function runSubtitleEval(input: SubtitleEvalWorkflowInput) {
  "use workflow"

  const outcomes: Array<{ runCellId: string; status: string }> = []
  try {
    for (
      let index = 0;
      index < input.cells.length;
      index += input.concurrency
    ) {
      outcomes.push(
        ...(await Promise.all(
          input.cells
            .slice(index, index + input.concurrency)
            .map((cell) => executeSubtitleEvalCellStep(input, cell)),
        )),
      )
    }
    return outcomes
  } finally {
    await finalizeSubtitleEvalRunStep(input)
  }
}

async function executeSubtitleEvalCellStep(
  run: SubtitleEvalWorkflowInput,
  cell: SubtitleEvalWorkflowCell,
) {
  "use step"

  const [admin, artifacts, mastra, contract] = await Promise.all([
    import("@/features/subtitle-lab/subtitle-lab-admin-client"),
    import("@/services/subtitle-eval-artifacts"),
    import("@/services/mastra-subtitle-eval"),
    import("@/features/subtitle-lab/subtitle-lab-contract"),
  ])
  const client = await admin.SubtitleLabAdminClient.configured()
  return executeSubtitleEvalCell(run, cell, {
    claimCell: (runCellId, leaseSeconds) =>
      client.claimCell(runCellId, leaseSeconds),
    failCell: (input) => client.failCell(input),
    finalizeCell: (input) => client.finalizeCell(input as never),
    readArtifact: (input) => artifacts.readVerifiedSubtitleEvalArtifact(input),
    runMastra: (input) => mastra.launchMastraSubtitleEvalCell(input as never),
    writeArtifact: (input) =>
      artifacts.writeImmutableSubtitleEvalArtifact(input),
    canonicalDigest: contract.canonicalDigest,
    canonicalJson: contract.canonicalJson,
    parseLeaseDigest: admin.parseLeaseDigest,
  })
}

async function finalizeSubtitleEvalRunStep(input: SubtitleEvalWorkflowInput) {
  "use step"

  const [{ SubtitleLabAdminClient }, contract] = await Promise.all([
    import("@/features/subtitle-lab/subtitle-lab-admin-client"),
    import("@/features/subtitle-lab/subtitle-lab-contract"),
  ])
  const client = await SubtitleLabAdminClient.configured()
  await finalizeSubtitleEvalRun(input, {
    getRun: (runId) => client.getRun(runId),
    getCorpusVersion: (corpusVersionId) =>
      client.getCorpusVersion(corpusVersionId),
    finalizeRun: (finalizeInput) => client.finalizeRun(finalizeInput),
    canonicalDigest: contract.canonicalDigest,
  })
}

export type SubtitleEvalRunFinalizationDeps = {
  getRun(runId: string): Promise<{
    id: string
    corpusVersionId: string
    terminalReport?: unknown
    cells: ReadonlyArray<{
      status: string
      caseId: string
      targetLanguageId: string
      targetLanguageSlug: string
      reproducibilityLimits: string[]
    }>
  } | null>
  getCorpusVersion(corpusVersionId: string): Promise<{
    identityDigest: string
    cells: Parameters<typeof buildSourceReferenceDigestVector>[0]["corpusCells"]
  } | null>
  finalizeRun(input: {
    runId: string
    expectedStatus: "COMPLETED" | "FAILED" | "PARTIAL"
    expectedCorpusIdentityDigest: string
    expectedSourceReferenceDigest: string
    reproducibilityLimits: string[]
  }): Promise<unknown>
  canonicalDigest(value: unknown): string
}

export async function finalizeSubtitleEvalRun(
  input: Pick<SubtitleEvalWorkflowInput, "runId">,
  deps: SubtitleEvalRunFinalizationDeps,
) {
  const run = await deps.getRun(input.runId)
  const corpus = run ? await deps.getCorpusVersion(run.corpusVersionId) : null
  if (!run || run.terminalReport || !corpus) return
  if (
    run.cells.some((cell) => !["COMPLETED", "FAILED"].includes(cell.status))
  ) {
    return
  }
  const sourceReferenceDigests = buildSourceReferenceDigestVector({
    corpusCells: corpus.cells,
    runCells: run.cells,
  })
  const completed = run.cells.filter(
    (cell) => cell.status === "COMPLETED",
  ).length
  const expectedStatus =
    completed === run.cells.length
      ? "COMPLETED"
      : completed === 0
        ? "FAILED"
        : "PARTIAL"
  return deps.finalizeRun({
    runId: run.id,
    expectedStatus,
    expectedCorpusIdentityDigest: corpus.identityDigest,
    expectedSourceReferenceDigest: deps.canonicalDigest(sourceReferenceDigests),
    reproducibilityLimits: aggregateReproducibilityLimits(run.cells, [
      "Development benchmark; no automatic publication or prompt activation.",
    ]),
  })
}

export function aggregateReproducibilityLimits(
  cells: ReadonlyArray<{ reproducibilityLimits: readonly string[] }>,
  runLimits: readonly string[],
) {
  return Array.from(
    new Set([
      ...cells.flatMap((cell) => cell.reproducibilityLimits),
      ...runLimits,
    ]),
  ).sort()
}

function assertMastraAttestation(
  run: SubtitleEvalWorkflowInput,
  cell: SubtitleEvalWorkflowCell,
  result: Extract<MastraSubtitleEvalResult, { ok: true }>,
) {
  const identity = result.identityAttestation
  if (
    identity.cellId !== cell.runCellId ||
    identity.caseId !== cell.caseId ||
    identity.manifestDigest !== run.manifestDigest ||
    identity.lockDigest !== run.lockDigest ||
    identity.targetLanguage !== cell.targetBcp47 ||
    identity.sourceSha256 !== cell.source.sha256 ||
    identity.referenceSha256 !== cell.reference.sha256 ||
    identity.sourceSubtitleId !== cell.source.track.subtitleId ||
    identity.referenceSubtitleId !== cell.reference.track.subtitleId ||
    result.provider.requestedModel !== run.requestedModel ||
    result.policy.promptPolicyId !== run.promptPolicyId ||
    result.policy.workflowPolicyDigest !== run.workflowPolicyDigest ||
    result.build.codeRevision !== run.codeRevision ||
    result.runtime.timeoutMs !== run.timeoutSeconds * 1_000
  ) {
    throw new Error("Mastra subtitle evaluation attestation did not match.")
  }
}

function assertArtifactProjection(
  result: Extract<MastraSubtitleEvalResult, { ok: true }>,
  serialize: (value: unknown) => string,
) {
  const encoder = new TextEncoder()
  if (
    encoder.encode(result.artifacts.candidateVtt.body).byteLength !==
      result.artifacts.candidateVtt.byteLength ||
    encoder.encode(result.artifacts.reviewEvidence.body).byteLength !==
      result.artifacts.reviewEvidence.byteLength ||
    result.artifacts.reviewEvidence.body !== serialize(result.reviewEvidence)
  ) {
    throw new Error(
      "Mastra subtitle evaluation artifact projection did not match.",
    )
  }
}

function classifyManagerFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "unknown"
  if (name.includes("Artifact")) return "artifact_integrity_failed"
  return "manager_cell_failed"
}

function adminArtifact(
  kind: "CANDIDATE_VTT" | "REVIEW_EVIDENCE" | "CELL_REPORT",
  artifact: {
    objectKey: string
    sha256: string
    byteLength: number
    mediaType: string
  },
) {
  return { ...artifact, kind, byteLength: String(artifact.byteLength) }
}

function withoutReplay<T extends Record<string, unknown>>(value: T) {
  const { replayed: _replayed, ...identity } = value
  void _replayed
  return identity
}
