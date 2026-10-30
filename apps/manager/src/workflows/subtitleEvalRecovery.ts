import { z } from "zod"

import {
  subtitleEvalCorpusVersionSchema,
  subtitleEvalRunSchema,
  type SubtitleLabAdminClient,
  parseLeaseDigest,
} from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  buildSourceReferenceDigestVector,
  canonicalDigest,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  aggregateReproducibilityLimits,
  type SubtitleEvalWorkflowCell,
  type SubtitleEvalWorkflowInput,
  type SubtitleEvalWorkflowTrack,
} from "@/workflows/subtitleEval"

const metadataSchema = z
  .object({
    schemaVersion: z.literal("subtitle-eval-corpus-cell/v1"),
    targetBcp47: z.string().min(2).max(35),
    sourceBcp47: z.string().min(2).max(35),
    case: z.record(z.string(), z.unknown()),
    sourceTrack: trackSchema("source"),
    referenceTrack: trackSchema("reference"),
    sourceByteLength: z
      .number()
      .int()
      .positive()
      .max(512 * 1024),
    referenceByteLength: z
      .number()
      .int()
      .positive()
      .max(512 * 1024),
  })
  .passthrough()

function trackSchema(role: "source" | "reference") {
  return z
    .object({
      role: z.literal(role),
      language: z.string().min(2).max(35),
      coreLanguageId: z.string().min(1).max(191),
      subtitleId: z.string().min(1).max(191),
      videoId: z.string().min(1).max(191),
      edition: z.string().min(1).max(191),
      coreVideoEditionId: z.string().min(1).max(191),
      cueCount: z.number().int().positive().max(1_000),
    })
    .strict()
}

export function buildSubtitleEvalWorkflowInput(
  rawRun: z.input<typeof subtitleEvalRunSchema>,
  rawCorpus: z.input<typeof subtitleEvalCorpusVersionSchema>,
): SubtitleEvalWorkflowInput {
  const run = subtitleEvalRunSchema.parse(rawRun)
  const corpus = subtitleEvalCorpusVersionSchema.parse(rawCorpus)
  if (run.corpusVersionId !== corpus.id) throw new Error("Run corpus mismatch.")
  const corpusByIdentity = new Map(
    corpus.cells.map((cell) => [
      `${cell.caseId}\u0000${cell.targetLanguageId}\u0000${cell.targetLanguageSlug}`,
      cell,
    ]),
  )
  const cells: SubtitleEvalWorkflowCell[] = run.cells.map((runCell) => {
    const corpusCell = corpusByIdentity.get(
      `${runCell.caseId}\u0000${runCell.targetLanguageId}\u0000${runCell.targetLanguageSlug}`,
    )
    if (!corpusCell) throw new Error("Run cell is not in its frozen corpus.")
    const metadata = metadataSchema.parse(corpusCell.metadata)
    return {
      runCellId: runCell.id,
      corpusCellId: corpusCell.id,
      caseId: corpusCell.caseId,
      collectionKey: corpusCell.collectionKey,
      targetLanguageId: corpusCell.targetLanguageId,
      targetLanguageSlug: corpusCell.targetLanguageSlug,
      targetBcp47: metadata.targetBcp47,
      source: snapshot(
        "source",
        corpusCell.sourceSnapshotDigest,
        corpusCell.sourceSnapshotRawDigest,
        corpusCell.sourceSnapshotClippedDigest,
        metadata.sourceTrack,
        metadata.sourceByteLength,
      ),
      reference: snapshot(
        "reference",
        corpusCell.referenceSnapshotDigest,
        corpusCell.referenceSnapshotRawDigest,
        corpusCell.referenceSnapshotClippedDigest,
        metadata.referenceTrack,
        metadata.referenceByteLength,
      ),
    }
  })
  return {
    runId: run.id,
    corpusIdentityDigest: corpus.identityDigest,
    manifestDigest: corpus.manifestDigest,
    lockDigest: corpus.lockDigest,
    requestedProvider: z.literal("openrouter").parse(run.requestedProvider),
    requestedModel: run.requestedModel,
    promptPolicyId: run.promptPolicyId,
    workflowPolicyDigest: run.workflowPolicyDigest,
    codeRevision: run.codeRevision,
    timeoutSeconds: run.timeoutSeconds,
    maxAttempts: run.maxAttempts,
    concurrency: run.concurrency,
    cells,
  }
}

function snapshot(
  role: "source" | "reference",
  sha256: string,
  rawSha256: string,
  clippedSha256: string | null,
  track: SubtitleEvalWorkflowTrack,
  byteLength: number,
) {
  const extension = "vtt"
  return {
    objectKey: `subtitle-eval/v1/${role}/${sha256}.${extension}`,
    sha256,
    rawSha256,
    clippedSha256: clippedSha256 ?? sha256,
    byteLength,
    track,
  }
}

export async function recoverSubtitleEvalRun(input: {
  client: SubtitleLabAdminClient
  runId: string
  dispatchFailed?: boolean
  launch: (workflowInput: SubtitleEvalWorkflowInput) => Promise<unknown>
}) {
  const claim = await input.client.claimMachineRecovery(input.runId, 120)
  const lease = parseLeaseDigest(claim.digest)
  if (!lease) throw new Error("Subtitle evaluation recovery lease was invalid.")
  const recovered = await input.client.recoverMachineRun({
    runId: input.runId,
    leaseGeneration: lease.generation,
    leaseToken: lease.token,
    dispatchFailed: input.dispatchFailed ?? false,
  })
  if (recovered.status === "REQUEUED") {
    const run = await input.client.getRun(input.runId)
    if (!run) return recovered
    const corpus = await input.client.getCorpusVersion(run.corpusVersionId)
    if (!corpus) return recovered
    await input.launch(buildSubtitleEvalWorkflowInput(run, corpus))
  } else if (recovered.status === "READY_TO_FINALIZE") {
    await finalizeRecoveredRun(input.client, input.runId)
  }
  return recovered
}

export async function recoverStaleSubtitleEvalRuns(input: {
  client: SubtitleLabAdminClient
  launch: (workflowInput: SubtitleEvalWorkflowInput) => Promise<unknown>
  maxPages?: number
}) {
  const outcomes: Array<{ runId: string; status: string }> = []
  let after: string | undefined
  for (let page = 0; page < (input.maxPages ?? 4); page++) {
    const stale = await input.client.listStaleRuns(25, after)
    if (!stale) break
    for (const run of stale.nodes ?? []) {
      try {
        const result = await recoverSubtitleEvalRun({
          client: input.client,
          runId: String(run.id),
          launch: input.launch,
        })
        outcomes.push({
          runId: String(run.id),
          status: result.status ?? "UNKNOWN",
        })
      } catch {
        outcomes.push({ runId: String(run.id), status: "SKIPPED_OR_RACED" })
      }
    }
    if (!stale.nextCursor) break
    after = stale.nextCursor
  }
  return outcomes
}

async function finalizeRecoveredRun(
  client: SubtitleLabAdminClient,
  runId: string,
) {
  const run = await client.getRun(runId)
  if (!run || run.terminalReport) return
  const corpus = await client.getCorpusVersion(run.corpusVersionId)
  if (!corpus) return
  if (run.cells.some((cell) => !["COMPLETED", "FAILED"].includes(cell.status)))
    return
  const sourceReferenceDigests = buildSourceReferenceDigestVector({
    corpusCells: corpus.cells,
    runCells: run.cells,
  })
  const completed = run.cells.filter(
    (cell) => cell.status === "COMPLETED",
  ).length
  await client.finalizeRun({
    runId,
    expectedStatus:
      completed === run.cells.length
        ? "COMPLETED"
        : completed === 0
          ? "FAILED"
          : "PARTIAL",
    expectedCorpusIdentityDigest: corpus.identityDigest,
    expectedSourceReferenceDigest: canonicalDigest(sourceReferenceDigests),
    reproducibilityLimits: aggregateReproducibilityLimits(run.cells, [
      "Development benchmark; no automatic publication or prompt activation.",
      "Recovered after a stale or rejected Manager workflow dispatch.",
    ]),
  })
}
